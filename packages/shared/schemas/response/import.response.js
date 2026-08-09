import { z } from 'zod';

export const importResultItemSchema = z.object({
  productId: z.union([z.string(), z.number()]),
  status: z.enum(['imported', 'skipped', 'failed']),
  cardId: z.string().optional(),
  name: z.string().optional(),
  price: z.number().nullable().optional(),
  salesCount: z.number().int().optional(),
  error: z.string().optional(),
});

export const importSummarySchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  results: z.array(importResultItemSchema),
  jobId: z.string(),
});

// 搜尋匯入：兩條分支欄位一致（沒結果時 jobId / message 仍存在）
export const importSearchSummarySchema = z.object({
  imported: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  results: z.array(importResultItemSchema),
  jobId: z.string().nullable(),
  searchName: z.string(),
  message: z.string().nullable(),
});
