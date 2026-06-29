import { Router } from 'express';
import { prisma } from '@pct/db';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getProductIds, scrapeCard } from '../adapters/crawler/tcgplayer.scraper.js';
import { runPriceSync } from '../services/priceSync.service.js';

const router = Router();
router.use(adminAuth);

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
      try {
        const existing = await prisma.priceSource.findFirst({
          where: { externalId: String(productId), provider: 'tcgplayer' },
        });

        if (existing) {
          skipped++;
          results.push({ productId, status: 'skipped' });
          continue;
        }

        const cardData = await scrapeCard(productId);

        const card = await prisma.card.create({
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
        failed++;
        results.push({ productId, status: 'failed', error: err.message });
      }
    }

    res.json({ imported, skipped, failed, results });
  }),
);

export default router;
