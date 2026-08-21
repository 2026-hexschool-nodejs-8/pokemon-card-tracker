import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { useEffect, useRef, useState } from 'react';
import { buildDailySeries } from '@/lib/priceSeries';
import { getPriceHistory } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmtTwd = (v) => `NT$ ${Number(v).toLocaleString()}`;

// 固定天數而非曆月：曆月長度浮動（28～31 天）會讓骨架長度隨月份改變，
// 也會跟頁面上方「近 7 日 / 近 30 日」的漲跌幅徽章對不起來。
const TREND_RANGES = [
  ['7 天', 7],
  ['1 個月', 30],
  ['3 個月', 90],
];

// 沿用 Tailwind 的 md 斷點，與頁面其他響應式行為一致
const NARROW_QUERY = '(max-width: 767px)';

/** 窄螢幕偵測。FR-024／FR-025 要改變的是「可選的區間集合」而非只是樣式，純 CSS 做不到。 */
function useIsNarrow() {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setIsNarrow(e.matches);
    mq.addEventListener('change', onChange);
    setIsNarrow(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isNarrow;
}

// 外部行情 API 的 range 粒度：只有 month 是一天一格，quarter 是三天一格。
// 90 天只能用 quarter，其稀疏處由 priceSeries 保持 null（不補值，見 FR-031）。
const tcgRangeFor = (days) => (days <= 30 ? 'month' : 'quarter');

/**
 * 取外部市場行情。每種粒度整個瀏覽期間只取一次 －
 * 7 天與 30 天都映射到 month，所以在這兩者之間切換不會重打外部服務（FR-032）。
 * 快照資料已在頁面手上，這裡的等待不阻擋圖表呈現（FR-033）。
 */
function useTcgMarketHistory(cardId, days) {
  const range = tcgRangeFor(days);
  const cacheRef = useRef({});
  const [buckets, setBuckets] = useState(null);

  useEffect(() => {
    if (!cardId) return undefined;

    // key 必須含 cardId：同路由換卡時元件不會卸載，只用 range 會把前一張卡的行情畫上去
    const cacheKey = `${cardId}|${range}`;
    if (cacheKey in cacheRef.current) {
      setBuckets(cacheRef.current[cacheKey]);
      return undefined;
    }

    let cancelled = false;
    getPriceHistory(cardId, range)
      .then((res) => res?.data?.buckets ?? null)
      // 外部來源失敗是可接受狀態：少一條線，其餘照常呈現（FR-016）
      .catch(() => null)
      .then((result) => {
        cacheRef.current[cacheKey] = result;
        if (!cancelled) setBuckets(result);
      });

    return () => {
      cancelled = true;
    };
    // 依映射後的 range 而非 days，否則 7↔30 切換會多打一次外部服務
  }, [cardId, range]);

  return buckets;
}

// 依 series 索引分配。排序由 buildDailySeries 決定且穩定，所以視覺樣式不會在重繪之間跳動。
const LINE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#7c3aed', '#0891b2', '#d97706'];

// 顏色之外再加一組線型：約 8% 的男性有紅綠色覺障礙，只靠顏色的話他們無法分辨哪條線是哪個來源。
// '0' 是 SVG 表示實線的合法值，用它而非 undefined，讓每條線都有明確且互異的 stroke-dasharray。
const LINE_DASHES = ['0', '6 3', '2 3', '10 4 2 4', '1 4', '8 3 2 3'];

/** 疑似異常畫成菱形、正常畫成圓形 － 形狀本身就能區分，不依賴顏色。
 *  長區間關閉一般資料點，但**異常點一律顯示** － 那是使用者最需要看到的東西。 */
function makeDot(seriesKey, color, showDots) {
  return function Dot({ cx, cy, payload, index }) {
    if (cx == null || cy == null || payload?.[seriesKey] == null) return null;
    const key = `${seriesKey}-${index}`;
    const suspicious = payload.__suspicious?.[seriesKey];
    if (!suspicious && !showDots) return null;

    if (suspicious) {
      return (
        <path
          key={key}
          d={`M${cx},${cy - 5}L${cx + 5},${cy}L${cx},${cy + 5}L${cx - 5},${cy}Z`}
          fill="#fff"
          stroke={color}
          strokeWidth={2}
        />
      );
    }
    return <circle key={key} cx={cx} cy={cy} r={3} fill={color} />;
  };
}

/** 自訂圖例。recharts 內建的圖例 icon 是固定的「線+圓」glyph，只吃 stroke 不吃 stroke-dasharray，
 *  圖例上看不出線型就無法對應回圖上的線 － 對只靠線型分辨的使用者等於沒有圖例。 */
function TrendLegend({ payload = [] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-5 gap-y-1 pt-2 text-sm">
      {payload.map((entry) => (
        <li key={entry.value} className="flex items-center gap-2">
          <svg width="28" height="10" aria-hidden="true" className="shrink-0">
            <line
              x1="0"
              y1="5"
              x2="28"
              y2="5"
              stroke={entry.color}
              strokeWidth="2"
              strokeDasharray={entry.payload?.strokeDasharray}
            />
          </svg>
          <span className="text-muted-foreground">{entry.value}</span>
        </li>
      ))}
    </ul>
  );
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-md border bg-background px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {payload
        .filter((row) => row.value != null)
        .map((row) => (
          <p key={row.dataKey} className="flex items-center gap-2">
            <span style={{ color: row.color }}>{row.dataKey}</span>
            <span className="font-medium">{fmtTwd(row.value)}</span>
            {point.__suspicious?.[row.dataKey] && (
              <span className="text-destructive" title="此筆價格被判定為疑似異常">
                ⚠ 疑似異常
              </span>
            )}
          </p>
        ))}
      {/* 合併兩張圖之後成交量沒有獨立的圖層可放，改掛在這裡 － 資訊不丟，畫面不亂 */}
      {point.__tcgQuantitySold > 0 && (
        <p className="mt-1 border-t pt-1 text-muted-foreground">
          TCGPlayer 成交量 {point.__tcgQuantitySold}
        </p>
      )}
    </div>
  );
}

/** 卡牌詳情頁的價格趨勢圖：橫軸日期一天一格、縱軸台幣、每個來源一條線 */
export default function PriceTrendChart({ cardId, prices = [] }) {
  const [days, setDays] = useState(7);
  const isNarrow = useIsNarrow();
  const tcgBuckets = useTcgMarketHistory(cardId, days);

  // 窄螢幕放不下 90 天 × 多條線，只提供 7 天與 30 天
  const ranges = isNarrow ? TREND_RANGES.filter(([, d]) => d <= 30) : TREND_RANGES;

  // 已選 90 天後畫面轉窄 → 退回 30 天，否則會停在一個已經不可選的區間
  useEffect(() => {
    if (isNarrow && days === 90) setDays(30);
  }, [isNarrow, days]);

  const { series, points } = buildDailySeries({ snapshots: prices, tcgBuckets, days });

  // 90 個點 × 多條線會糊成一片，長區間只留線
  const showDots = days <= 30;

  // 空狀態要分辨「換算不出台幣」與「這段期間沒抓到價」－ 兩者對使用者的意義完全不同，
  // 混為一談會讓訪客以為系統壞了，其實只是要往前看更長的區間。
  const hasAnyTwd = prices.some((p) => p.priceTwd !== null && p.priceTwd !== undefined);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>價格趨勢</CardTitle>
          <div className="flex gap-1 text-sm">
            {ranges.map(([label, value]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                aria-pressed={days === value}
                className={`rounded px-3 py-1 font-medium transition-colors ${
                  days === value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {prices.length === 0 ? (
          <p className="text-muted-foreground">尚無價格紀錄</p>
        ) : !hasAnyTwd ? (
          // 有快照但一筆都換算不出台幣。訊息寫給前台訪客看 －
          // 他們無法對匯率缺漏做任何處置，維運細節留在主控台。
          <p className="text-muted-foreground">
            價格資料暫時無法以台幣呈現，請稍後再回來查看。原始價格仍可在下方歷史價格中檢視。
          </p>
        ) : series.length === 0 ? (
          <p className="text-muted-foreground">
            這段期間沒有價格紀錄，試試看更長的區間。
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              {/* 90 天有 90 個刻度，交給 recharts 自動抽稀，否則標籤會疊在一起 */}
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
              <YAxis
                width={80}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => Number(v).toLocaleString()}
              />
              <Tooltip content={<TrendTooltip />} />
              <Legend content={<TrendLegend />} />
              {series.map((s, i) => {
                const color = LINE_COLORS[i % LINE_COLORS.length];
                return (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={color}
                    // 線型是顏色之外的第二個編碼；圖例由 TrendLegend 讀同一個值畫出對應樣式
                    strokeDasharray={LINE_DASHES[i % LINE_DASHES.length]}
                    strokeWidth={2}
                    connectNulls
                    dot={makeDot(s.key, color, showDots)}
                    activeDot={{ r: 5 }}
                    // 必須關掉。recharts 的線條進場動畫是靠改寫 stroke-dasharray 實作的，
                    // 會蓋掉我們用來區分來源的線型（FR-029），動畫期間 dot 也不會出現。
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
