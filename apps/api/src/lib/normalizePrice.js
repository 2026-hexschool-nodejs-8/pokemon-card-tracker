// 價格標準化與防呆 － 對應 PRD 第十八章邊界情境
// 將 "¥12,345" / "$1,234.56" 之類字串清成數字，並擋掉 0 / NaN / Infinity

const CURRENCY_SYMBOLS = /[¥$€£]|NT\$|USD|JPY|HKD|EUR|TWD|円|元/gi;

// 統一小數點分隔符 － 逗號在不同地區語意相反，不能一律當千分位刪掉：
//   英美系 "17,800" 是 17800（逗號＝千分位）
//   歐系   "12,50"  是 12.5（逗號＝小數點）
// 只做 replace(/,/g, '') 會把 "12,50" 讀成 1250，而且是「合法數字」不會 throw，
// 會靜默寫進快照（100 倍灌水）。判讀規則：
//   ① 逗號與點都出現 → 位置靠後的是小數點，另一個是千分位（"1.234,56" / "1,234.56"）
//   ② 只出現一種且出現多次 → 一定是千分位（"1.234.567"）
//   ③ 只出現一次 → 後面剛好 3 位數視為千分位（"17,800"），否則視為小數點（"12,50" / "922.00"）
// 殘餘模糊：單一分隔符 + 3 位小數（"12,500" 想表達 12.5）無法從字面分辨，一律當千分位，
// 與現行行為一致；幣值極少寫到 3 位小數，且卡價的常見寫法都落在上面三條規則內。
function unifyDecimalSeparator(s) {
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    const [decimal, thousands] = lastComma > lastDot ? [',', '.'] : ['.', ','];
    return s.split(thousands).join('').replace(decimal, '.');
  }

  const sep = lastComma !== -1 ? ',' : lastDot !== -1 ? '.' : '';
  if (!sep) return s;

  const parts = s.split(sep);
  const isThousands = parts.length > 2 || parts[parts.length - 1].length === 3;
  return isThousands ? parts.join('') : parts.join('.');
}

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
    const cleaned = unifyDecimalSeparator(
      String(raw).replace(CURRENCY_SYMBOLS, '').replace(/\s/g, ''),
    );
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
