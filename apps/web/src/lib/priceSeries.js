// 價格趨勢圖的資料整形 － 純函式，不碰 React、不做 I/O，因此可用 `node --test` 直接驗證。
//
// 職責邊界：本模組只決定「有哪些線、線的順序、每天各線的值」；
// 顏色與線型的實際色值由圖表層依索引分配（見 PriceTrendChart.jsx）。

/** 外部市場行情的 series key。刻意與 provider 名稱 'tcgplayer' 不同 －
 *  一張卡可能同時有我方抓取的 tcgplayer 報價與官方公布的市場行情，兩者必須分成兩條線。 */
export const TCG_MARKET_SERIES_KEY = 'TCGPlayer 市場價';

/** 三個觀察區間的天數。固定天數而非曆月：曆月長度浮動會讓骨架長度隨月份改變，
 *  也會與頁面上方「近 7 日 / 近 30 日」的漲跌幅徽章對不起來。 */
export const RANGE_DAYS = [7, 30, 90];

const DAY_MS = 24 * 60 * 60 * 1000;

/** 取本地時區的 YYYY-MM-DD。
 *  不能用 toISOString().slice(0,10) － 那是 UTC，會讓台灣時間凌晨的快照被歸到前一天。 */
function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 橫軸顯示用的短標籤：2026-08-09 → 8/9 */
function axisLabel(dateKey) {
  const [, m, d] = dateKey.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 由 YYYY-MM-DD 還原成當地午夜的 Date，用來逐日遞增產生骨架 */
function dateFromKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 把快照與外部市場行情整形成 recharts 可直接使用的資料。
 *
 * @param {object}   input
 * @param {Array}    input.snapshots  GET /cards/:id/prices 回傳的完整快照陣列
 * @param {Array?}   input.tcgBuckets 外部市場行情的 buckets，null 代表尚未取得或取得失敗
 * @param {number}   input.days       觀察區間長度（7 / 30 / 90）
 * @param {Date}     input.now        「今日」基準。存在的目的是讓測試可決定性地驗證日期邏輯
 * @returns {{ series: Array, points: Array }}
 */
export function buildDailySeries({ snapshots = [], tcgBuckets = null, days = 7, now = new Date() } = {}) {
  const todayKey = localDateKey(now);
  const windowStartKey = localDateKey(new Date(now.getTime() - (days - 1) * DAY_MS));
  // YYYY-MM-DD 的字典序等同時間序，可以直接用字串比較
  const inWindow = (key) => key >= windowStartKey && key <= todayKey;

  // ── ① 我方快照：排除無台幣值者，同日同來源保留 fetchedAt 較晚的那筆 ──
  const byProvider = new Map();
  for (const s of snapshots) {
    // 嚴格等值：0 是合法價格，不能用 falsy 一起擋掉
    if (s.priceTwd === null || s.priceTwd === undefined) continue;

    const at = new Date(s.fetchedAt);
    const dateKey = localDateKey(at);
    if (!inWindow(dateKey)) continue;

    if (!byProvider.has(s.provider)) byProvider.set(s.provider, new Map());
    const daily = byProvider.get(s.provider);
    const prev = daily.get(dateKey);
    if (!prev || at.getTime() >= prev.at) {
      daily.set(dateKey, { value: s.priceTwd, at: at.getTime(), isSuspicious: Boolean(s.isSuspicious) });
    }
  }

  // ── ② 外部市場行情：粒度可能粗於一天，缺漏的日子維持空白，不補值也不插值 ──
  const tcgByDate = new Map();
  for (const b of tcgBuckets ?? []) {
    if (b?.marketPriceTwd === null || b?.marketPriceTwd === undefined) continue;
    if (!inWindow(b.bucketStartDate)) continue;
    tcgByDate.set(b.bucketStartDate, {
      value: b.marketPriceTwd,
      quantitySold: Number(b.quantitySold) || 0,
    });
  }

  // ── ③ 日期骨架：起點取「區間起點」與「最早有資料日」較晚者 ──
  // 硬補滿整個區間的話，資料只有幾天時 90 天區間會出現一大片空白。
  const dataKeys = [
    ...[...byProvider.values()].flatMap((daily) => [...daily.keys()]),
    ...tcgByDate.keys(),
  ];
  if (dataKeys.length === 0) return { series: [], points: [] };

  const earliestKey = dataKeys.reduce((a, b) => (a < b ? a : b));
  const startKey = earliestKey > windowStartKey ? earliestKey : windowStartKey;

  // ── ④ series：我方 provider 依字母序在前，外部市場行情固定最後 ──
  // 順序穩定，圖表層依索引分配的顏色與線型才不會在重繪之間跳動。
  const series = [...byProvider.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({ key, label: key, isExternal: false }));

  if (tcgByDate.size > 0) {
    series.push({ key: TCG_MARKET_SERIES_KEY, label: TCG_MARKET_SERIES_KEY, isExternal: true });
  }

  // ── ⑤ 逐日產出資料點，缺值一律為 null（由圖表層決定要不要連線） ──
  const points = [];
  for (const cursor = dateFromKey(startKey); localDateKey(cursor) <= todayKey; cursor.setDate(cursor.getDate() + 1)) {
    const dateKey = localDateKey(cursor);
    const point = { dateKey, label: axisLabel(dateKey), __suspicious: {}, __tcgQuantitySold: null };

    for (const s of series) {
      if (s.isExternal) {
        const hit = tcgByDate.get(dateKey);
        point[s.key] = hit ? hit.value : null;
        if (hit) point.__tcgQuantitySold = hit.quantitySold;
      } else {
        const hit = byProvider.get(s.key).get(dateKey);
        point[s.key] = hit ? hit.value : null;
        // 異常價照常呈現，只是額外標記讓圖表層換一個形狀畫
        if (hit?.isSuspicious) point.__suspicious[s.key] = true;
      }
    }

    points.push(point);
  }

  return { series, points };
}
