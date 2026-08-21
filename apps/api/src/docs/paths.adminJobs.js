import {
  priceFetchJobSchema,
  jobWithLogsSchema,
  clearStuckResultSchema,
} from '@pct/shared';
import { registry, z, jsonResponse, errorResponses } from './registry.js';

const idParams = z.object({ id: z.string() });

registry.registerPath({
  method: 'post',
  path: '/admin/jobs/price-sync',
  tags: ['Admin / Jobs'],
  summary: '手動觸發全部卡牌抓價',
  security: [{ bearerAuth: [] }],
  responses: {
    202: jsonResponse(jobWithLogsSchema, '抓價任務結果'),
    ...errorResponses([401, 409]),
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/cards/{id}/price-sync',
  tags: ['Admin / Jobs'],
  summary: '手動觸發單張卡牌抓價',
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    202: jsonResponse(jobWithLogsSchema, '抓價任務結果'),
    ...errorResponses([401, 404, 409]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/jobs',
  tags: ['Admin / Jobs'],
  summary: '查詢最近抓價任務',
  description: '回傳最近 50 筆，依 startedAt 降序。',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse(z.array(priceFetchJobSchema), '任務列表（不含 logs）'),
    ...errorResponses([401]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/jobs/{id}',
  tags: ['Admin / Jobs'],
  summary: '查詢抓價任務詳情',
  security: [{ bearerAuth: [] }],
  request: { params: idParams },
  responses: {
    200: jsonResponse(jobWithLogsSchema, '任務詳情與明細 log'),
    ...errorResponses([401, 404]),
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/jobs/clear-stuck',
  tags: ['Admin / Jobs'],
  summary: '清除卡住的 RUNNING 任務',
  description: '將所有 status=running 的 job 強制結算為 failed。',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse(clearStuckResultSchema, '清除結果'),
    ...errorResponses([401]),
  },
});
