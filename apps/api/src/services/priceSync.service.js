// 抓價主流程編排 － 對應 PRD 第十六章「排程與資料流程」
//
//   建立 job → 讀取啟用來源 → 逐一呼叫 adapter（含 timeout）
//   → 清洗標準化 → 寫入 snapshot → 更新 card 摘要 → 寫 log → 結算 job 狀態
//
// 單一來源失敗不影響其他來源（PRD FR-14）。
import { convertToTwd } from '../lib/convertToTwd.js';
import { prisma } from '@pct/db';
import { JOB_STATUS, LOG_STATUS } from '@pct/shared';
import { normalizePrice, isSuspiciousPrice } from '../lib/normalizePrice.js';
import { getAdapter } from '../adapters/registry.js';
import { withTimeout } from '../lib/timeout.js';
import { logger } from '../lib/logger.js';
import { conflict } from '../lib/httpError.js';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;

/**
 * 執行一次價格同步。
 * @param {object} opts
 * @param {'manual'|'cron'} opts.triggerType
 * @param {string} [opts.cardId] 只更新單張卡（不給則更新全部）
 * @returns 完成後的 job（含 logs）
 */
export async function runPriceSync({ triggerType, cardId } = {}) {
  // 防止重複執行（PRD 第十六章：已有 running job 就拒絕）
  const running = await prisma.priceFetchJob.count({ where: { status: JOB_STATUS.RUNNING } });
  if (running > 0) {
    throw conflict('已有抓價任務進行中，請稍後再試');
  }

  const sources = await prisma.priceSource.findMany({
    where: {
      isActive: true,
      card: { isActive: true, ...(cardId ? { id: cardId } : {}) },
    },
    include: { card: true },
  });

  const ratesToTwd = await loadRatesToTwd();

  const job = await prisma.priceFetchJob.create({
    data: { triggerType, status: JOB_STATUS.RUNNING, totalSources: sources.length },
  });

  logger.info(`Job ${job.id} 開始，共 ${sources.length} 個來源（trigger=${triggerType}）`);

  let successCount = 0;
  let failedCount = 0;
  const errors = [];

  for (const source of sources) {
    const startedAt = Date.now();
    try {
      await processOneSource(job.id, source, ratesToTwd);
      successCount += 1;
    } catch (err) {
      failedCount += 1;
      errors.push(`${source.provider}: ${err.message}`);
      await handleSourceFailure(job.id, source, err, Date.now() - startedAt);
      logger.warn(`來源 ${source.provider}(${source.id}) 失敗：${err.message}`);
    }
  }

  const status = resolveJobStatus(sources.length, successCount, failedCount);
  const finished = await prisma.priceFetchJob.update({
    where: { id: job.id },
    data: {
      status,
      finishedAt: new Date(),
      successCount,
      failedCount,
      errorMessage: errors.length ? errors.join('; ').slice(0, 1000) : null,
    },
    include: { logs: true },
  });

  logger.info(`Job ${job.id} 結束：${status}（成功 ${successCount} / 失敗 ${failedCount}）`);
  return finished;
}

// 把 Currency 表載成 Map：幣別 → rateToTwd（整個 job 查一次）
async function loadRatesToTwd() {
  const rows = await prisma.currency.findMany();
  return new Map(rows.map((r) => [r.code, r.rateToTwd]));
}

// ── 單一來源：抓價 → 清洗 → 寫快照 → 更新卡牌 → 寫成功 log ──
async function processOneSource(jobId, source, ratesToTwd) {
  const startedAt = Date.now();
  const adapter = getAdapter(source);

  const result = await withTimeout(
    adapter.fetchPrice(source),
    FETCH_TIMEOUT_MS,
    `抓取 ${source.provider}`,
  );

  // 統一清洗（擋 0 / NaN / Infinity，清掉貨幣符號與逗號）
  const price = normalizePrice(result.rawText ?? result.price);
  const currency = result.currency || source.currency;
  const isSuspicious = isSuspiciousPrice(price, source.card.latestPrice);

  // 換算台幣（失敗回 null + reason，不中斷 job）
  const { priceTwd, reason: twdReason } = convertToTwd(price, currency, ratesToTwd);
  if (priceTwd === null) {
    logger.warn(`來源 ${source.provider}(${source.id}) 台幣換算失敗：${twdReason}`);
  }

  const imageUrl = typeof result.imageUrl === 'string' ? result.imageUrl.trim() : '';
  const isValidImage = /^https?:\/\//i.test(imageUrl);

  await prisma.$transaction(async (tx) => {
    await tx.priceSnapshot.create({
      data: {
        cardId: source.cardId,
        sourceId: source.id,
        provider: result.provider || source.provider,
        price,
        currency,
        priceTwd,
        rawText: result.rawText ?? String(result.price),
        fetchedAt: new Date(result.fetchedAt || Date.now()),
        isSuspicious,
      },
    });

    // 價格摘要一律更新；圖片用條件更新，避免同 job 多來源覆寫
    await tx.card.update({
      where: { id: source.cardId },
      data: {
        latestPrice: price,
        latestCurrency: currency,
        latestPriceTwd: priceTwd,
        lastFetchedAt: new Date(),
      },
    });

    if (isValidImage) {
      const filled = await tx.card.updateMany({
        where: {
          id: source.cardId,
          OR: [{ imageUrl: null }, { imageUrl: '' }],
        },
        data: { imageUrl },
      });
      if (filled.count > 0) {
        logger.info(`Card ${source.cardId} 寫入 imageUrl（來源 ${source.provider}）`);
      }
    } else {
      const card = await tx.card.findUnique({
        where: { id: source.cardId },
        select: { imageUrl: true },
      });
      if (!card?.imageUrl) {
        logger.warn(`Card ${source.cardId} 缺 imageUrl（來源 ${source.provider}）`);
      }
    }

    await tx.priceSource.update({
      where: { id: source.id },
      data: { lastSuccessAt: new Date(), lastError: null },
    });

    await tx.priceFetchLog.create({
      data: {
        jobId,
        cardId: source.cardId,
        sourceId: source.id,
        status: LOG_STATUS.SUCCESS,
        message:
          `抓價成功 ${currency} ${price}` +
          (isSuspicious ? '（疑似異常）' : '') +
          (priceTwd === null ? `（台幣換算失敗：${twdReason}）` : ` ≈ TWD ${priceTwd}`),
        durationMs: Date.now() - startedAt,
      },
    });
  });
}

// ── 單一來源失敗：記錄錯誤，不中斷整個 job ──
async function handleSourceFailure(jobId, source, err, durationMs) {
  await prisma.$transaction([
    prisma.priceSource.update({
      where: { id: source.id },
      data: { lastError: err.message.slice(0, 500) },
    }),
    prisma.priceFetchLog.create({
      data: {
        jobId,
        cardId: source.cardId,
        sourceId: source.id,
        status: LOG_STATUS.FAILED,
        message: err.message.slice(0, 500),
        durationMs,
      },
    }),
  ]);
}

function resolveJobStatus(total, success, failed) {
  if (total === 0) return JOB_STATUS.SUCCESS;
  if (failed === 0) return JOB_STATUS.SUCCESS;
  if (success === 0) return JOB_STATUS.FAILED;
  return JOB_STATUS.PARTIAL_SUCCESS;
}
