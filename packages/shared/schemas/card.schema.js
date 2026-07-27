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
// 新增 cursor / limit 供無限滾動 cursor 分頁（回應為加法式新增 nextCursor）
export const adminListCardsQuerySchema = listCardsQuerySchema.extend({
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  // 上一批最後一張卡的 id（cuid）；不帶=從第一批
  cursor: z.string().cuid().optional(),
  // 單批數量：字串轉正整數、預設 20、上限 50（超過即夾為 50）
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(20)
    .transform((n) => Math.min(n, 50)),
});
