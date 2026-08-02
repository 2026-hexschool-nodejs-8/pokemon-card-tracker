// tcgplayerCrawlerAdapter 單元測試
// scrapeCard 用 mock.module 換掉，隔離網路與 chromium
import test from 'node:test';
import assert from 'node:assert/strict';

// t.mock（測試自己的 MockTracker）在該測試結束時會自動 restore，
// 不會像全域 mock.module 那樣在下一個測試重複呼叫時丟 ERR_INVALID_STATE
async function loadAdapterWithScrapeCard(t, scrapeCardImpl) {
  t.mock.module('./tcgplayer.scraper.js', {
    exports: { scrapeCard: scrapeCardImpl, getProductIds: async () => [] },
  });
  const mod = await import(`./tcgplayerCrawler.adapter.js?t=${Date.now()}-${Math.random()}`);
  return mod.tcgplayerCrawlerAdapter;
}

test('externalId 非正整數（字串 "abc"）→ throw 且訊息含收到的值', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({}));
  await assert.rejects(
    () => adapter.fetchPrice({ externalId: 'abc', currency: 'USD' }),
    /需要正整數 externalId，收到: abc/,
  );
});

test('externalId 為 "0" → throw', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({}));
  await assert.rejects(() => adapter.fetchPrice({ externalId: '0', currency: 'USD' }));
});

test('externalId 為 "-1" → throw', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({}));
  await assert.rejects(() => adapter.fetchPrice({ externalId: '-1', currency: 'USD' }));
});

test('externalId 為 undefined → throw', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({}));
  await assert.rejects(() => adapter.fetchPrice({ currency: 'USD' }));
});

test('scrapeCard 回傳 price: null → throw「無法取得價格」', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({
    productId: 123,
    name: 'Test Card',
    imageUrl: 'https://example.test/x.jpg',
    price: null,
    latestSales: [],
  }));
  await assert.rejects(
    () => adapter.fetchPrice({ externalId: '123', currency: 'USD' }),
    /無法取得價格/,
  );
});

test('正常路徑：currency 取 source.currency，assertPriceResult 通過', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({
    productId: 123,
    name: 'Test Card',
    imageUrl: 'https://example.test/x.jpg',
    price: 45.5,
    latestSales: [{ purchasePrice: 45.5, orderDate: '2026-07-20T10:00:00Z' }],
  }));
  const result = await adapter.fetchPrice({ externalId: '123', currency: 'USD' });
  assert.equal(result.provider, 'tcgplayer');
  assert.equal(result.price, 45.5);
  assert.equal(result.currency, 'USD');
  assert.equal(result.imageUrl, 'https://example.test/x.jpg');
});

test('currency 缺省時 fallback 為 USD', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({
    productId: 123,
    name: 'Test Card',
    imageUrl: 'https://example.test/x.jpg',
    price: 10,
    latestSales: [],
  }));
  const result = await adapter.fetchPrice({ externalId: '123' });
  assert.equal(result.currency, 'USD');
});

// R1：admin.import.js 用 validSales[length-1] 當「最新一筆」，
// 這裡的 adapter 用 latestSales[0] 當「最新一筆」－ 兩者假設相反。
// 此測試鎖住 adapter 目前的實際行為（取第一筆），供交叉比對 admin.import.js 的行為（見 admin.import.test.js IMP-07）。
test('（R1）fetchedAt 目前採用 latestSales[0] 的 orderDate（而非最後一筆）', async (t) => {
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({
    productId: 123,
    name: 'Test Card',
    imageUrl: 'https://example.test/x.jpg',
    price: 45.5,
    latestSales: [
      { purchasePrice: 45.5, orderDate: '2026-07-20T10:00:00Z' }, // [0] － adapter 視為最新
      { purchasePrice: 42, orderDate: '2026-07-25T10:00:00Z' }, // 實際日期較新，但排在 [1]
    ],
  }));
  const result = await adapter.fetchPrice({ externalId: '123', currency: 'USD' });
  assert.equal(result.fetchedAt, new Date('2026-07-20T10:00:00Z').toISOString());
});

test('latestSales 為空陣列 → fetchedAt 使用目前時間', async (t) => {
  const before = Date.now();
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({
    productId: 123,
    name: 'Test Card',
    imageUrl: 'https://example.test/x.jpg',
    price: 10,
    latestSales: [],
  }));
  const result = await adapter.fetchPrice({ externalId: '123', currency: 'USD' });
  const fetchedAtMs = new Date(result.fetchedAt).getTime();
  assert.ok(fetchedAtMs >= before && fetchedAtMs <= Date.now());
});

test('latestSales[0].orderDate 為無效字串 → 目前無防呆，直接 throw RangeError', async (t) => {
  // new Date('not-a-date').toISOString() 會丟 RangeError，adapter 沒有 try/catch，
  // 會被 priceSync 的單一來源錯誤處理接住（不中斷整個 job），但錯誤訊息對使用者不友善
  const adapter = await loadAdapterWithScrapeCard(t, async () => ({
    productId: 123,
    name: 'Test Card',
    imageUrl: 'https://example.test/x.jpg',
    price: 10,
    latestSales: [{ purchasePrice: 10, orderDate: 'not-a-date' }],
  }));
  await assert.rejects(
    () => adapter.fetchPrice({ externalId: '123', currency: 'USD' }),
    /Invalid time value/,
  );
});
