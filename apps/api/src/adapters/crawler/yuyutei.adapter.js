// 遊々亭（yuyu-tei.jp）crawler adapter － PRD FR-07
// 抓 source.url 的 HTML，用 cheerio 取出價格文字，
// 回傳帶符號的 rawText（例 "17,800 円"），清洗交給 service 的 normalizePrice
import * as cheerio from 'cheerio';
import { assertPriceResult } from '../contract.js';

const PRICE_SELECTOR = 'h4.fw-bold.d-inline-block';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

export const yuyuteiAdapter = {
  type: 'crawler',
  name: 'yuyutei',
  async fetchPrice(source) {
    const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    const $ = cheerio.load(html);

    const rawText = $(PRICE_SELECTOR).first().text().trim();
    if (!rawText) throw new Error('找不到價格 selector（頁面可能改版）');

    return assertPriceResult({
      provider: source.provider,
      rawText,
      currency: source.currency || 'JPY',
      fetchedAt: new Date().toISOString(),
    });
  },
};
