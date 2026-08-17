import {
  createCardSchema,
  updateCardSchema,
  createSourceSchema,
  updateSourceSchema,
  listCardsQuerySchema,
  cardSchema,
  adminCardListResponseSchema,
  priceSourceSchema,
  deleteCardResultSchema,
  softDeleteSourceResultSchema,
  deactivateLastSourceResultSchema,
} from '@pct/shared';
import { registry, z, jsonResponse, errorResponses } from './registry.js';

const idParams = z.object({ id: z.string() });

// OpenAPI 友善版：避開 .transform() / z.coerce（ZodEffects 無法轉 OpenAPI）
const adminListCardsQueryOpenApi = listCardsQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional().openapi({
    description: '上一批最後一張卡的 id（cuid）；不帶則從第一批',
  }),
  limit: z.string().optional().openapi({
    description: '單批數量，預設 20、上限 50',
  }),
});

const hardDeleteQuery = z.object({
  hard: z.enum(['true', 'false']).optional().openapi({
    description: '設為 true 時永久刪除（含 sources / snapshots）',
  }),
});

registry.registerPath({
  method: 'get',
  path: '/admin/cards',
  tags: ['Admin / Cards'],
  summary: '後台卡牌列表（cursor 分頁）',
  description:
    '無限滾動用 cursor 分頁。回應為 { data, nextCursor }：nextCursor 為下一批起點，已到底時為 null。',
  security: [{ bearerAuth: [] }],
  request: { query: adminListCardsQueryOpenApi },
  responses: {
    200: {
      description: '含停用卡牌與來源數量；加法式 nextCursor（無信封套疊）',
      content: { 'application/json': { schema: adminCardListResponseSchema } },
    },
    ...errorResponses([400, 401]),
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/cards',
  tags: ['Admin / Cards'],
  summary: '新增卡牌',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: createCardSchema } } },
  },
  responses: {
    201: jsonResponse(cardSchema, '建立成功'),
    ...errorResponses([400, 401]),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/admin/cards/{id}',
  tags: ['Admin / Cards'],
  summary: '更新卡牌',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: { content: { 'application/json': { schema: updateCardSchema } } },
  },
  responses: {
    200: jsonResponse(cardSchema, '更新後的卡牌'),
    ...errorResponses([400, 401, 404]),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/admin/cards/{id}',
  tags: ['Admin / Cards'],
  summary: '停用或永久刪除卡牌',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    query: hardDeleteQuery,
  },
  responses: {
    200: jsonResponse(deleteCardResultSchema, '軟刪除或硬刪除結果'),
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/cards/{id}/sources',
  tags: ['Admin / Cards'],
  summary: '查詢卡牌的價格來源',
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: jsonResponse(z.array(priceSourceSchema), '含停用來源'),
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/cards/{id}/sources',
  tags: ['Admin / Cards'],
  summary: '為卡牌新增價格來源',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: { content: { 'application/json': { schema: createSourceSchema } } },
  },
  responses: {
    201: jsonResponse(priceSourceSchema, '建立成功'),
    ...errorResponses([400, 401, 404]),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/admin/sources/{id}/deactivate-last',
  tags: ['Admin / Cards'],
  summary: '關閉最後一個啟用來源（連動停用卡片）',
  description:
    '僅在該來源確實是該卡最後一個啟用來源時成功；同一交易內停用來源與卡片。守衛不成立回 409。',
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: jsonResponse(deactivateLastSourceResultSchema, '已停用的來源與卡片'),
    ...errorResponses([401, 404, 409]),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/admin/sources/{id}',
  tags: ['Admin / Cards'],
  summary: '更新價格來源',
  description:
    '若此次要把該卡最後一個啟用來源關掉，請改打 deactivate-last；本路徑會回 409 擋下。',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: { content: { 'application/json': { schema: updateSourceSchema } } },
  },
  responses: {
    200: jsonResponse(priceSourceSchema, '更新後的來源'),
    ...errorResponses([400, 401, 404, 409]),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/admin/sources/{id}',
  tags: ['Admin / Cards'],
  summary: '停用價格來源',
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: jsonResponse(softDeleteSourceResultSchema, '軟刪除結果'),
    ...errorResponses([401, 404]),
  },
});
