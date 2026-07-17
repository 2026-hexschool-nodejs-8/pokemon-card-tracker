// 樂天市場 crawler adapter（來源：item.rakuten.co.jp 商品頁）－ PRD FR-07
// 目標 HTML：<tr irc="ItemPriceNormal"></tr>
//           <meta itemprop="offerCount" content="1">
//           <meta itemprop="price" content="170">
// 價格在 meta[itemprop="price"] 的 content 屬性，回傳 rawText 交給 normalizePrice 清洗
import * as cheerio from 'cheerio';
import { assertPriceResult } from '../contract.js';
import { resolveImageUrl } from '../resolveImageUrl.js';

const PRICE_SELECTOR = 'meta[itemprop="price"]';
const IMAGE_SELECTOR = 'meta[property="og:image"]';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

export const rakutenAdapter = {
  type: 'crawler',
  name: 'rakuten',
  async fetchPrice(source) {
    const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);

    const rawText = $(PRICE_SELECTOR).first().attr('content')?.trim() ?? '';
    if (!rawText) throw new Error('找不到價格 selector（頁面可能改版）');

    const imageUrl = resolveImageUrl($(IMAGE_SELECTOR).first().attr('content'), source.url);

    return assertPriceResult({
      provider: source.provider,
      rawText,
      currency: source.currency || 'JPY',
      fetchedAt: new Date().toISOString(),
      ...(imageUrl ? { imageUrl } : {}),
    });
  },
};
