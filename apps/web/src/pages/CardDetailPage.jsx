import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getCard, getCardPrices, getPriceHistory } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');

const RANGES = [
  ['1M', 'month'],
  ['3M', 'quarter'],
  ['1Y', 'annual'],
];

export default function CardDetailPage() {
  const { id } = useParams();
  const [card, setCard] = useState(null);
  const [prices, setPrices] = useState([]);
  const [error, setError] = useState('');
  const [range, setRange] = useState('quarter');
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [cardRes, priceRes] = await Promise.all([getCard(id), getCardPrices(id)]);
        setCard(cardRes.data);
        setPrices(priceRes.data);
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
              <div>
                <h2 className="text-2xl font-bold">{card.name}</h2>
                <p className="text-muted-foreground">
                  {card.cardNumber}　{card.setName}　{card.language} / {card.condition}
                </p>
              </div>
              <p className="text-3xl font-bold">
                {card.latestPrice == null
                  ? '尚未更新價格'
                  : `${card.latestCurrency} ${card.latestPrice.toLocaleString()}`}
              </p>
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
          <CardTitle>歷史價格</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2">時間</th>
                <th>來源</th>
                <th>價格</th>
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
