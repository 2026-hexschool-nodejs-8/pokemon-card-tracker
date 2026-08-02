// 卡牌相關 Zod schema － Express 驗證 request、React 驗證表單，共用同一份
import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../constants/index.js';

export const createCardSchema = z.object({
  name: z.string().min(1, '請輸入卡牌名稱'),
  cardNumber: z.string().min(1, '請輸入卡號'),
  setName: z.string().optional(),
  language: z.enum(SUPPORTED_LANGUAGES).default('ja'),
  condition: z.string().default('raw'),
  imageUrl: z.string().url('圖片網址格式不正確').optional().or(z.literal('')),
  isActive: z.boolean().default(true),
});

// 編輯：所有欄位皆為選填
export const updateCardSchema = createCardSchema.partial();

// 前台列表查詢參數
export const listCardsQuerySchema = z.object({
  keyword: z.string().optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  grade: z.string().optional(),
});

// 後台列表查詢參數（多一個 isActive 篩選，不帶時回傳全部）
export const adminListCardsQuerySchema = listCardsQuerySchema.extend({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// 卡牌歷史價格查詢參數（GET /cards/:id/prices）
// from/to 用 z.coerce.date() 擋掉非法日期字串，避免直接傳進 Prisma 產生未預期的 500
export const cardPricesQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  source: z.string().optional(),
});

// TCGPlayer 歷史價格查詢參數（GET /cards/:id/tcgplayer-history）
// range 白名單，避免未經檢查的字串被直接串進外部 API 的 query string
export const cardTcgplayerHistoryQuerySchema = z.object({
  range: z.enum(['month', 'quarter', 'annual']).default('quarter'),
});
