// 後台卡牌 / 來源管理 － PRD 建議 API「Admin Cards」段
// 掛在 /admin 之下，整個 router 需通過 adminAuth
import { Router } from 'express';
import { prisma } from '@pct/db';
import {
  createCardSchema,
  updateCardSchema,
  createSourceSchema,
  updateSourceSchema,
} from '@pct/shared';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();
router.use(adminAuth);

// POST /admin/cards
router.post(
  '/cards',
  asyncHandler(async (req, res) => {
    const data = createCardSchema.parse(req.body);
    const card = await prisma.card.create({ data });
    res.status(201).json({ data: card });
  }),
);

// PATCH /admin/cards/:id
router.patch(
  '/cards/:id',
  asyncHandler(async (req, res) => {
    const data = updateCardSchema.parse(req.body);
    const card = await prisma.card.update({ where: { id: req.params.id }, data });
    res.json({ data: card });
  }),
);

// DELETE /admin/cards/:id － 停用追蹤（soft delete）
router.delete(
  '/cards/:id',
  asyncHandler(async (req, res) => {
    await prisma.card.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ data: { id: req.params.id, isActive: false } });
  }),
);

// POST /admin/cards/:id/sources － 為卡牌新增價格來源
router.post(
  '/cards/:id/sources',
  asyncHandler(async (req, res) => {
    const data = createSourceSchema.parse(req.body);
    const source = await prisma.priceSource.create({
      data: { ...data, cardId: req.params.id },
    });
    res.status(201).json({ data: source });
  }),
);

// PATCH /admin/sources/:id － 編輯價格來源
router.patch(
  '/sources/:id',
  asyncHandler(async (req, res) => {
    const data = updateSourceSchema.parse(req.body);
    const source = await prisma.priceSource.update({ where: { id: req.params.id }, data });
    res.json({ data: source });
  }),
);

export default router;
