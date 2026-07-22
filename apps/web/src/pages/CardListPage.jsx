import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCards } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmtPrice = (p, c) => (p == null ? '尚未更新' : `${c ?? ''} ${p.toLocaleString()}`);
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-TW') : '—');

export default function CardListPage() {
  const [keyword, setKeyword] = useState('');
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(kw = '') {
    setLoading(true);
    setError('');
    try {
      const { data } = await getCards({ keyword: kw });
      setCards(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          load(keyword);
        }}
      >
        <Input
          placeholder="搜尋卡名或卡號…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Button type="submit">搜尋</Button>
      </form>

      {loading && <p className="text-muted-foreground">載入中…</p>}
      {error && <p className="text-destructive">{error}</p>}
      {!loading && !error && cards.length === 0 && (
        <p className="text-muted-foreground">找不到符合的卡牌</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.id} to={`/cards/${c.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {c.cardNumber}　{c.setName}
                </p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">語言 / 品相：</span>
                  {c.language} / {c.condition}
                </p>
                {c.latestPriceTwd != null ? (
                  <>
                    <p className="text-lg font-semibold">NT$ {c.latestPriceTwd.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">
                      原幣 {fmtPrice(c.latestPrice, c.latestCurrency)}
                    </p>
                  </>
                ) : (
                  <p className="text-lg font-semibold">{fmtPrice(c.latestPrice, c.latestCurrency)}</p>
                )}
                <p className="text-xs text-muted-foreground">更新：{fmtTime(c.lastFetchedAt)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
