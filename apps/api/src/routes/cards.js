// 前台公開 API － PRD FR-03 / FR-04 / 建議 API Public 段
import { Router } from 'express';
import { listCardsQuerySchema } from '@pct/shared';
import { listCards, getCardById, getCardPrices } from '../services/card.service.js';
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

export default router;
