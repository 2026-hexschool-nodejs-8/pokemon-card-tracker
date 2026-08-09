import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry.js';

// 匯入以觸發 registerPath
import './paths.public.js';
import './paths.auth.js';
import './paths.adminCards.js';
import './paths.adminJobs.js';
import './paths.adminImport.js';

export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: '寶可夢卡牌價格追蹤器 API',
      version: '1.0.0',
      description:
        '公開卡牌查詢與後台管理 API。成功 JSON 回應一律為 { data: T }（/health 除外）；錯誤為 { error, issues? }。後台端點需 Authorization: Bearer <token>。',
    },
    servers: [{ url: 'http://localhost:3000', description: '本機開發' }],
  });
}
