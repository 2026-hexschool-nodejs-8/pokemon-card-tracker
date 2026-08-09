// 前台公開 API － PRD FR-03 / FR-04 / 建議 API Public 段
import { Router } from 'express';
import { listCardsQuerySchema, cardPricesQuerySchema, cardTcgplayerHistoryQuerySchema } from '@pct/shared';
import {
  listCards,
  getCardById,
  getCardPrices,
  getCardPriceSummary,
  getTcgplayerPriceHistory,
} from '../services/card.service.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// Excel / Google Sheets 會把這些開頭視為公式，CSV 匯出前需先處理
const FORMULA_START = /^[=+\-@\t\r]/;

// CSV 欄位跳脫：避免欄位格式被破壞，並防止試算表將文字當公式執行
function escapeCsv(value) {
  if (value == null) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // 前面補單引號，讓試算表把它視為純文字而不是公式
  if (FORMULA_START.test(text)) text = `'${text}`;
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

// filename* 採 RFC 5987；補 encodeURIComponent 不會處理的五個保留字元
function encodeRfc5987Value(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Content-Disposition 的 filename 只能穩定放 ASCII，filename* 用 UTF-8 保留中文/日文檔名
function csvContentDisposition(filename) {
  // filename 給舊瀏覽器 ASCII fallback；中文 / 日文檔名由 filename* 負責
  const fallback = filename.replace(/[^\x20-\x7E]/g, '-');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987Value(filename)}`;
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
    // 先查 card：CSV 需要卡名 / 卡號組檔名與表格欄位
    const card = await getCardById(req.params.id);
    // CSV 匯出沿用歷史價格查詢參數驗證（from / to / source）
    const query = cardPricesQuerySchema.parse(req.query);
    // card 已在上方確認存在，這裡跳過 getCardPrices 內部的重複 card 查詢
    const prices = await getCardPrices(req.params.id, query, { skipCardCheck: true });
    const csv = buildPricesCsv(card, prices);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // attachment 讓瀏覽器下載檔案；csvContentDisposition 負責處理非 ASCII 檔名
    res.setHeader('Content-Disposition', csvContentDisposition(csvFilename(card)));
    // 加上 UTF-8 BOM，讓 Excel 開啟中文欄位時不亂碼
    res.send(`\uFEFF${csv}`);
  }),
);

// GET /cards/:id/prices?from=&to=&source=
router.get(
  '/:id/prices',
  asyncHandler(async (req, res) => {
    const query = cardPricesQuerySchema.parse(req.query);
    const prices = await getCardPrices(req.params.id, query);
    res.json({ data: prices });
  }),
);

// GET /cards/:id/tcgplayer-history?range=month|quarter|annual
router.get(
  '/:id/tcgplayer-history',
  asyncHandler(async (req, res) => {
    const { range } = cardTcgplayerHistoryQuerySchema.parse(req.query);
    const result = await getTcgplayerPriceHistory(req.params.id, range);
    res.json({ data: result });
  }),
);

export default router;