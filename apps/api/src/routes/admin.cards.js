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
import { adminListCards, deactivateLastSource, updateSource } from '../services/card.service.js';

const router = Router();
router.use(adminAuth);

// GET /admin/cards?keyword=&language=&grade=&isActive=true|false&cursor=&limit=
// cursor 分頁供無限滾動；回應加法式新增 nextCursor（無更多為 null）
router.get(
  '/cards',
  asyncHandler(async (req, res) => {
    const params = adminListCardsQuerySchema.parse(req.query);
    const { data, nextCursor } = await adminListCards(params);
    res.json({ data, nextCursor });
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

// PATCH /admin/sources/:id/deactivate-last － 關閉「最後一個啟用來源」（交易連動停用來源 + 卡片）
// 僅在前端確認 modal 通過後呼叫；防呆守衛不成立回 409，任一步失敗整筆 rollback（FR-015/FR-016）
router.patch(
  '/sources/:id/deactivate-last',
  asyncHandler(async (req, res) => {
    const data = await deactivateLastSource(req.params.id);
    res.json({ data });
  }),
);

// PATCH /admin/sources/:id － 編輯價格來源
// 關掉「最後一個啟用來源」須改走上面的 deactivate-last（會連動停用卡片），這裡回 409 擋下
router.patch(
  '/sources/:id',
  asyncHandler(async (req, res) => {
    const data = updateSourceSchema.parse(req.body);
    const source = await updateSource(req.params.id, data);
    res.json({ data: source });
  }),
);

export default router;
