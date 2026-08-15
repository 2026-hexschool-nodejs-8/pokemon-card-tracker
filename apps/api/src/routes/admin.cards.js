// 後台卡牌 / 來源管理 － PRD 建議 API「Admin Cards」段
// 掛在 /admin 之下，整個 router 需通過 adminAuth
import { Router } from 'express';
import { prisma } from '@pct/db';
import {
  createCardSchema,
  updateCardSchema,
  createSourceSchema,
  updateSourceSchema,
  adminListCardsQuerySchema,
} from '@pct/shared';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { notFound } from '../lib/httpError.js';

const router = Router();
router.use(adminAuth);

// GET /admin/cards?keyword=&language=&grade=&isActive=true|false
router.get(
  '/cards',
  asyncHandler(async (req, res) => {
    const { keyword, language, grade, isActive } = adminListCardsQuerySchema.parse(req.query);
    const cards = await prisma.card.findMany({
      where: {
        ...(isActive !== undefined ? { isActive } : {}),
        ...(language ? { language } : {}),
        ...(grade ? { condition: grade } : {}),
        ...(keyword
          ? {
              OR: [
                { name: { contains: keyword, mode: 'insensitive' } },
                { cardNumber: { contains: keyword, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { sources: true } } },
    });
    res.json({ data: cards });
  }),
);

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

// DELETE /admin/cards/:id － 停用追蹤（soft delete）；帶 ?hard=true 則永久刪除（連同 sources/snapshots，DB cascade 處理）
router.delete(
  '/cards/:id',
  asyncHandler(async (req, res) => {
    if (req.query.hard === 'true') {
      await prisma.card.delete({ where: { id: req.params.id } });
      return res.json({ data: { id: req.params.id, deleted: true } });
    }
    await prisma.card.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ data: { id: req.params.id, isActive: false } });
  }),
);

// POST /admin/cards/:id/sources － 為卡牌新增價格來源
router.post(
  '/cards/:id/sources',
  asyncHandler(async (req, res) => {
    const card = await prisma.card.findUnique({ where: { id: req.params.id } });
    if (!card) throw notFound('找不到這張卡牌');
    
    const data = createSourceSchema.parse(req.body);
    const source = await prisma.priceSource.create({
      data: { ...data, cardId: req.params.id },
    });
    res.status(201).json({ data: source });
  }),
);

// GET /admin/cards/:id/sources － 查看某張卡所有來源（含停用）
router.get(
  '/cards/:id/sources',
  asyncHandler(async (req, res) => {
    const card = await prisma.card.findUnique({ where: { id: req.params.id } });
    if (!card) throw notFound('找不到這張卡牌');
    const sources = await prisma.priceSource.findMany({
      where: { cardId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ data: sources });
  }),
);

// DELETE /admin/sources/:id － 停用來源（soft delete）
router.delete(
  '/sources/:id',
  asyncHandler(async (req, res) => {
    const source = await prisma.priceSource.findUnique({ where: { id: req.params.id } });
    if (!source) throw notFound('找不到這個來源');
    await prisma.priceSource.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ data: { id: req.params.id, isActive: false } });
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
