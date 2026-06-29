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
import { getCard, getCardPrices } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');

export default function CardDetailPage() {
  const { id } = useParams();
  const [card, setCard] = useState(null);
  const [prices, setPrices] = useState([]);
  const [error, setError] = useState('');

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

  if (error) return <p className="text-destructive">{error}</p>;
  if (!card) return <p className="text-muted-foreground">載入中…</p>;

  const chartData = prices.map((p) => ({
    date: new Date(p.fetchedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }),
    price: p.price,
  }));

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
          <CardTitle>價格趨勢</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="text-muted-foreground">尚無歷史價格</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis width={70} />
                <Tooltip />
                <Line type="monotone" dataKey="price" stroke="hsl(222.2 47.4% 11.2%)" />
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
