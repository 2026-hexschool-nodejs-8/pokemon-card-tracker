import {
  createCardSchema,
  updateCardSchema,
  createSourceSchema,
  updateSourceSchema,
  listCardsQuerySchema,
  cardSchema,
  adminCardListItemSchema,
  priceSourceSchema,
  deleteCardResultSchema,
  softDeleteSourceResultSchema,
} from '@pct/shared';
import { registry, z, jsonResponse, errorResponses } from './registry.js';

const idParams = z.object({ id: z.string() });

// OpenAPI 友善版：isActive 維持 query 字串 enum，不帶 .transform()
const adminListCardsQueryOpenApi = listCardsQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
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
  summary: '後台卡牌列表',
  security: [{ bearerAuth: [] }],
  request: { query: adminListCardsQueryOpenApi },
  responses: {
    200: jsonResponse(z.array(adminCardListItemSchema), '含停用卡牌與來源數量'),
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
  path: '/admin/sources/{id}',
  tags: ['Admin / Cards'],
  summary: '更新價格來源',
  security: [{ bearerAuth: [] }],
  request: {
    params: idParams,
    body: { content: { 'application/json': { schema: updateSourceSchema } } },
  },
  responses: {
    200: jsonResponse(priceSourceSchema, '更新後的來源'),
    ...errorResponses([400, 401, 404]),
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
