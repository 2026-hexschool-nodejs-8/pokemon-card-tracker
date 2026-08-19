import { importSummarySchema, importSearchSummarySchema } from '@pct/shared';
import { registry, z, jsonResponse, errorResponses } from './registry.js';

// OpenAPI 友善版：避免 coerce / catch / transform（ZodEffects）
const importTcgplayerBodyOpenApi = z.object({
  page: z.number().int().min(1).optional().openapi({ description: '搜尋頁碼，預設 1' }),
  limit: z.number().int().min(1).max(50).optional().openapi({ description: '匯入上限，預設 10、最大 50' }),
});

const importTcgplayerSearchBodyOpenApi = z.object({
  name: z.string().min(1).openapi({ description: '卡牌名稱' }),
  limit: z.number().int().min(1).max(20).optional().openapi({ description: '匯入上限，預設 5、最大 20' }),
});

registry.registerPath({
  method: 'post',
  path: '/admin/import/tcgplayer',
  tags: ['Admin / Import'],
  summary: '依頁碼批次匯入 TCGPlayer 卡牌',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: importTcgplayerBodyOpenApi } } },
  },
  responses: {
    200: jsonResponse(importSummarySchema, '匯入摘要'),
    ...errorResponses([400, 401, 500]),
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/import/tcgplayer/search',
  tags: ['Admin / Import'],
  summary: '依卡名搜尋並匯入 TCGPlayer 卡牌',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: importTcgplayerSearchBodyOpenApi } } },
  },
  responses: {
    200: jsonResponse(importSearchSummarySchema, '搜尋匯入摘要（搜不到時 jobId 為 null）'),
    ...errorResponses([400, 401, 500]),
  },
});
