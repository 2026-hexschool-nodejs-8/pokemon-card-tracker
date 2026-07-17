import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdapter } from '../registry.js';
import { cardLandAdapter } from './cardLand.adapter.js';
import { priceChartingAdapter } from './priceCharting.adapter.js';
import { rakutenAdapter } from './rakuten.adapter.js';
import { yuyuteiAdapter } from './yuyutei.adapter.js';

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../crawler source test htmls',
);

function mockFetchOnce(response) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function htmlResponse(html) {
  return {
    ok: true,
    status: 200,
    text: async () => html,
  };
}

test('crawler adapters use provider names expected by PriceSource records', () => {
  assert.equal(cardLandAdapter.name, 'cardLand');
  assert.equal(priceChartingAdapter.name, 'priceCharting');
  assert.equal(rakutenAdapter.name, 'rakuten');
  assert.equal(yuyuteiAdapter.name, 'yuyutei');

  assert.equal(getAdapter({ type: 'crawler', provider: 'cardLand' }), cardLandAdapter);
  assert.equal(getAdapter({ type: 'crawler', provider: 'priceCharting' }), priceChartingAdapter);
  assert.equal(getAdapter({ type: 'crawler', provider: 'yuyutei' }), yuyuteiAdapter);
});

test('crawler adapter throws HTTP status for non-200 responses', async () => {
  const restoreFetch = mockFetchOnce({
    ok: false,
    status: 429,
    text: async () => '',
  });

  try {
    await assert.rejects(
      () => rakutenAdapter.fetchPrice({ provider: 'rakuten', url: 'https://example.test/rate-limited' }),
      /HTTP 429/,
    );
  } finally {
    restoreFetch();
  }
});

test('crawler adapter throws when selector cannot find a price', async () => {
  const restoreFetch = mockFetchOnce({
    ok: true,
    status: 200,
    text: async () => '<html><body><p>price moved</p></body></html>',
  });

  try {
    await assert.rejects(
      () => cardLandAdapter.fetchPrice({ provider: 'cardLand', url: 'https://example.test/moved' }),
      /找不到價格 selector/,
    );
  } finally {
    restoreFetch();
  }
});

test('registry keeps mock crawler as fallback for demo sources', () => {
  const adapter = getAdapter({ type: 'crawler', provider: 'unknown-demo-provider' });
  assert.equal(adapter.name, 'mockCrawler');
});

/** @type {{ adapter: object, fixture: string, source: object, expectedImageUrl: string }[]} */
const IMAGE_FIXTURES = [
  {
    adapter: cardLandAdapter,
    fixture: 'cardland.html',
    source: { provider: 'cardLand', url: 'https://cardland.com.hk/product/test', currency: 'HKD' },
    expectedImageUrl: 'https://cardland.com.hk/wp-content/uploads/hk00019069.png',
  },
  {
    adapter: rakutenAdapter,
    fixture: 'rakuten.html',
    source: { provider: 'rakuten', url: 'https://item.rakuten.co.jp/fullahead/test', currency: 'JPY' },
    expectedImageUrl:
      'https://shop.r10s.jp/fullahead/cabinet/02950370/02950380/02950425/pmf-09-071.jpg',
  },
  {
    adapter: yuyuteiAdapter,
    fixture: 'yiyi-tei.html',
    source: { provider: 'yuyutei', url: 'https://yuyu-tei.jp/sell/poc/card/test', currency: 'JPY' },
    expectedImageUrl: 'https://card.yuyu-tei.jp/poc/front/sm11/10095.jpg',
  },
  {
    adapter: priceChartingAdapter,
    fixture: 'pricecharting.html',
    source: {
      provider: 'priceCharting',
      url: 'https://www.pricecharting.com/game/pokemon-promo/test',
      currency: 'USD',
    },
    expectedImageUrl:
      'https://storage.googleapis.com/images.pricecharting.com/5e96704258cea7c698de7602006f71dfe88d868c0c9585a1e11055de7d488007/240.jpg',
  },
];

for (const fixture of IMAGE_FIXTURES) {
  test(`crawler adapter ${fixture.adapter.name} parses imageUrl from fixture HTML`, async () => {
    const html = await readFile(path.join(FIXTURE_DIR, fixture.fixture), 'utf8');
    const restoreFetch = mockFetchOnce(htmlResponse(html));

    try {
      const result = await fixture.adapter.fetchPrice(fixture.source);
      assert.equal(result.imageUrl, fixture.expectedImageUrl);
      assert.ok(result.rawText);
    } finally {
      restoreFetch();
    }
  });
}

test('crawler adapter succeeds without imageUrl when image selector is missing', async () => {
  const restoreFetch = mockFetchOnce(
    htmlResponse(
      '<html><body><p class="price product-page-price">HK$100.00</p></body></html>',
    ),
  );

  try {
    const result = await cardLandAdapter.fetchPrice({
      provider: 'cardLand',
      url: 'https://example.test/no-image',
      currency: 'HKD',
    });
    assert.match(result.rawText, /100/);
    assert.equal(result.imageUrl, undefined);
  } finally {
    restoreFetch();
  }
});
