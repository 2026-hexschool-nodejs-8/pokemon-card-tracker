import { Router } from 'express';
import { prisma } from '@pct/db';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getProductIds, scrapeCard } from '../adapters/crawler/tcgplayer.scraper.js';
import { withTimeout } from '../lib/timeout.js';
import { normalizePrice } from '../lib/normalizePrice.js';

const router = Router();
router.use(adminAuth);

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;

// ── 共用：將一批 productId 逐一匯入 ──
async function importProductIds(productIds) {
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
        const latest = validSales[validSales.length - 1];
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
      results.push({
        productId,
        status: 'imported',
        cardId: card.id,
        name: cardData.name,
        price: cardData.price ?? null,
        salesCount: validSales.length || (cardData.price != null ? 1 : 0),
      });
    } catch (err) {
      if (card) {
        try { await prisma.card.delete({ where: { id: card.id } }); } catch (_) {}
      }
      failed++;
      results.push({ productId, status: 'failed', error: err.message });
    }
  }

  return { imported, skipped, failed, results };
}

// ── POST /admin/import/tcgplayer ── 批次匯入（依頁碼）
router.post(
  '/tcgplayer',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.body.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.body.limit, 10) || 10));

    const productIds = await getProductIds(page);
    const targets = productIds.slice(0, limit);
    const summary = await importProductIds(targets);
    res.json(summary);
  }),
);

// ── POST /admin/import/tcgplayer/search ── 依卡名搜尋並匯入
router.post(
  '/tcgplayer/search',
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: '請提供卡牌名稱（name）' });
    }
    const limit = Math.min(20, Math.max(1, parseInt(req.body.limit, 10) || 5));

    const productIds = await getProductIds(1, name.trim());
    const targets = productIds.slice(0, limit);

    if (targets.length === 0) {
      return res.json({ imported: 0, skipped: 0, failed: 0, results: [], message: `找不到「${name}」相關卡牌` });
    }

    const summary = await importProductIds(targets);
    res.json({ ...summary, searchName: name.trim() });
  }),
);

export default router;
