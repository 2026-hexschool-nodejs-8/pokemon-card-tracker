import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter } from '../registry.js';
import { cardLandAdapter } from './cardLand.adapter.js';
import { priceChartingAdapter } from './priceCharting.adapter.js';
import { rakutenAdapter } from './rakuten.adapter.js';

function mockFetchOnce(response) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('crawler adapters use provider names expected by PriceSource records', () => {
  assert.equal(cardLandAdapter.name, 'cardLand');
  assert.equal(priceChartingAdapter.name, 'priceCharting');
  assert.equal(rakutenAdapter.name, 'rakuten');

  assert.equal(getAdapter({ type: 'crawler', provider: 'cardLand' }), cardLandAdapter);
  assert.equal(getAdapter({ type: 'crawler', provider: 'priceCharting' }), priceChartingAdapter);
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
