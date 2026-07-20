// 全專案共用常數 － 與 Prisma enum 的字串值保持一致

export const SOURCE_TYPE = Object.freeze({
  API: 'api',
  CRAWLER: 'crawler',
});

export const JOB_TRIGGER_TYPE = Object.freeze({
  MANUAL: 'manual',
  CRON: 'cron',
});

export const JOB_STATUS = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  PARTIAL_SUCCESS: 'partial_success',
  FAILED: 'failed',
});

export const LOG_STATUS = Object.freeze({
  SUCCESS: 'success',
  FAILED: 'failed',
});

export const SUPPORTED_LANGUAGES = ['ja', 'en', 'zh'];

export const SUPPORTED_CURRENCIES = ['JPY', 'USD', 'HKD', 'TWD'];

// 匯率換算基準：全部價格統一轉台幣（W2 會議決策）
export const BASE_CURRENCY = 'TWD';

// 需向匯率 API 抓「對台幣匯率」的外幣（USD/JPY/HKD）
export const FOREIGN_CURRENCIES = ['USD', 'JPY', 'HKD'];
