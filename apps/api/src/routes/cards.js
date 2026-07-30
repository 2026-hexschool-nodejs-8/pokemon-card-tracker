// 前台公開 API － PRD FR-03 / FR-04 / 建議 API Public 段
import { Router } from 'express';
import { listCardsQuerySchema } from '@pct/shared';
import { listCards, getCardById, getCardPrices, getCardPriceSummary } from '../services/card.service.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// CSV 欄位跳脫：避免逗號、換行、雙引號破壞欄位格式
function escapeCsv(value) {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// 將單張卡牌與歷史價格組成 CSV 內容
function buildPricesCsv(card, prices) {
  const headers = [
    'cardName',
    'cardNumber',
    'setName',
    'language',
    'condition',
    'provider',
    'price',
    'currency',
    'priceTwd',
    'fetchedAt',
    'isSuspicious',
    'rawText',
  ];

  const rows = prices.map((p) => [
    card.name,
    card.cardNumber,
    card.setName,
    card.language,
    card.condition,
    p.provider,
    p.price,
    p.currency,
    p.priceTwd,
    p.fetchedAt,
    p.isSuspicious,
    p.rawText,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}

// 產生安全的下載檔名，避開常見檔名保留字元
function csvFilename(card) {
  const safeName = `${card.name}-${card.cardNumber}`
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${safeName || 'card-prices'}.csv`;
}

// Content-Disposition 的 filename 只能穩定放 ASCII，filename* 用 UTF-8 保留中文/日文檔名
function csvContentDisposition(filename) {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '-');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

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

// GET /cards/:id/prices/summary － 7 / 30 天漲跌幅
router.get(
  '/:id/prices/summary',
  asyncHandler(async (req, res) => {
    const summary = await getCardPriceSummary(req.params.id);
    res.json({ data: summary });
  }),
);

// GET /cards/:id/prices.csv?from=&to=&source= － 匯出卡牌歷史價格 CSV
router.get(
  '/:id/prices.csv',
  asyncHandler(async (req, res) => {
    const card = await getCardById(req.params.id);
    const prices = await getCardPrices(req.params.id, req.query);
    const csv = buildPricesCsv(card, prices);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', csvContentDisposition(csvFilename(card)));
    // 加上 UTF-8 BOM，讓 Excel 開啟中文欄位時不亂碼
    res.send(`\uFEFF${csv}`);
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
