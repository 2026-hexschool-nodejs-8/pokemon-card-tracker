import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter } from '../registry.js';
import { mockApiAdapter } from './mockApi.adapter.js';
import { tcgdexApiAdapter } from './tcgdexApi.adapter.js';

/**
 * 真實 API adapter 測試設定。新增 adapter 時在此加一筆即可。
 *
 * @typedef {object} ApiAdapterFixture
 * @property {{ type: string, name: string, fetchPrice: Function }} adapter
 * @property {object} source PriceSource 最小欄位（provider / url / currency）
 * @property {object} successBody mock fetch 成功時回傳的 JSON body
 * @property {number} expectedPrice
 * @property {string} [expectedCurrency] 預設取 source.currency
 * @property {Record<string, string|undefined>} [expectedHeaders] 預期 fetch 帶上的 headers
 * @property {object} malformedBody 缺價格欄位時的 JSON body
 * @property {RegExp|string|((err: Error) => boolean)} malformedError
 */

/** @type {ApiAdapterFixture[]} */
const API_ADAPTER_FIXTURES = [
  {
    adapter: tcgdexApiAdapter,
    source: {
      provider: 'tcgdexApi',
      url: 'https://example.test/v2/cards/hgss4-1',
      currency: 'EUR',
    },
    successBody: {
      data: {
        cardmarket: {
          prices: { trendPrice: 12.34 },
        },
      },
    },
    expectedPrice: 12.34,
    expectedCurrency: 'EUR',
    expectedHeaders: { 'X-Api-Key': process.env.TCGDEX_API_KEY },
    malformedBody: { data: {} },
    malformedError: /Cannot read properties|cardmarket|prices/,
  },
];

function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fixtureLabel(fixture) {
  return fixture.adapter.name;
}

function matchesMalformedError(pattern, err) {
  if (typeof pattern === 'function') return pattern(err);
  if (pattern instanceof RegExp) return pattern.test(err.message);
  return err.message.includes(pattern);
}

for (const fixture of API_ADAPTER_FIXTURES) {
  const label = fixtureLabel(fixture);

  test(`api adapter ${label} is registered by provider name`, () => {
    assert.equal(fixture.adapter.type, 'api');
    assert.equal(getAdapter({ type: 'api', provider: fixture.adapter.name }), fixture.adapter);
  });

  test(`api adapter ${label} parses success JSON into PriceResult`, async () => {
    const restoreFetch = mockFetch(async () => jsonResponse(fixture.successBody));

    try {
      const result = await fixture.adapter.fetchPrice(fixture.source);

      assert.equal(result.provider, fixture.source.provider);
      assert.equal(result.price, fixture.expectedPrice);
      assert.equal(result.currency, fixture.expectedCurrency ?? fixture.source.currency);
      assert.ok(result.fetchedAt);
      assert.doesNotThrow(() => new Date(result.fetchedAt).toISOString());
    } finally {
      restoreFetch();
    }
  });

  test(`api adapter ${label} throws HTTP status for non-200 responses`, async () => {
    const restoreFetch = mockFetch(async () => jsonResponse({}, { ok: false, status: 429 }));

    try {
      await assert.rejects(
        () => fixture.adapter.fetchPrice(fixture.source),
        /HTTP 429/,
      );
    } finally {
      restoreFetch();
    }
  });

  test(`api adapter ${label} throws when price field is missing in JSON`, async () => {
    const restoreFetch = mockFetch(async () => jsonResponse(fixture.malformedBody));

    try {
      await assert.rejects(
        () => fixture.adapter.fetchPrice(fixture.source),
        (err) => matchesMalformedError(fixture.malformedError, err),
      );
    } finally {
      restoreFetch();
    }
  });

  if (fixture.expectedHeaders) {
    test(`api adapter ${label} sends expected request headers`, async () => {
      /** @type {Record<string, string>|undefined} */
      let capturedHeaders;

      const restoreFetch = mockFetch(async (_url, options = {}) => {
        capturedHeaders = options.headers;
        return jsonResponse(fixture.successBody);
      });

      try {
        await fixture.adapter.fetchPrice(fixture.source);

        for (const [key, value] of Object.entries(fixture.expectedHeaders)) {
          assert.equal(capturedHeaders?.[key], value, `header ${key}`);
        }
      } finally {
        restoreFetch();
      }
    });
  }
}

test('registry keeps mockApi as fallback for unknown api providers', () => {
  const adapter = getAdapter({ type: 'api', provider: 'unknown-api-provider' });
  assert.equal(adapter.name, mockApiAdapter.name);
});
