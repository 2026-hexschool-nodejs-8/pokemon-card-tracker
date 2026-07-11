// 進入點：啟動 Express server 與排程
import '@pct/shared/load-env';
import { createApp } from './app.js';
import { startCron } from './scheduler/cron.js';
import { logger } from './lib/logger.js';

const PORT = Number(process.env.PORT) || 3000;

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info(`🚀 API 已啟動：http://localhost:${PORT}`);
  logger.info(`   健康檢查：http://localhost:${PORT}/health`);
  startCron();
});

// 優雅關閉
const shutdown = (signal) => {
  logger.info(`收到 ${signal}，關閉 server...`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
