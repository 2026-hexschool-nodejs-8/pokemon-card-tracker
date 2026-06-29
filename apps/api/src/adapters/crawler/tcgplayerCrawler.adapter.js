import { assertPriceResult } from '../contract.js';
import { scrapeCard } from './tcgplayer.scraper.js';

export const tcgplayerCrawlerAdapter = {
  type: 'crawler',
  name: 'tcgplayer',
  async fetchPrice(source) {
    const productId = parseInt(source.externalId, 10);
    if (!productId || productId <= 0) {
      throw new Error(`tcgplayer adapter: externalId 必須是正整數，收到 "${source.externalId}"`);
    }

    const card = await scrapeCard(productId);

    if (card.price == null) {
      throw new Error(`tcgplayer adapter: productId ${productId} 無法取得價格（spotlight 與 latestsales 皆無資料）`);
    }

    return assertPriceResult({
      provider: 'tcgplayer',
      price: card.price,
      currency: source.currency || 'USD',
      fetchedAt: new Date().toISOString(),
      imageUrl: card.imageUrl,
    });
  },
};
