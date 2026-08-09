import { z } from 'zod';
import { SOURCE_TYPE } from '../../constants/index.js';

export const priceSourceSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  type: z.enum([SOURCE_TYPE.API, SOURCE_TYPE.CRAWLER]),
  provider: z.string(),
  url: z.string().nullable(),
  externalId: z.string().nullable(),
  currency: z.string(),
  isActive: z.boolean(),
  lastSuccessAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const softDeleteSourceResultSchema = z.object({
  id: z.string(),
  isActive: z.literal(false),
});
