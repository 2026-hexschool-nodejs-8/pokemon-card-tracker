// PriceCharting crawler adapter（來源：pricecharting.com 單卡詳情頁）－ PRD FR-07
// 目標 HTML：<td id="used_price"><span class="price js-price">$948.43</span>
// 回傳帶符號的 rawText，清洗交給 service 的 normalizePrice
import * as cheerio from 'cheerio';
import { assertPriceResult } from '../contract.js';

const PRICE_SELECTOR = '#used_price .price.js-price';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

export const priceChartingAdapter = {
  type: 'crawler',
  name: 'priceCharting',
  async fetchPrice(source) {
    const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);

    // ── 換來源時只改這段：價格在哪個 CSS selector ──
    const rawText = $(PRICE_SELECTOR).first().text().trim();
    if (!rawText) throw new Error('找不到價格 selector（頁面可能改版）');

    return assertPriceResult({
      provider: source.provider,
      rawText,
      currency: source.currency || 'USD',
      fetchedAt: new Date().toISOString(),
    });
  },
};
