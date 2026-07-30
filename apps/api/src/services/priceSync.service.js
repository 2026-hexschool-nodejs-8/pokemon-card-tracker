// 抓價主流程編排 － 對應 PRD 第十六章「排程與資料流程」
//
//   建立 job → 讀取啟用來源 → 逐一呼叫 adapter（含 timeout）
//   → 清洗標準化 → 寫入 snapshot → 更新 card 摘要 → 寫 log → 結算 job 狀態
//
// 單一來源失敗不影響其他來源（PRD FR-14）。
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

  const job = await prisma.priceFetchJob.create({
    data: { triggerType, status: JOB_STATUS.RUNNING, totalSources: sources.length },
  });

  logger.info(`Job ${job.id} 開始，共 ${sources.length} 個來源（trigger=${triggerType}）`);

  let successCount = 0;
  let failedCount = 0;
  const errors = [];

  try {
    for (const source of sources) {
      const startedAt = Date.now();
      try {
        await processOneSource(job.id, source);
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
  } catch (err) {
    // 未預期錯誤（如 DB 連線中斷）：確保 job 被結算為 FAILED，不會永久卡在 RUNNING
    logger.error(`Job ${job.id} 發生未預期錯誤：${err.message}`);
    await prisma.priceFetchJob.update({
      where: { id: job.id },
      data: { status: JOB_STATUS.FAILED, finishedAt: new Date(), errorMessage: err.message.slice(0, 1000) },
    }).catch(() => {});
    throw err;
  }
}

// ── 單一來源：抓價 → 清洗 → 寫快照 → 更新卡牌 → 寫成功 log ──
async function processOneSource(jobId, source) {
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
  const fetchedAt = new Date(result.fetchedAt || Date.now());

  // 去重（僅 tcgplayer）：同一筆成交會重複抓到，若最新一筆 snapshot 的 fetchedAt >= 本次資料時間，
  // 代表沒有新成交，跳過寫入。其他 provider（每次抓價即代表一個新資料點）不受影響。
  if (source.provider === 'tcgplayer') {
    const latestSnapshot = await prisma.priceSnapshot.findFirst({
      where: { sourceId: source.id },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    });
    if (latestSnapshot && latestSnapshot.fetchedAt >= fetchedAt) {
      logger.info(`來源 ${source.provider}(${source.id}) 無新資料（最新成交 ${fetchedAt.toISOString()} 已存在），略過寫入 snapshot`);
      // 即使沒有新資料可寫，這次抓價本身仍是成功的，更新 lastSuccessAt 讓
      // Admin Jobs 看得出「有抓，只是沒有新成交」，而非長期沉默看起來像失敗。
      await prisma.priceSource.update({
        where: { id: source.id },
        data: { lastSuccessAt: new Date(), lastError: null },
      });
      return;
    }
  }

  await prisma.$transaction([
    prisma.priceSnapshot.create({
      data: {
        cardId: source.cardId,
        sourceId: source.id,
        provider: result.provider || source.provider,
        price,
        currency,
        rawText: result.rawText ?? String(result.price),
        fetchedAt,
        isSuspicious,
      },
    }),
    prisma.card.update({
      where: { id: source.cardId },
      data: {
        latestPrice: price,
        latestCurrency: currency,
        lastFetchedAt: new Date(),
        ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
      },
    }),
    prisma.priceSource.update({
      where: { id: source.id },
      data: { lastSuccessAt: new Date(), lastError: null },
    }),
    prisma.priceFetchLog.create({
      data: {
        jobId,
        cardId: source.cardId,
        sourceId: source.id,
        status: LOG_STATUS.SUCCESS,
        message: `抓價成功 ${currency} ${price}${isSuspicious ? '（疑似異常）' : ''}`,
        durationMs: Date.now() - startedAt,
      },
    }),
  ]);
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
