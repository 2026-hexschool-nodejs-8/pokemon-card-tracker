import express from 'express';
import cors from 'cors';

import healthRouter from './routes/health.js';
import cardsRouter from './routes/cards.js';
import authRouter from './routes/auth.js';
import adminCardsRouter from './routes/admin.cards.js';
import adminJobsRouter from './routes/admin.jobs.js';
import adminImportRouter from './routes/admin.import.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.use(cors({ origin: origins }));
  app.use(express.json());

  // 公開
  app.use('/health', healthRouter);
  app.use('/cards', cardsRouter);

  // 後台（auth 先掛，避免被 /admin 攔截）
  app.use('/admin/auth', authRouter);
  app.use('/admin', adminCardsRouter);
  app.use('/admin', adminJobsRouter);
  app.use('/admin/import', adminImportRouter);

  // 收尾
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
