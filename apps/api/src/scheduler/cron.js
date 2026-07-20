// 定時排程 － PRD FR-12，使用 node-cron 每日自動抓價 + 更新匯率
import cron from 'node-cron';
import { JOB_TRIGGER_TYPE } from '@pct/shared';
import { runPriceSync } from '../services/priceSync.service.js';
import { runCurrencySync } from '../services/currencySync.service.js';
import { logger } from '../lib/logger.js';

export function startCron() {
  if (process.env.ENABLE_CRON === 'false') {
    logger.info('ENABLE_CRON=false，已停用自動排程（仍可手動觸發）');
    return null;
  }

  // ── 匯率更新（預設 01:00，早於抓價，確保清洗時匯率是新的）──
  const currencyExpr = process.env.CURRENCY_SYNC_CRON || '0 1 * * *';
  let currencyTask = null;
  if (cron.validate(currencyExpr)) {
    currencyTask = cron.schedule(currencyExpr, async () => {
      logger.info(`⏰ Cron 觸發匯率更新（${currencyExpr}）`);
      try {
        await runCurrencySync();
      } catch (err) {
        logger.error('Cron 匯率更新失敗：', err.message);
      }
    });
    logger.info(`匯率排程已啟動：${currencyExpr}`);
  } else {
    logger.warn(`CURRENCY_SYNC_CRON 格式錯誤：${currencyExpr}，已停用匯率排程`);
  }

  // ── 抓價 ──
  const expr = process.env.PRICE_SYNC_CRON || '0 2 * * *';
  if (!cron.validate(expr)) {
    logger.warn(`PRICE_SYNC_CRON 格式錯誤：${expr}，已停用抓價排程`);
    return { priceTask: null, currencyTask };
  }

  const priceTask = cron.schedule(expr, async () => {
    logger.info(`⏰ Cron 觸發抓價（${expr}）`);
    try {
      await runPriceSync({ triggerType: JOB_TRIGGER_TYPE.CRON });
    } catch (err) {
      logger.error('Cron 抓價失敗：', err.message);
    }
  });

  logger.info(`抓價排程已啟動：${expr}`);
  return { priceTask, currencyTask };
}
