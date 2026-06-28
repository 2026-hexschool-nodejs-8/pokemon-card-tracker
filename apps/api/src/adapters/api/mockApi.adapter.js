// Mock API adapter － 模擬「呼叫外部 API 取得 JSON 價格」的流程
// 真實串接時把 simulateApiCall 換成 fetch(source.url) 即可，輸出格式不變
import { assertPriceResult } from '../contract.js';

// 用來源代碼產生穩定的基礎價格，讓每次抓的價格在合理範圍波動
function basePriceOf(seed = '') {
  const sum = [...seed].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return 2000 + (sum % 20) * 500; // 2000 ~ 11500
}

async function simulateApiCall(source) {
  // 模擬網路延遲
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

  // 來源代碼含 "fail" 時，模擬失敗（方便 Demo 失敗處理流程）
  if ((source.externalId || source.url || '').includes('fail')) {
    const err = new Error('mock API 回傳 429 Too Many Requests');
    err.statusCode = 429;
    throw err;
  }

  const base = basePriceOf(source.externalId || source.provider);
  const price = Math.round(base * (1 + (Math.random() - 0.5) * 0.1));
  return { data: { price, currency: source.currency || 'JPY' } };
}

export const mockApiAdapter = {
  type: 'api',
  name: 'mockApi',
  async fetchPrice(source) {
    const res = await simulateApiCall(source);
    return assertPriceResult({
      provider: source.provider,
      price: res.data.price,
      currency: res.data.currency,
      fetchedAt: new Date().toISOString(),
    });
  },
};
