// 價格換算成台幣 － W3：抓價當下用 Currency 表把原幣價換成 TWD，凍結當天匯率寫進快照
//
// 設計要點：
//  - 純函式，不碰 prisma／DB → 好測試（讀 Currency 表交給 service 端做「一次」）
//  - rateToTwd 語意沿用 #16：1 單位外幣 = 幾元台幣，TWD 自己 = 1
//  - 換算失敗一律回 { priceTwd: null, reason }，不 throw、不中斷 job（交給呼叫端寫 log）
import { BASE_CURRENCY } from '@pct/shared';

/**
 * 把某個原幣價格換算成台幣。
 * @param {number} price 已清洗過的原幣價格（normalizePrice 之後的正數）
 * @param {string} currency 原幣別（'JPY' / 'USD' / 'HKD' / 'EUR' / 'TWD'）
 * @param {Map<string, number>} ratesToTwd 幣別 → rateToTwd
 * @returns {{ priceTwd: number|null, reason: string|null }}
 */
export function convertToTwd(price, currency, ratesToTwd) {
  // ① 基準幣（TWD）直通，不換算
  if (currency === BASE_CURRENCY) {
    return { priceTwd: price, reason: null };
  }

  // ② 從 Currency 表查這個幣別的匯率
  const rate = ratesToTwd.get(currency);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return { priceTwd: null, reason: `找不到 ${currency} 對台幣的匯率` };
  }

  // ③ 換算 + 防呆
  const raw = price * rate;
  if (!Number.isFinite(raw) || raw <= 0) {
    return { priceTwd: null, reason: `${currency} 換算結果異常：${raw}` };
  }

  // ④ 四捨五入到整數台幣（浮點相乘會有長尾，如 267.60000001）
  return { priceTwd: Math.round(raw), reason: null };
}
