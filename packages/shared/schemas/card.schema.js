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
