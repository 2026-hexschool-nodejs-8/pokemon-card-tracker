import { assertPriceResult } from '../contract.js';
import { scrapeCard } from './tcgplayer.scraper.js';

export const tcgplayerCrawlerAdapter = {
  type: 'crawler',
  name: 'tcgplayer',
  async fetchPrice(source) {
    const productId = Number(source.externalId);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new Error(`tcgplayer crawler adapter 需要正整數 externalId，收到: ${source.externalId}`);
    }

    const card = await scrapeCard(productId);

    if (card.price == null) {
      throw new Error(`tcgplayer adapter: productId ${productId} 無法取得價格（spotlight 與 latestsales 皆無資料）`);
    }

    // 以最新一筆成交的 orderDate 作為 fetchedAt，而非爬蟲執行時間
    const latestSale = card.latestSales?.[0];
    const fetchedAt = latestSale?.orderDate
      ? new Date(latestSale.orderDate).toISOString()
      : new Date().toISOString();

    return assertPriceResult({
      provider: 'tcgplayer',
      price: card.price,
      currency: source.currency || 'USD',
      fetchedAt,
      imageUrl: card.imageUrl,
    });
  },
};
