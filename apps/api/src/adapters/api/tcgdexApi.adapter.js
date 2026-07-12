// Pokémon TCG API adapter（來源：https://api.pokemontcg.io/v2/cards/{id}）
// 以 fetch 呼叫 PriceSource.url，Header 帶 X-Api-Key（.env 的 TCGDEX_API_KEY）
// 價格取回傳 JSON 的 data.cardmarket.prices.trendPrice（Cardmarket 趨勢價，幣別預設 EUR）
// url 範例：https://api.pokemontcg.io/v2/cards/hgss4-1
import { assertPriceResult } from '../contract.js';

const TCGDEX_API_KEY = process.env.TCGDEX_API_KEY;

export const tcgdexApiAdapter = {
  type: 'api',
  name: 'tcgdexApi',
  async fetchPrice(source) {
    const res = await fetch(source.url, { headers: { 'X-Api-Key': TCGDEX_API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    return assertPriceResult({
      provider: source.provider,
      price: data.data.cardmarket.prices.trendPrice,
      currency: source.currency || 'EUR',
      fetchedAt: new Date().toISOString(),
    });
  },
};
