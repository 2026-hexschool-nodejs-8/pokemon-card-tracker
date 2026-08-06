import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ComposedChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  getCard,
  getCardPrices,
  getCardPricesCsvUrl,
  getPriceHistory,
  getCardPriceSummary,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');
// 後端已回傳整數平均價，前端只加上千分位顯示。
const fmtAverageTwd = (price) => price.toLocaleString('zh-TW');
// 依來源數顯示單一來源或多來源平均。
const fmtSourceLabel = (count) => (count === 1 ? '單一來源' : `${count} 來源平均`);

const RANGES = [
  ['1M', 'month'],
  ['3M', 'quarter'],
  ['1Y', 'annual'],
];

// 產生瀏覽器下載用的 CSV 檔名，避開常見檔名保留字元
function csvDownloadFilename(card) {
  const safeName = `${card.name}-${card.cardNumber}`
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${safeName || 'card-prices'}.csv`;
}

// 台股慣例：紅漲綠跌。想改成歐美的綠漲紅跌就把兩個顏色對調
function ChangeBadge({ label, change }) {
  if (!change) {
    return <span className="text-muted-foreground">{label} —</span>;
  }
  const flat = change.pct === 0;
  const up = change.pct > 0;
  const color = flat ? 'text-muted-foreground' : up ? 'text-red-600' : 'text-green-600';
  const arrow = flat ? '—' : up ? '▲' : '▼';
  return (
    <span
      className={color}
      title={`基準 ${fmtTime(change.basisFetchedAt)}｜價差 NT$ ${change.diffTwd.toLocaleString()}`}
    >
      {label} {arrow} {up ? '+' : ''}
      {change.pct}%
    </span>
  );
}

export default function CardDetailPage() {
  const { id } = useParams();
  const [card, setCard] = useState(null);
  const [prices, setPrices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [csvError, setCsvError] = useState('');
  const [range, setRange] = useState('quarter');
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cardRes, priceRes, summaryRes] = await Promise.all([
          getCard(id),
          getCardPrices(id),
          // 漲跌幅是輔助資訊，單獨失敗不該讓整頁只剩錯誤訊息；
          // 這裡先接住錯誤變成 null，下面的 {summary && ...} 會自動略過這一塊。
          // 但一定要留下 console 訊息：畫面只是少一塊，沒有這行會查不到原因
          getCardPriceSummary(id).catch((err) => {
            console.warn('[CardDetail] 漲跌幅載入失敗，略過該區塊', err);
            return null;
          }),
        ]);
        setCard(cardRes.data);
        setPrices(priceRes.data);
        setSummary(summaryRes?.data ?? null);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!card) return;
    setHistoryLoading(true);
    getPriceHistory(id, range)
      .then((r) => setHistory(r.data))
      .catch(() => setHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [id, card, range]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!card) return <p className="text-muted-foreground">載入中…</p>;

  const historyChartData = (history?.buckets ?? [])
    .slice()
    .reverse()
    .map((b) => ({
      date: new Date(b.bucketStartDate).toLocaleDateString('en-US', {
        month: 'numeric',
        day: 'numeric',
      }),
      price: parseFloat(b.marketPrice) || null,
      volume: parseInt(b.quantitySold) || 0,
    }));

  const pctChange = (() => {
    const buckets = history?.buckets ?? [];
    if (buckets.length < 2) return null;
    const latest = parseFloat(buckets[0].marketPrice);
    const oldest = parseFloat(buckets[buckets.length - 1].marketPrice);
    if (!oldest) return null;
    return ((latest - oldest) / oldest * 100).toFixed(2);
  })();

  const twdChartData = prices.map((p) => ({
    date: new Date(p.fetchedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
    priceTwd: p.priceTwd, // 舊快照可能是 null，connectNulls 會跨過缺值
  }));
  const hasTwd = twdChartData.some((d) => d.priceTwd !== null);

  // 用 fetch 取回 CSV blob，避免匯出失敗時整頁離開 SPA
  async function downloadCsv() {
    try {
      setCsvError('');
      const res = await fetch(getCardPricesCsvUrl(card.id));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `CSV 匯出失敗（${res.status}）`);
      }

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = csvDownloadFilename(card);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[CardDetail] 匯出 CSV 失敗', err);
      setCsvError(err.message || '匯出 CSV 失敗');
    }
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← 回卡牌列表
      </Link>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex-shrink-0">
              {card.imageUrl ? (
                <img
                  src={card.imageUrl}
                  alt={card.name}
                  className="max-w-xs w-full rounded-lg object-contain"
                />
              ) : (
                <div className="max-w-xs w-full h-80 rounded-lg bg-muted" />
              )}
            </div>
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold">{card.name}</h2>
                  <p className="text-muted-foreground">
                    {card.cardNumber}　{card.setName}　{card.language} / {card.condition}
                  </p>
                </div>
                {/* 下載目前卡牌的歷史價格 CSV */}
                <Button type="button" variant="outline" onClick={downloadCsv}>
                  匯出 CSV
                </Button>
              </div>
              {csvError && <p className="text-sm text-destructive">{csvError}</p>}
              {/* 顯示後端查詢時計算出的多來源平均價。 */}
              {card.averagePriceTwd != null ? (
                <p className="text-3xl font-bold">
                  NT$ {fmtAverageTwd(card.averagePriceTwd)}
                  {card.averagePriceSourceCount > 0 && (
                    <span className="ml-3 align-middle text-sm font-medium text-muted-foreground">
                      {fmtSourceLabel(card.averagePriceSourceCount)}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-3xl font-bold">
                  {card.latestPrice == null
                    ? '尚未更新價格'
                    : `${card.latestCurrency} ${card.latestPrice.toLocaleString()}`}
                </p>
              )}
              {summary && (
                <p className="flex gap-4 text-sm font-medium">
                  <ChangeBadge label="近 7 日" change={summary.change7d} />
                  <ChangeBadge label="近 30 日" change={summary.change30d} />
                </p>
              )}
              <p className="text-sm text-muted-foreground">最後更新：{fmtTime(card.lastFetchedAt)}</p>
              {(() => {
                const tcgSrc = card.sources?.find((s) => s.provider === 'tcgplayer');
                const pid = tcgSrc?.externalId ?? (/^\d+$/.test(card.cardNumber) ? card.cardNumber : null);
                return pid ? (
                  <a
                    href={`https://www.tcgplayer.com/product/${pid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm text-blue-600 hover:underline"
                  >
                    在 TCGPlayer 查看完整資訊 ↗
                  </a>
                ) : null;
              })()}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>市場價格歷史</CardTitle>
              {history && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg font-semibold">
                    Near Mint ${parseFloat(history.buckets[0]?.marketPrice ?? 0).toFixed(2)}
                  </span>
                  {pctChange !== null && (
                    <span
                      className={`text-sm font-medium ${
                        Number(pctChange) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      ({Number(pctChange) >= 0 ? '+' : ''}{pctChange}%)
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-1 text-sm">
              {RANGES.map(([label, val]) => (
                <button
                  key={val}
                  onClick={() => setRange(val)}
                  className={`px-3 py-1 rounded font-medium transition-colors ${
                    range === val
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
          {historyLoading ? (
            <div className="h-[280px] flex items-center justify-center text-muted-foreground">
              載入中…
            </div>
          ) : historyChartData.length === 0 ? (
            <p className="text-muted-foreground">此卡牌無 TCGPlayer 歷史資料</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={historyChartData} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="price"
                  orientation="left"
                  width={65}
                  tickFormatter={(v) => `$${v.toFixed(2)}`}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  yAxisId="volume"
                  orientation="right"
                  width={40}
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                />
                <Tooltip
                  formatter={(value, name) =>
                    name === 'price'
                      ? [`$${Number(value).toFixed(2)}`, 'Market Price']
                      : [value, '成交量']
                  }
                />
                <Bar yAxisId="volume" dataKey="volume" fill="#BFDBFE" radius={[2, 2, 0, 0]} />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="price"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>台幣價格趨勢</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasTwd ? (
            <p className="text-muted-foreground">尚無台幣歷史價格（重跑抓價後產生）</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={twdChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis width={70} />
                <Tooltip formatter={(v) => [`NT$ ${v.toLocaleString()}`, '台幣價']} />
                <Line type="monotone" dataKey="priceTwd" connectNulls stroke="hsl(222.2 47.4% 11.2%)" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>歷史價格</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">時間</th>
                <th>來源</th>
                <th>價格</th>
                <th>台幣</th>
                <th>原始文字</th>
              </tr>
            </thead>
            <tbody>
              {[...prices].reverse().map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2">{fmtTime(p.fetchedAt)}</td>
                  <td>{p.provider}</td>
                  <td>
                    {p.currency} {p.price?.toLocaleString() ?? '—'}
                    {p.isSuspicious && <span className="ml-1 text-destructive">⚠</span>}
                  </td>
                  <td>{p.priceTwd !== null ? `NT$ ${p.priceTwd.toLocaleString()}` : '—'}</td>
                  <td className="text-muted-foreground">{p.rawText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
