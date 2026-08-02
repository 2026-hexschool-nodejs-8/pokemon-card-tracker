import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { extractProductIds, scrapeCard } from './tcgplayer.scraper.js';
import latestSalesFixture from '../../../testkit/fixtures/tcgplayer.latestsales.json' with { type: 'json' };
import spotlightFixture from '../../../testkit/fixtures/tcgplayer.spotlight.json' with { type: 'json' };

// 擋掉所有未被 nock 攔截的外連：漏網的呼叫要直接失敗，而不是靜靜地打到真實 TCGPlayer
before(() => nock.disableNetConnect());
after(() => nock.enableNetConnect());

test('flat object with productId', () => {
  assert.deepEqual(extractProductIds({ productId: 123, name: 'Charizard' }), [123]);
});

test('nested array of objects', () => {
  const input = { results: [{ productId: 100 }, { productId: 200 }] };
  assert.deepEqual(extractProductIds(input), [100, 200]);
});

test('ignores zero and negative numbers', () => {
  assert.deepEqual(extractProductIds({ productId: 0, id: -1 }), []);
});

test('ignores string values in id fields', () => {
  assert.deepEqual(extractProductIds({ productId: '123' }), []);
});

test('null input returns empty array', () => {
  assert.deepEqual(extractProductIds(null), []);
});

test('undefined input returns empty array', () => {
  assert.deepEqual(extractProductIds(undefined), []);
});

test('深層巢狀依然找得到', () => {
  const input = { a: { b: { c: [{ productId: 999 }] } } };
  assert.deepEqual(extractProductIds(input), [999]);
});

test('三種欄位命名（ProductId / product_id / productId）都會被撈到', () => {
  const input = [{ ProductId: 1 }, { product_id: 2 }, { productId: 3 }];
  assert.deepEqual(extractProductIds(input), [1, 2, 3]);
});

test('同一物件命中多個欄位名時，各自都算一筆', () => {
  const input = { productId: 1, ProductId: 2 };
  assert.deepEqual(extractProductIds(input), [1, 2]);
});

// （R10）extractProductIds 對整份 response 遞迴掃描所有欄位，
// 沒有區分「搜尋結果卡片」與「推薦／廣告區塊」，兩者的 id 會混在一起。
// 這裡先記錄現況行為；若要修正，需要改成只掃描特定路徑（如 response.results）。
test('（R10）推薦區塊的 productId 目前會與搜尋結果混在一起（現況行為）', () => {
  const input = {
    searchResults: [{ productId: 111 }],
    recommendations: { relatedProducts: [{ productId: 999 }] },
  };
  assert.deepEqual(extractProductIds(input), [111, 999]);
});

test('scrapeCard：latestsales 與 spotlight 皆成功時，price 取 spotlight 優先', async (t) => {
  t.after(() => nock.cleanAll());
  nock('https://mpapi.tcgplayer.com')
    .post('/v2/product/123/latestsales?mpfev=5293')
    .reply(200, latestSalesFixture);
  nock('https://data.tcgplayer.com')
    .post('/spotlight/search/123')
    .reply(200, spotlightFixture);

  const result = await scrapeCard(123);
  assert.equal(result.price, 47.99);
  assert.equal(result.name, 'Charizard ex - 199/165');
  assert.equal(result.imageUrl, 'https://tcgplayer-cdn.tcgplayer.com/product/123_in_1000x1000.jpg');
  assert.equal(result.latestSales.length, 2); // purchasePrice: 0 那筆被 filter 掉
});

test('scrapeCard：spotlight 失敗時降級用 latestsales 第一筆的 purchasePrice', async (t) => {
  t.after(() => nock.cleanAll());
  nock('https://mpapi.tcgplayer.com')
    .post('/v2/product/123/latestsales?mpfev=5293')
    .reply(200, latestSalesFixture);
  nock('https://data.tcgplayer.com')
    .post('/spotlight/search/123')
    .reply(500);

  const result = await scrapeCard(123);
  assert.equal(result.price, 45.5); // salesData[0].purchasePrice
});

test('scrapeCard：latestsales 失敗時直接 throw，訊息含 productId', async (t) => {
  t.after(() => nock.cleanAll());
  nock('https://mpapi.tcgplayer.com')
    .post('/v2/product/456/latestsales?mpfev=5293')
    .reply(500);
  nock('https://data.tcgplayer.com')
    .post('/spotlight/search/456')
    .reply(200, spotlightFixture);

  await assert.rejects(() => scrapeCard(456), /productId 456/);
});

test('scrapeCard：salesData 為空陣列時 name fallback 為 Product <id>，price 為 null', async (t) => {
  t.after(() => nock.cleanAll());
  nock('https://mpapi.tcgplayer.com')
    .post('/v2/product/789/latestsales?mpfev=5293')
    .reply(200, { data: [] });
  nock('https://data.tcgplayer.com')
    .post('/spotlight/search/789')
    .reply(200, { spotlight: {} });

  const result = await scrapeCard(789);
  assert.equal(result.name, 'Product 789');
  assert.equal(result.price, null);
  assert.deepEqual(result.latestSales, []);
});

test('scrapeCard：purchasePrice <= 0 的成交會被排除在 latestSales 之外', async (t) => {
  t.after(() => nock.cleanAll());
  nock('https://mpapi.tcgplayer.com')
    .post('/v2/product/123/latestsales?mpfev=5293')
    .reply(200, latestSalesFixture);
  nock('https://data.tcgplayer.com')
    .post('/spotlight/search/123')
    .reply(200, spotlightFixture);

  const result = await scrapeCard(123);
  assert.ok(result.latestSales.every((s) => s.purchasePrice > 0));
});

test('scrapeCard：TCGPLAYER_COOKIE 有設定時，request header 會帶 Cookie', async (t) => {
  const original = process.env.TCGPLAYER_COOKIE;
  process.env.TCGPLAYER_COOKIE = 'session=abc123';
  t.after(() => {
    nock.cleanAll();
    if (original === undefined) delete process.env.TCGPLAYER_COOKIE;
    else process.env.TCGPLAYER_COOKIE = original;
  });

  let capturedCookie;
  nock('https://mpapi.tcgplayer.com')
    .post('/v2/product/123/latestsales?mpfev=5293')
    .reply(function reply() {
      capturedCookie = this.req.headers['cookie'];
      return [200, latestSalesFixture];
    });
  nock('https://data.tcgplayer.com')
    .post('/spotlight/search/123')
    .reply(200, spotlightFixture);

  await scrapeCard(123);
  assert.equal(capturedCookie, 'session=abc123');
});

// getProductIds 需要 Playwright 開真的瀏覽器，這裡用 t.mock.module 換掉 'playwright'，
// 隔離 chromium／網路，並用假的 response 事件模擬「頁面收到搜尋 API 回應」這件事。
// 每個測試都用帶查詢字串的動態 import 拿一份全新的 tcgplayer.scraper.js，
// 確保它內部的 `import { chromium } from 'playwright'` 會重新解析到當次 mock 的版本。
function makeFakeResponse({ url, json, contentType = 'application/json' }) {
  return {
    url: () => url,
    headers: () => ({ 'content-type': contentType }),
    json: async () => json,
  };
}

function makeFakeChromium(responses) {
  return {
    launch: async () => ({
      newContext: async () => ({
        newPage: async () => {
          const listeners = [];
          return {
            on: (event, cb) => {
              if (event === 'response') listeners.push(cb);
            },
            goto: async () => {
              for (const response of responses) {
                for (const cb of listeners) cb(response);
              }
            },
            waitForTimeout: async () => {},
          };
        },
      }),
      close: async () => {},
    }),
  };
}

async function loadGetProductIds(t, responses) {
  t.mock.module('playwright', { exports: { chromium: makeFakeChromium(responses) } });
  const mod = await import(`./tcgplayer.scraper.js?t=${Date.now()}-${Math.random()}`);
  return mod.getProductIds;
}

test('getProductIds：完全沒收到任何符合條件的回應（頁面可能沒載入成功）→ throw', async (t) => {
  const getProductIds = await loadGetProductIds(t, []);
  await assert.rejects(() => getProductIds(1), /無法從搜尋頁取得 productId/);
});

test('getProductIds：非 JSON／非 tcgplayer 網域的回應會被忽略，等同沒收到回應 → throw', async (t) => {
  const noise = makeFakeResponse({ url: 'https://example.com/tracking.gif', contentType: 'image/gif', json: {} });
  const getProductIds = await loadGetProductIds(t, [noise]);
  await assert.rejects(() => getProductIds(1));
});

test('getProductIds：有收到搜尋 API 回應但內容沒有任何 productId（真的查無結果）→ 回傳空陣列，不 throw', async (t) => {
  const empty = makeFakeResponse({
    url: 'https://mpapi.tcgplayer.com/v2/search/request?q=xxxxxxxxxx',
    json: { results: [] },
  });
  const getProductIds = await loadGetProductIds(t, [empty]);
  const result = await getProductIds(1, 'xxxxxxxxxx');
  assert.deepEqual(result, []);
});

test('getProductIds：正常回應含 productId → 回傳去重後的陣列', async (t) => {
  const withResults = makeFakeResponse({
    url: 'https://mpapi.tcgplayer.com/v2/search/request',
    json: { results: [{ productId: 111 }, { productId: 111 }, { productId: 222 }] },
  });
  const getProductIds = await loadGetProductIds(t, [withResults]);
  const result = await getProductIds(1);
  assert.deepEqual(result, [111, 222]);
});
