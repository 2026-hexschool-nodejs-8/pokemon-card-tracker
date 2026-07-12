// Adapter 註冊表 － 依來源挑選對應 adapter
// 新增來源時：寫一個 adapter，在這裡註冊即可，service / scheduler 不必改
import { mockApiAdapter } from './api/mockApi.adapter.js';
import { mockCrawlerAdapter } from './crawler/mockCrawler.adapter.js';
import { priceChartingAdapter } from './crawler/priceCharting.adapter.js';
import { cardLandAdapter } from './crawler/cardLand.adapter.js';
import { yuyuteiAdapter } from './crawler/yuyutei.adapter.js';
import { rakutenAdapter } from './crawler/rakuten.adapter.js';
import { tcgdexApiAdapter } from './api/tcgdexApi.adapter.js';

const adapters = [mockApiAdapter, mockCrawlerAdapter, priceChartingAdapter, cardLandAdapter, yuyuteiAdapter, rakutenAdapter, tcgdexApiAdapter];

// 以 provider 名稱為 key
const byProvider = new Map(adapters.map((a) => [a.name, a]));

/**
 * 依 PriceSource 取得對應 adapter。
 * 先比對 provider 名稱，找不到則退而用 type 的預設 adapter。
 */
export function getAdapter(source) {
  const byName = byProvider.get(source.provider);
  if (byName) return byName;

  const byType = adapters.find((a) => a.type === source.type);
  if (byType) return byType;

  throw new Error(`找不到對應的 adapter：provider=${source.provider}, type=${source.type}`);
}

export function listAdapters() {
  return adapters.map(({ type, name }) => ({ type, name }));
}
