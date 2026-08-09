import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';

import healthRouter from './routes/health.js';
import cardsRouter from './routes/cards.js';
import authRouter from './routes/auth.js';
import adminCardsRouter from './routes/admin.cards.js';
import adminJobsRouter from './routes/admin.jobs.js';
import adminImportRouter from './routes/admin.import.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { buildOpenApiDocument } from './docs/openapi.js';

// 掛載表：覆蓋率測試與 createApp 共用，避免兩邊各自維護一份路徑
export const ROUTE_MOUNTS = [
  ['/health', healthRouter],
  ['/cards', cardsRouter],
  // auth 先掛，避免被 /admin 攔截
  ['/admin/auth', authRouter],
  ['/admin', adminCardsRouter],
  ['/admin', adminJobsRouter],
  ['/admin/import', adminImportRouter],
];

// 僅在明確開啟時掛文件；正式環境預設關閉，避免攤開後台端點
export function shouldEnableApiDocs() {
  return process.env.ENABLE_API_DOCS === 'true';
}

export function createApp() {
  const app = express();

  const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.use(cors({ origin: origins }));
  app.use(express.json());

  for (const [basePath, router] of ROUTE_MOUNTS) {
    app.use(basePath, router);
  }

  if (shouldEnableApiDocs()) {
    const openApiDocument = buildOpenApiDocument();
    app.get('/docs.json', (_req, res) => res.json(openApiDocument));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }

  // 收尾
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
