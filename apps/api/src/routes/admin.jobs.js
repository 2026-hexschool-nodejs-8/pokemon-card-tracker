// 後台抓價任務 － PRD 建議 API「Admin Jobs」段
import { Router } from 'express';
import { prisma } from '@pct/db';
import { JOB_TRIGGER_TYPE } from '@pct/shared';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { runPriceSync } from '../services/priceSync.service.js';

const router = Router();
router.use(adminAuth);

// POST /admin/jobs/price-sync － 手動觸發全部卡牌更新
router.post(
  '/jobs/price-sync',
  asyncHandler(async (_req, res) => {
    const job = await runPriceSync({ triggerType: JOB_TRIGGER_TYPE.MANUAL });
    res.status(202).json({ data: job });
  }),
);

// POST /admin/cards/:id/price-sync － 手動觸發單張卡牌更新
router.post(
  '/cards/:id/price-sync',
  asyncHandler(async (req, res) => {
    const job = await runPriceSync({ triggerType: JOB_TRIGGER_TYPE.MANUAL, cardId: req.params.id });
    res.status(202).json({ data: job });
  }),
);

// GET /admin/jobs － job 列表（最近 50 筆）
router.get(
  '/jobs',
  asyncHandler(async (_req, res) => {
    const jobs = await prisma.priceFetchJob.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    res.json({ data: jobs });
  }),
);

// GET /admin/jobs/:id － job 詳情與明細 log
router.get(
  '/jobs/:id',
  asyncHandler(async (req, res) => {
    const job = await prisma.priceFetchJob.findUnique({
      where: { id: req.params.id },
      include: { logs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!job) return res.status(404).json({ error: '找不到這個 job' });
    res.json({ data: job });
  }),
);

export default router;
