import { z } from 'zod';
import { priceSourceSchema } from './source.response.js';

export const cardSchema = z.object({
  id: z.string(),
  name: z.string(),
  cardNumber: z.string(),
  setName: z.string().nullable(),
  language: z.string(),
  condition: z.string(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  latestPrice: z.number().nullable(),
  latestCurrency: z.string().nullable(),
  latestPriceTwd: z.number().nullable(),
  lastFetchedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const cardWithSourcesSchema = cardSchema.extend({
  sources: z.array(priceSourceSchema),
});

export const latestSourcePriceSchema = z.object({
  sourceId: z.string(),
  provider: z.string(),
  price: z.number(),
  currency: z.string(),
  priceTwd: z.number().nullable(),
  rawText: z.string().nullable(),
  fetchedAt: z.string().datetime(),
  isStale: z.boolean(),
});

// 前台列表／詳情在查詢時附加的多來源平均價（不寫入 Card 欄位）
export const publicCardSchema = cardSchema.extend({
  averagePriceTwd: z.number().nullable(),
  averagePriceSourceCount: z.number().int(),
  averagePriceMaxAgeDays: z.number().int(),
  latestSourcePrices: z.array(latestSourcePriceSchema),
});

export const publicCardWithSourcesSchema = publicCardSchema.extend({
  sources: z.array(priceSourceSchema),
});

export const adminCardListItemSchema = cardSchema.extend({
  _count: z.object({
    sources: z.number().int(),
  }),
});

// GET /admin/cards － { data } 信封外加 nextCursor（無下一批時為 null）
export const adminCardListResponseSchema = z.object({
  data: z.array(adminCardListItemSchema),
  nextCursor: z.string().nullable(),
});

export const deactivateLastSourceResultSchema = z.object({
  source: priceSourceSchema,
  card: cardSchema,
});

export const priceSnapshotSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  sourceId: z.string(),
  provider: z.string(),
  price: z.number(),
  currency: z.string(),
  priceTwd: z.number().nullable(),
  rawText: z.string().nullable(),
  fetchedAt: z.string().datetime(),
  isSuspicious: z.boolean(),
  createdAt: z.string().datetime(),
});

export const priceChangeWindowSchema = z.object({
  diffTwd: z.number(),
  pct: z.number(),
  basisFetchedAt: z.string().datetime(),
});

export const priceSummarySchema = z.object({
  latestPrice: z.number().nullable(),
  latestCurrency: z.string().nullable(),
  latestPriceTwd: z.number().nullable(),
  fetchedAt: z.string().datetime().nullable(),
  change7d: priceChangeWindowSchema.nullable(),
  change30d: priceChangeWindowSchema.nullable(),
});

// TCGPlayer infinite-api 的 passthrough 形狀，保持寬鬆；整包可為 null
export const tcgplayerHistoryBucketSchema = z
  .object({
    marketPrice: z.number().optional(),
    date: z.string().optional(),
    bucketStartDate: z.string().optional(),
    quantitySold: z.number().optional(),
  })
  .passthrough();

export const tcgplayerHistorySchema = z
  .object({
    condition: z.string().optional(),
    variant: z.string().optional(),
    language: z.string().optional(),
    buckets: z.array(tcgplayerHistoryBucketSchema).optional(),
  })
  .passthrough()
  .nullable();

export const softDeleteCardResultSchema = z.object({
  id: z.string(),
  isActive: z.literal(false),
});

export const hardDeleteCardResultSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
});

export const deleteCardResultSchema = z.union([
  softDeleteCardResultSchema,
  hardDeleteCardResultSchema,
]);
