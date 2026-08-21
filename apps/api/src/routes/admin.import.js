import { Router } from 'express';
import { prisma } from '@pct/db';
import {
  JOB_STATUS,
  JOB_TRIGGER_TYPE,
  LOG_STATUS,
  importTcgplayerSchema,
  importTcgplayerSearchSchema,
} from '@pct/shared';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getProductIds, scrapeCard } from '../adapters/crawler/tcgplayer.scraper.js';
import { withTimeout } from '../lib/timeout.js';
import { normalizePrice } from '../lib/normalizePrice.js';

const router = Router();
router.use(adminAuth);

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;

// total=0 沒有目標視為成功；全部失敗（沒有任何 imported/skipped）視為失敗；其餘部分成功。
function resolveImportJobStatus(total, imported, skipped, failed) {
  if (total === 0 || failed === 0) return JOB_STATUS.SUCCESS;
  if (imported === 0 && skipped === 0) return JOB_STATUS.FAILED;
  return JOB_STATUS.PARTIAL_SUCCESS;
}

// ── 共用：將一批 productId 逐一匯入，記錄成一個 PriceFetchJob（triggerType: manual），
// 讓透過這條路由匯入的資料也能在 Admin Jobs 頁面被看到 ──
async function importProductIds(productIds) {
  const job = await prisma.priceFetchJob.create({
    data: { triggerType: JOB_TRIGGER_TYPE.MANUAL, status: JOB_STATUS.RUNNING, totalSources: productIds.length },
  });

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const results = [];

  for (const productId of productIds) {
    let card = null;
    try {
      const existing = await prisma.priceSource.findFirst({
        where: { externalId: String(productId), provider: 'tcgplayer' },
      });

      if (existing) {
        skipped++;
        results.push({ productId, status: 'skipped' });
        continue;
      }

      let cardData;
      try {
        cardData = await withTimeout(
          scrapeCard(productId),
          FETCH_TIMEOUT_MS,
          `scrapeCard(${productId})`,
        );
      } catch (err) {
        failed++;
        results.push({ productId, status: 'failed', error: err.message });
        await prisma.priceFetchLog.create({
          data: {
            jobId: job.id,
            status: LOG_STATUS.FAILED,
            message: `scrapeCard(${productId}) 失敗：${err.message}`.slice(0, 500),
          },
        });
        continue;
      }

      card = await prisma.card.create({
        data: {
          name: cardData.name,
          cardNumber: String(productId),
          imageUrl: cardData.imageUrl,
          language: 'en',
          condition: 'raw',
          sources: {
            create: {
              type: 'crawler',
              provider: 'tcgplayer',
              externalId: String(productId),
              currency: 'USD',
            },
          },
        },
        include: { sources: true },
      });

      const source = card.sources[0];

      const sales = cardData.latestSales ?? [];
      const validSales = sales.flatMap((s) => {
        try {
          return [{ price: normalizePrice(s.purchasePrice), orderDate: s.orderDate }];
        } catch {
          return [];
        }
      });

      if (validSales.length > 0) {
        // cardData.latestSales 沿用 TCGPlayer latestsales API 的原始順序（新到舊，見 tcgplayer.scraper.js），
        // 這裡取 [0] 才是真正最新一筆，須與 tcgplayerCrawler.adapter.js 的假設一致（見 R1）
        const latest = validSales[0];
        await prisma.$transaction([
          ...validSales.map(({ price, orderDate }) =>
            prisma.priceSnapshot.create({
              data: {
                cardId: card.id,
                sourceId: source.id,
                provider: 'tcgplayer',
                price,
                currency: 'USD',
                rawText: String(price),
                fetchedAt: orderDate ? new Date(orderDate) : new Date(),
                isSuspicious: false,
              },
            }),
          ),
          prisma.card.update({
            where: { id: card.id },
            data: {
              latestPrice: latest.price,
              latestCurrency: 'USD',
              lastFetchedAt: new Date(),
              imageUrl: cardData.imageUrl,
            },
          }),
          prisma.priceSource.update({
            where: { id: source.id },
            data: { lastSuccessAt: new Date() },
          }),
        ]);
      } else if (cardData.price != null) {
        const price = normalizePrice(cardData.price);
        await prisma.$transaction([
          prisma.priceSnapshot.create({
            data: {
              cardId: card.id,
              sourceId: source.id,
              provider: 'tcgplayer',
              price,
              currency: 'USD',
              rawText: String(price),
              fetchedAt: new Date(),
              isSuspicious: false,
            },
          }),
          prisma.card.update({
            where: { id: card.id },
            data: { latestPrice: price, latestCurrency: 'USD', lastFetchedAt: new Date() },
          }),
          prisma.priceSource.update({
            where: { id: source.id },
            data: { lastSuccessAt: new Date() },
          }),
        ]);
      }

      imported++;
      const salesCount = validSales.length || (cardData.price != null ? 1 : 0);
      results.push({
        productId,
        status: 'imported',
        cardId: card.id,
        name: cardData.name,
        price: cardData.price ?? null,
        salesCount,
      });
      await prisma.priceFetchLog.create({
        data: {
          jobId: job.id,
          cardId: card.id,
          sourceId: source.id,
          status: LOG_STATUS.SUCCESS,
          message: `匯入成功：${cardData.name}（寫入 ${salesCount} 筆歷史價格）`,
        },
      });
    } catch (err) {
      if (card) {
        try { await prisma.card.delete({ where: { id: card.id } }); } catch (_) {}
      }
      failed++;
      results.push({ productId, status: 'failed', error: err.message });
      await prisma.priceFetchLog.create({
        data: {
          jobId: job.id,
          status: LOG_STATUS.FAILED,
          message: `匯入 productId=${productId} 失敗：${err.message}`.slice(0, 500),
        },
      });
    }
  }

  const status = resolveImportJobStatus(productIds.length, imported, skipped, failed);
  await prisma.priceFetchJob.update({
    where: { id: job.id },
    data: {
      status,
      finishedAt: new Date(),
      successCount: imported,
      failedCount: failed,
      errorMessage: failed > 0 ? `${failed} 筆匯入失敗，詳見 job logs` : null,
    },
  });

  return { imported, skipped, failed, results, jobId: job.id };
}

// ── POST /admin/import/tcgplayer ── 批次匯入（依頁碼）
router.post(
  '/tcgplayer',
  asyncHandler(async (req, res) => {
    const { page, limit } = importTcgplayerSchema.parse(req.body);

    const productIds = await getProductIds(page);
    const targets = productIds.slice(0, limit);
    const summary = await importProductIds(targets);
    res.json({ data: summary });
  }),
);

// ── POST /admin/import/tcgplayer/search ── 依卡名搜尋並匯入
// 搜不到時不建立 job，但仍回傳與有結果時相同的欄位（jobId / message 恆存在），呼叫端只需處理一種形狀
router.post(
  '/tcgplayer/search',
  asyncHandler(async (req, res) => {
    const { name, limit } = importTcgplayerSearchSchema.parse(req.body);

    const productIds = await getProductIds(1, name);
    const targets = productIds.slice(0, limit);

    if (targets.length === 0) {
      return res.json({
        data: {
          imported: 0,
          skipped: 0,
          failed: 0,
          results: [],
          jobId: null,
          searchName: name,
          message: `找不到「${name}」相關卡牌`,
        },
      });
    }

    const summary = await importProductIds(targets);
    res.json({ data: { ...summary, searchName: name, message: null } });
  }),
);

export default router;
