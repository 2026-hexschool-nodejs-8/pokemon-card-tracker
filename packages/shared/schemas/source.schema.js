// 價格來源相關 Zod schema
import { z } from 'zod';
import { SOURCE_TYPE, SUPPORTED_CURRENCIES } from '../constants/index.js';

export const createSourceSchema = z
  .object({
    type: z.enum([SOURCE_TYPE.API, SOURCE_TYPE.CRAWLER]),
    provider: z.string().min(1, '請輸入來源名稱'),
    url: z.string().url('來源網址格式不正確').optional(),
    externalId: z.string().optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).default('JPY'),
    isActive: z.boolean().default(true),
  })
  .refine(
    (data) => (data.type === SOURCE_TYPE.CRAWLER ? !!data.url : true),
    { message: 'crawler 來源必須提供 url', path: ['url'] },
  )
  .refine(
    (data) => (data.type === SOURCE_TYPE.API ? !!(data.url || data.externalId) : true),
    { message: 'api 來源必須提供 url 或 externalId', path: ['externalId'] },
  );

export const updateSourceSchema = z.object({
  provider: z.string().min(1).optional(),
  url: z.string().url().optional(),
  externalId: z.string().optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  isActive: z.boolean().optional(),
});
