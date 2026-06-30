// 前台公開 API － PRD FR-03 / FR-04 / 建議 API Public 段
import { Router } from 'express';
import { listCardsQuerySchema } from '@pct/shared';
import { listCards, getCardById, getCardPrices, getTcgplayerPriceHistory } from '../services/card.service.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// GET /cards?keyword=&language=&grade=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = listCardsQuerySchema.parse(req.query);
    const cards = await listCards(query);
    res.json({ data: cards });
  }),
);

// GET /cards/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const card = await getCardById(req.params.id);
    res.json({ data: card });
  }),
);

// GET /cards/:id/prices?from=&to=&source=
router.get(
  '/:id/prices',
  asyncHandler(async (req, res) => {
    const prices = await getCardPrices(req.params.id, req.query);
    res.json({ data: prices });
  }),
);

// GET /cards/:id/tcgplayer-history?range=month|quarter|annual
router.get(
  '/:id/tcgplayer-history',
  asyncHandler(async (req, res) => {
    const { range = 'quarter' } = req.query;
    const result = await getTcgplayerPriceHistory(req.params.id, range);
    res.json({ data: result });
  }),
);

export default router;
