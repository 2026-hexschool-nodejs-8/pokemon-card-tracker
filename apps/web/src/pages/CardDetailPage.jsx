import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getCard, getCardPrices, getCardPriceSummary } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');

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

  useEffect(() => {
    (async () => {
      try {
        const [cardRes, priceRes, summaryRes] = await Promise.all([
          getCard(id),
          getCardPrices(id),
          // 漲跌幅是輔助資訊，單獨失敗不該讓整頁只剩錯誤訊息；
          // 這裡先接住錯誤變成 null，下面的 {summary && ...} 會自動略過這一塊
          getCardPriceSummary(id).catch(() => null),
        ]);
        setCard(cardRes.data);
        setPrices(priceRes.data);
        setSummary(summaryRes?.data ?? null);
      } catch (e) {
        setError(e.message);
      }
    })();
  }, [id]);

  if (error) return <p className="text-destructive">{error}</p>;
  if (!card) return <p className="text-muted-foreground">載入中…</p>;

  const chartData = prices.map((p) => ({
    date: new Date(p.fetchedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
    priceTwd: p.priceTwd, // 舊快照可能是 null，connectNulls 會跨過缺值
  }));
  const hasTwd = chartData.some((d) => d.priceTwd !== null);

  return (
    <div className="space-y-6">
      <Link to="/" className="text-sm text-muted-foreground hover:underline">
        ← 回卡牌列表
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{card.name}</CardTitle>
          <p className="text-muted-foreground">
            {card.cardNumber}　{card.setName}　{card.language} / {card.condition}
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          {card.latestPriceTwd !== null ? (
            <>
              <p className="text-3xl font-bold">NT$ {card.latestPriceTwd.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">
                原幣 {card.latestCurrency} {card.latestPrice?.toLocaleString()}
              </p>
            </>
          ) : (
            <p className="text-3xl font-bold">
              {card.latestPrice === null
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>價格趨勢</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasTwd ? (
            <p className="text-muted-foreground">尚無台幣歷史價格（重跑抓價後產生）</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
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
                    {p.currency} {p.price.toLocaleString()}
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
