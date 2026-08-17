import {
  listCardsQuerySchema,
  healthSchema,
  publicCardSchema,
  publicCardWithSourcesSchema,
  priceSnapshotSchema,
  priceSummarySchema,
  tcgplayerHistorySchema,
} from '@pct/shared';
import { registry, z, jsonResponse, errorResponses } from './registry.js';

const idParams = z.object({ id: z.string().openapi({ description: '卡牌 ID' }) });

// OpenAPI 友善版：避免 z.coerce.date()（ZodEffects）讓文件產生失敗
const cardPricesQueryOpenApi = z.object({
  from: z.string().datetime().optional().openapi({ description: '起始時間（ISO 8601）' }),
  to: z.string().datetime().optional().openapi({ description: '結束時間（ISO 8601）' }),
  source: z.string().optional().openapi({ description: '依 provider 篩選' }),
});

const tcgplayerHistoryQueryOpenApi = z.object({
  range: z.enum(['month', 'quarter', 'annual']).default('quarter'),
});

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: '服務健康檢查',
  description: '基礎設施探針，回應不套用 { data } 信封。',
  responses: {
    200: {
      description: '服務正常',
      content: { 'application/json': { schema: healthSchema } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/cards',
  tags: ['Cards'],
  summary: '查詢卡牌列表',
  request: { query: listCardsQuerySchema },
  responses: {
    200: jsonResponse(z.array(publicCardSchema), '卡牌列表（含各來源最新價與平均價）'),
    ...errorResponses([400]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/cards/{id}',
  tags: ['Cards'],
  summary: '查詢單張卡牌',
  request: { params: idParams },
  responses: {
    200: jsonResponse(publicCardWithSourcesSchema, '卡牌詳情（含啟用中的來源、各來源最新價與平均價）'),
    ...errorResponses([404]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/cards/{id}/prices/summary',
  tags: ['Cards'],
  summary: '查詢卡牌價格漲跌摘要',
  request: { params: idParams },
  responses: {
    200: jsonResponse(priceSummarySchema, '7 / 30 日漲跌幅'),
    ...errorResponses([404]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/cards/{id}/prices',
  tags: ['Cards'],
  summary: '查詢卡牌歷史價格',
  request: {
    params: idParams,
    query: cardPricesQueryOpenApi,
  },
  responses: {
    200: jsonResponse(z.array(priceSnapshotSchema), '歷史價格快照'),
    ...errorResponses([400, 404]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/cards/{id}/prices.csv',
  tags: ['Cards'],
  summary: '匯出卡牌歷史價格 CSV',
  request: {
    params: idParams,
    query: cardPricesQueryOpenApi,
  },
  responses: {
    200: {
      description: 'CSV 檔案（含 UTF-8 BOM）',
      content: {
        'text/csv': {
          schema: z.string().openapi({ type: 'string', format: 'binary' }),
        },
      },
    },
    ...errorResponses([400, 404]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/cards/{id}/tcgplayer-history',
  tags: ['Cards'],
  summary: '查詢 TCGPlayer 歷史價格',
  request: {
    params: idParams,
    query: tcgplayerHistoryQueryOpenApi,
  },
  responses: {
    200: jsonResponse(tcgplayerHistorySchema, 'TCGPlayer 歷史資料；無來源或外部失敗時為 null'),
    ...errorResponses([400, 404]),
  },
});
