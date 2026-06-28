// Mock crawler adapter － 模擬「抓 HTML 用 cheerio 解析價格文字」的流程
// 真實串接時：用 fetch 抓 source.url 的 HTML，再用 cheerio 取出價格文字，
// 回傳帶貨幣符號的 rawText，由 service 的 normalizePrice 統一清洗
import { assertPriceResult } from '../contract.js';

function basePriceOf(seed = '') {
  const sum = [...seed].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return 3000 + (sum % 30) * 1000; // 3000 ~ 32000
}

async function simulateCrawl(source) {
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 300));

  // 來源網址含 "fail" 時，模擬「找不到價格 selector」
  if ((source.url || '').includes('fail')) {
    throw new Error('mock crawler 找不到價格 selector（頁面可能改版）');
  }

  const base = basePriceOf(source.url || source.provider);
  const price = Math.round(base * (1 + (Math.random() - 0.5) * 0.12));
  // 模擬真實頁面常見的帶符號／逗號文字
  return `¥${price.toLocaleString('en-US')}`;
}

export const mockCrawlerAdapter = {
  type: 'crawler',
  name: 'mockCrawler',
  async fetchPrice(source) {
    const rawText = await simulateCrawl(source);
    return assertPriceResult({
      provider: source.provider,
      rawText,
      currency: source.currency || 'JPY',
      fetchedAt: new Date().toISOString(),
    });
  },
};
