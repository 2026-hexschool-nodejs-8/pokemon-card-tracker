// 匯率來源 adapter － 對外打匯率 API 的細節都收在這裡（回應 review：對外 API 放 adapters、lib 留純工具）。
// 不進 registry：registry 管的是「卡牌價格來源」，匯率不是價格來源，由 currencySync 直接使用。
//
// 來源預設 open.er-api.com（免費、免金鑰、支援 TWD）。
// 回傳「1 單位外幣 = 幾元台幣」（rateToTwd），供 currencySync 寫入 Currency 表。
import { BASE_CURRENCY, FOREIGN_CURRENCIES } from '@pct/shared';

const DEFAULT_BASE_URL = 'https://open.er-api.com/v6/latest';
const FETCH_TIMEOUT_MS = Number(process.env.EXCHANGE_RATE_TIMEOUT_MS) || 10000;

export class ExchangeRateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ExchangeRateError';
  }
}

/**
 * 抓取各外幣對台幣的匯率。
 * @returns {Promise<{ source: string, fetchedAt: Date, rates: Record<string, number> }>}
 */
export async function fetchRatesToTwd() {
  const baseUrl = process.env.EXCHANGE_RATE_API_URL || DEFAULT_BASE_URL;
  const url = `${baseUrl}/${BASE_CURRENCY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let body;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new ExchangeRateError(`匯率 API HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new ExchangeRateError(`匯率 API 逾時（${FETCH_TIMEOUT_MS}ms）`);
    if (err instanceof ExchangeRateError) throw err;
    throw new ExchangeRateError(`匯率 API 請求失敗：${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (body?.result && body.result !== 'success') {
    throw new ExchangeRateError(`匯率 API 回應非成功：${body['error-type'] || body.result}`);
  }

  // 驗證 API 自我聲明的基準幣：擋掉「格式相同、基準不同」的端點
  if (body?.base_code && body.base_code !== BASE_CURRENCY) {
    throw new ExchangeRateError(`匯率基準幣不符：預期 ${BASE_CURRENCY}，API 回 ${body.base_code}`);
  }

  const perTwd = body?.rates;
  if (!perTwd || typeof perTwd !== 'object') {
    throw new ExchangeRateError('匯率 API 回應缺少 rates 欄位');
  }

  // 基準幣自己固定為 1；其餘外幣取倒數（1 單位外幣 = 幾 TWD）。
  const rates = { [BASE_CURRENCY]: 1 };
  const missing = [];
  for (const code of FOREIGN_CURRENCIES) {
    const perUnit = perTwd[code]; // 1 TWD = perUnit 單位外幣
    if (typeof perUnit !== 'number' || !Number.isFinite(perUnit) || perUnit <= 0) {
      missing.push(code);
      continue;
    }
    rates[code] = 1 / perUnit;
  }
  if (missing.length) {
    throw new ExchangeRateError(`匯率 API 缺少或無效的幣別：${missing.join(', ')}`);
  }

  const unix = body?.time_last_update_unix;
  const fetchedAt = typeof unix === 'number' ? new Date(unix * 1000) : new Date();

  const source = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return 'exchange-rate-api';
    }
  })();

  return { source, fetchedAt, rates };
}
