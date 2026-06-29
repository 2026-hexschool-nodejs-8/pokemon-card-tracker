import { Router } from 'express';
import { prisma } from '@pct/db';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getProductIds, scrapeCard } from '../adapters/crawler/tcgplayer.scraper.js';
import { runPriceSync } from '../services/priceSync.service.js';
import { withTimeout } from '../lib/timeout.js';

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
      // card 宣告在外層，讓 catch 區塊可以判斷是否需要刪除孤兒記錄
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

        // Bug 3 / Bug 6：加 withTimeout 防止 worker 掛住；
        // scrapeCard 失敗直接 continue，不建 Card（避免 name 為空的孤兒記錄）
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
        });

        await runPriceSync({ triggerType: 'manual', cardId: card.id });

        imported++;
        results.push({ productId, status: 'imported', cardId: card.id, name: cardData.name });
      } catch (err) {
        // Bug 4：runPriceSync 失敗時刪除剛建的 Card，
        // 避免孤兒記錄讓下次匯入因 findFirst 找到 PriceSource 而永遠 skip
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
