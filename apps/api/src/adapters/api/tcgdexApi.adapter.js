// Pokémon TCG API adapter（來源：https://api.pokemontcg.io/v2/cards/{id}）
// 以 fetch 呼叫 PriceSource.url，Header 帶 X-Api-Key（.env 的 TCGDEX_API_KEY）
// 價格取回傳 JSON 的 data.cardmarket.prices.trendPrice（Cardmarket 趨勢價，幣別預設 EUR）
// 圖片取 data.images.small（可選；缺圖不 throw）
// url 範例：https://api.pokemontcg.io/v2/cards/hgss4-1
import { assertPriceResult } from '../contract.js';
import { resolveImageUrl } from '../resolveImageUrl.js';

const TCGDEX_API_KEY = process.env.TCGDEX_API_KEY;

export const tcgdexApiAdapter = {
  type: 'api',
  name: 'tcgdexApi',
  async fetchPrice(source) {
    const res = await fetch(source.url, { headers: { 'X-Api-Key': TCGDEX_API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const imageUrl = resolveImageUrl(data.data.images?.small, source.url);

    return assertPriceResult({
      provider: source.provider,
      price: data.data.cardmarket.prices.trendPrice,
      currency: source.currency || 'EUR',
      fetchedAt: new Date().toISOString(),
      ...(imageUrl ? { imageUrl } : {}),
    });
  },
};
