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

router.post(
  '/tcgplayer',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.body.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.body.limit, 10) || 10));

    const productIds = await getProductIds(page);
    const targets = productIds.slice(0, limit);

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const results = [];

    for (const productId of targets) {
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

        // 只呼叫一次 scrapeCard，取得 name / imageUrl / price
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

        // 建立卡牌，同時取得 source id 以寫入 PriceSnapshot
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

        // 直接用第一次 scrapeCard 拿到的 price 寫入 PriceSnapshot，
        // 避免第二次爬蟲因 rate limit 或 Cookie 失效而靜默失敗。
        if (cardData.price != null) {
          const price = normalizePrice(cardData.price);
          await prisma.$transaction([
            prisma.priceSnapshot.create({
              data: {
                cardId: card.id,
                sourceId: source.id,
                provider: 'tcgplayer',
                price,
                currency: 'USD',
                rawText: String(cardData.price),
                fetchedAt: new Date(),
                isSuspicious: false,
              },
            }),
            prisma.card.update({
              where: { id: card.id },
              data: {
                latestPrice: price,
                latestCurrency: 'USD',
                lastFetchedAt: new Date(),
              },
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
        });
      } catch (err) {
        if (card) {
          try { await prisma.card.delete({ where: { id: card.id } }); } catch (_) {}
        }
        failed++;
        results.push({ productId, status: 'failed', error: err.message });
      }
    }

    res.json({ imported, skipped, failed, results });
  }),
);

export default router;
