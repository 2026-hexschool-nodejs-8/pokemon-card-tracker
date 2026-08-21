import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Info } from 'lucide-react';
import {
  getCard,
  getCardPrices,
  getCardPricesCsvUrl,
  getCardPriceSummary,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PriceTrendChart from '@/components/PriceTrendChart';
import { fmtPrice, fmtSourceLabel, fmtTime } from '@/lib/formatters';

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

// 平均價規則改放在可互動提示框，避免長說明文字打斷主要價格資訊。
function AveragePriceInfo({ maxAgeDays }) {
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={`查看平均價計算規則：僅計入近 ${maxAgeDays} 天內有更新的來源`}
        aria-describedby="average-price-policy"
        className="inline-flex rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      <span
        id="average-price-policy"
        role="tooltip"
        className="pointer-events-none invisible absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-md bg-slate-900 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        平均價僅計入近 {maxAgeDays} 天內有更新的來源。過期來源仍會列在下方，但不參與平均計算。
      </span>
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

  if (error) return <p className="text-destructive">{error}</p>;
  if (!card) return <p className="text-muted-foreground">載入中…</p>;

  const latestSourcePrices = card.latestSourcePrices ?? [];
  const averagePriceMaxAgeDays = card.averagePriceMaxAgeDays ?? 90;
  // 有來源價格但沒有平均價，代表所有有效來源價格都已超過後端設定的採用期限。
  const hasOnlyStaleSourcePrices =
    card.averagePriceTwd == null &&
    latestSourcePrices.length > 0 &&
    latestSourcePrices.every((sourcePrice) => sourcePrice.isStale);

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
                  {fmtPrice(card.averagePriceTwd, 'NT$')}
                  {card.averagePriceSourceCount > 0 && (
                    <span className="ml-3 align-middle text-sm font-medium text-muted-foreground">
                      {fmtSourceLabel(card.averagePriceSourceCount)}
                      <AveragePriceInfo maxAgeDays={averagePriceMaxAgeDays} />
                    </span>
                  )}
                </p>
              ) : hasOnlyStaleSourcePrices ? (
                <div>
                  <p className="text-3xl font-bold">暫無近期平均價</p>
                  <p className="text-sm text-muted-foreground">
                    所有來源價格皆已超過 {averagePriceMaxAgeDays} 天
                  </p>
                </div>
              ) : (
                <p className="text-3xl font-bold">
                  {card.latestPrice == null
                    ? '尚未更新價格'
                    : fmtPrice(card.latestPrice, card.latestCurrency)}
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


      {/* 各來源最新價格區塊：明確呈現 API 回傳的每個來源最新有效價格。 */}
      <Card>
        <CardHeader>
          <CardTitle>各來源最新價格</CardTitle>
        </CardHeader>
        <CardContent>
          {latestSourcePrices.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無有效來源價格</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">來源</th>
                    <th>價格</th>
                    <th>台幣</th>
                    <th>更新時間</th>
                  </tr>
                </thead>
                <tbody>
                  {latestSourcePrices.map((sourcePrice) => (
                    <tr key={sourcePrice.sourceId} className="border-b">
                      <td className="py-2">
                        {sourcePrice.provider}
                        {/* 過期來源仍保留最後價格，但明確提醒使用者它未參與近期平均。 */}
                        {sourcePrice.isStale && (
                          <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                            已過期
                          </span>
                        )}
                      </td>
                      <td>{fmtPrice(sourcePrice.price, sourcePrice.currency)}</td>
                      <td>{sourcePrice.priceTwd != null ? fmtPrice(sourcePrice.priceTwd, 'NT$') : '-'}</td>
                      <td className="text-muted-foreground">{fmtTime(sourcePrice.fetchedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PriceTrendChart cardId={id} prices={prices} />

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
