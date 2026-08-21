import { loginSchema, adminProfileSchema, loginResultSchema } from '@pct/shared';
import { registry, jsonResponse, errorResponses } from './registry.js';

registry.registerPath({
  method: 'post',
  path: '/admin/auth/login',
  tags: ['Auth'],
  summary: '管理者登入',
  request: {
    body: {
      content: {
        'application/json': { schema: loginSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(loginResultSchema, 'JWT 與管理者資料'),
    ...errorResponses([400, 401]),
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/auth/me',
  tags: ['Auth'],
  summary: '取得目前登入管理者',
  description: '驗證 token，並確認帳號仍存在於資料庫。',
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonResponse(adminProfileSchema, '管理者 profile'),
    ...errorResponses([401]),
  },
});
