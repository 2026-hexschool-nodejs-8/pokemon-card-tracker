import { z } from 'zod';
import { extendZodWithOpenApi, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { dataEnvelope, errorResponseSchema } from '@pct/shared';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

export const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

registry.register('ErrorResponse', errorResponseSchema);

/** JSON 成功回應：{ data: T } */
export function jsonResponse(schema, description = '成功') {
  return {
    description,
    content: {
      'application/json': {
        schema: dataEnvelope(schema),
      },
    },
  };
}

/** 常見錯誤回應（400 / 401 / 404 / 409 / 500） */
export function errorResponses(statuses = [400, 401, 404, 500]) {
  const descriptions = {
    400: '輸入資料驗證失敗',
    401: '未授權',
    404: '找不到資源',
    409: '衝突',
    500: '伺服器錯誤',
  };
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      {
        description: descriptions[status] || String(status),
        content: {
          'application/json': {
            schema: errorResponseSchema,
          },
        },
      },
    ]),
  );
}

export { z };
