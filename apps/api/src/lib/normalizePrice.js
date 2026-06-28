// 價格標準化與防呆 － 對應 PRD 第十八章邊界情境
// 將 "¥12,345" / "$1,234.56" 之類字串清成數字，並擋掉 0 / NaN / Infinity

const CURRENCY_SYMBOLS = /[¥$€£]|NT\$|USD|JPY|TWD|円|元/gi;

export class PriceParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PriceParseError';
  }
}

/**
 * @param {string|number} raw 原始價格（字串或數字）
 * @returns {number} 清洗後的正數價格
 */
export function normalizePrice(raw) {
  if (raw === null || raw === undefined || raw === '') {
    throw new PriceParseError('價格為空');
  }

  let value;
  if (typeof raw === 'number') {
    value = raw;
  } else {
    const cleaned = String(raw)
      .replace(CURRENCY_SYMBOLS, '')
      .replace(/,/g, '')
      .replace(/\s/g, '')
      .trim();
    value = Number(cleaned);
  }

  if (Number.isNaN(value)) throw new PriceParseError(`無法解析為數字：${raw}`);
  if (!Number.isFinite(value)) throw new PriceParseError(`價格非有限數：${raw}`);
  if (value <= 0) throw new PriceParseError(`價格須大於 0：${raw}`);

  return value;
}

/**
 * 判斷新價格相對舊價格是否疑似異常（暴漲暴跌 > 50%）
 * @returns {boolean}
 */
export function isSuspiciousPrice(newPrice, prevPrice) {
  if (!prevPrice || prevPrice <= 0) return false;
  const ratio = Math.abs(newPrice - prevPrice) / prevPrice;
  return ratio > 0.5;
}
