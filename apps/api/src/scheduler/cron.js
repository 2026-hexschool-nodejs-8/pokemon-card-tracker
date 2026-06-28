// 定時排程 － PRD FR-12，使用 node-cron 每日自動抓價
import cron from 'node-cron';
import { JOB_TRIGGER_TYPE } from '@pct/shared';
import { runPriceSync } from '../services/priceSync.service.js';
import { logger } from '../lib/logger.js';

export function startCron() {
  if (process.env.ENABLE_CRON === 'false') {
    logger.info('ENABLE_CRON=false，已停用自動排程（仍可手動觸發）');
    return null;
  }

  const expr = process.env.PRICE_SYNC_CRON || '0 2 * * *';
  if (!cron.validate(expr)) {
    logger.warn(`PRICE_SYNC_CRON 格式錯誤：${expr}，已停用排程`);
    return null;
  }

  const task = cron.schedule(expr, async () => {
    logger.info(`⏰ Cron 觸發抓價（${expr}）`);
    try {
      await runPriceSync({ triggerType: JOB_TRIGGER_TYPE.CRON });
    } catch (err) {
      logger.error('Cron 抓價失敗：', err.message);
    }
  });

  logger.info(`排程已啟動：${expr}`);
  return task;
}
