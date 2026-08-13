// 固定時區，讓「本地日期分桶」的斷言在任何機器上結果一致。
// 必須在載入受測模組之前設定。
process.env.TZ = 'Asia/Taipei';

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailySeries, RANGE_DAYS, TCG_MARKET_SERIES_KEY } from './priceSeries.js';

// 測試基準時間：台灣時間 2026-08-10 12:00
const NOW = new Date('2026-08-10T04:00:00Z');

function snap({ provider = 'mockApi', priceTwd = 1000, fetchedAt, isSuspicious = false }) {
  return { provider, priceTwd, fetchedAt, isSuspicious, price: priceTwd, currency: 'TWD' };
}

describe('buildDailySeries — 基本結構', () => {
  test('空輸入回傳空結果，不 throw', () => {
    const r = buildDailySeries({ snapshots: [], tcgBuckets: null, days: 7, now: NOW });
    assert.deepEqual(r.series, []);
    assert.deepEqual(r.points, []);
  });

  test('RANGE_DAYS 為固定天數 7 / 30 / 90，不使用曆月', () => {
    assert.deepEqual(RANGE_DAYS, [7, 30, 90]);
  });

  test('單一來源連續多日，產出一條 series', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-08T02:00:00Z', priceTwd: 100 }),
      snap({ fetchedAt: '2026-08-09T02:00:00Z', priceTwd: 110 }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 120 }),
    ];
    const { series, points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });

    assert.equal(series.length, 1);
    assert.equal(series[0].key, 'mockApi');
    assert.equal(points.length, 3, '骨架起點應裁切到最早有資料日');
    assert.deepEqual(points.map((p) => p.dateKey), ['2026-08-08', '2026-08-09', '2026-08-10']);
    assert.deepEqual(points.map((p) => p.mockApi), [100, 110, 120]);
  });

  test('僅單一天資料也能正常產出（FR-020）', () => {
    const snapshots = [snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 500 })];
    const { series, points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 30, now: NOW });
    assert.equal(series.length, 1);
    assert.equal(points.length, 1);
    assert.equal(points[0].mockApi, 500);
  });
});

describe('buildDailySeries — 資料規則', () => {
  test('priceTwd 為 null 的快照被排除（FR-007）', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-09T02:00:00Z', priceTwd: null }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 200 }),
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(points.length, 1, '無台幣值的日期不應成為骨架起點');
    assert.equal(points[0].dateKey, '2026-08-10');
  });

  test('全部無法換算時 series 為空（供呼叫端顯示換算失敗訊息）', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-09T02:00:00Z', priceTwd: null }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: null }),
    ];
    const { series, points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.deepEqual(series, []);
    assert.deepEqual(points, []);
  });

  test('同日同來源多筆時取 fetchedAt 最大者（FR-006）', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-10T01:00:00Z', priceTwd: 111 }),
      snap({ fetchedAt: '2026-08-10T09:00:00Z', priceTwd: 999 }),
      snap({ fetchedAt: '2026-08-10T05:00:00Z', priceTwd: 555 }),
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(points.length, 1);
    assert.equal(points[0].mockApi, 999, '應取當天最後一筆，與輸入順序無關');
  });

  test('同日不同來源互不影響', () => {
    const snapshots = [
      snap({ provider: 'mockApi', fetchedAt: '2026-08-10T01:00:00Z', priceTwd: 100 }),
      snap({ provider: 'mockCrawler', fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 200 }),
    ];
    const { series, points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(series.length, 2);
    assert.equal(points[0].mockApi, 100);
    assert.equal(points[0].mockCrawler, 200);
  });

  test('某來源當日無資料時該欄位為 null（FR-008）', () => {
    const snapshots = [
      snap({ provider: 'mockApi', fetchedAt: '2026-08-08T02:00:00Z', priceTwd: 100 }),
      snap({ provider: 'mockCrawler', fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 200 }),
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(points.length, 3);
    assert.equal(points[1].mockApi, null, '中間日無資料應為 null 而非省略欄位');
    assert.equal(points[0].mockCrawler, null);
  });

  test('疑似異常標記寫入 __suspicious（FR-021）', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-09T02:00:00Z', priceTwd: 100 }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 9999, isSuspicious: true }),
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(points[0].__suspicious.mockApi, undefined);
    assert.equal(points[1].__suspicious.mockApi, true);
    assert.equal(points[1].mockApi, 9999, '異常價仍須呈現，不得排除');
  });
});

describe('buildDailySeries — 本地時區分桶（FR-009）', () => {
  test('UTC 傍晚的快照歸屬於台灣時間的隔天', () => {
    // 2026-08-09T16:30Z = 台灣 2026-08-10 00:30
    const snapshots = [snap({ fetchedAt: '2026-08-09T16:30:00Z', priceTwd: 777 })];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(points[0].dateKey, '2026-08-10', 'toISOString().slice(0,10) 會誤判為 08-09');
  });

  test('跨本地午夜的兩筆屬於不同日，不會被當成同日去重', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-09T15:00:00Z', priceTwd: 111 }), // 台灣 08-09 23:00
      snap({ fetchedAt: '2026-08-09T17:00:00Z', priceTwd: 222 }), // 台灣 08-10 01:00
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(points.length, 2);
    assert.equal(points[0].mockApi, 111);
    assert.equal(points[1].mockApi, 222);
  });
});

describe('buildDailySeries — 日期骨架（FR-002、FR-012）', () => {
  test('資料涵蓋超過區間時，骨架長度等於區間天數', () => {
    const snapshots = Array.from({ length: 20 }, (_, i) =>
      snap({ fetchedAt: new Date(NOW.getTime() - i * 86400000).toISOString(), priceTwd: 100 + i }),
    );
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(points.length, 7);
    assert.equal(points.at(-1).dateKey, '2026-08-10', '終點為今日');
    assert.equal(points[0].dateKey, '2026-08-04', '起點為今日往前 days-1 天');
  });

  test('資料少於區間時，骨架起點裁切至最早有資料日（不留大片空白）', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-08T02:00:00Z', priceTwd: 100 }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 120 }),
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 90, now: NOW });
    assert.equal(points.length, 3, '不應補滿 90 格');
    assert.equal(points[0].dateKey, '2026-08-08');
  });

  test('骨架日期連續且不跳號', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-05T02:00:00Z', priceTwd: 100 }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 120 }),
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 30, now: NOW });
    assert.deepEqual(
      points.map((p) => p.dateKey),
      ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10'],
    );
  });

  test('區間外的舊資料不納入，也不會把骨架往前拉', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-07-01T02:00:00Z', priceTwd: 1 }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 120 }),
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.ok(!points.some((p) => p.dateKey === '2026-07-01'));
    // 區間內只有 08-10 有資料，依 FR-012 骨架起點裁切至該日
    assert.equal(points.length, 1);
    assert.equal(points[0].dateKey, '2026-08-10');
  });
});

describe('buildDailySeries — series 排序與命名（FR-003、FR-029）', () => {
  test('我方 provider 依字母序排列', () => {
    const snapshots = [
      snap({ provider: 'zebra', fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 1 }),
      snap({ provider: 'alpha', fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 2 }),
      snap({ provider: 'mango', fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 3 }),
    ];
    const { series } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.deepEqual(series.map((s) => s.key), ['alpha', 'mango', 'zebra']);
  });

  test('series 只含區間內實際有資料的來源（FR-003）', () => {
    const snapshots = [
      snap({ provider: 'mockApi', fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 1 }),
      snap({ provider: 'old', fetchedAt: '2026-01-01T02:00:00Z', priceTwd: 2 }),
    ];
    const { series } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.deepEqual(series.map((s) => s.key), ['mockApi']);
  });

  test('外部市場行情固定排在最後，且與同名的我方來源可區分（FR-015）', () => {
    const snapshots = [snap({ provider: 'tcgplayer', fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 1 })];
    const tcgBuckets = [{ bucketStartDate: '2026-08-10', marketPriceTwd: 5000, quantitySold: '3' }];
    const { series } = buildDailySeries({ snapshots, tcgBuckets, days: 7, now: NOW });

    assert.equal(series.length, 2);
    assert.equal(series.at(-1).key, TCG_MARKET_SERIES_KEY);
    assert.notEqual(series[0].key, series[1].key, '兩者的 key 必須不同');
    assert.equal(series.at(-1).isExternal, true);
    assert.equal(series[0].isExternal, false);
  });
});

describe('buildDailySeries — 外部市場行情併入（FR-031）', () => {
  test('依 bucketStartDate 對進骨架，並帶出成交量', () => {
    const snapshots = [snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 100 })];
    const tcgBuckets = [{ bucketStartDate: '2026-08-10', marketPriceTwd: 5000, quantitySold: '4' }];
    const { points } = buildDailySeries({ snapshots, tcgBuckets, days: 7, now: NOW });
    assert.equal(points.at(-1)[TCG_MARKET_SERIES_KEY], 5000);
    assert.equal(points.at(-1).__tcgQuantitySold, 4);
  });

  test('粒度粗於一天時，中間日期維持 null，不補值不插值', () => {
    const snapshots = [
      snap({ fetchedAt: '2026-08-07T02:00:00Z', priceTwd: 100 }),
      snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 100 }),
    ];
    const tcgBuckets = [
      { bucketStartDate: '2026-08-07', marketPriceTwd: 5000, quantitySold: '0' },
      { bucketStartDate: '2026-08-10', marketPriceTwd: 5300, quantitySold: '0' },
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets, days: 30, now: NOW });
    assert.equal(points.length, 4);
    assert.equal(points[0][TCG_MARKET_SERIES_KEY], 5000);
    assert.equal(points[1][TCG_MARKET_SERIES_KEY], null, '不得填補');
    assert.equal(points[2][TCG_MARKET_SERIES_KEY], null, '不得插值');
    assert.equal(points[3][TCG_MARKET_SERIES_KEY], 5300);
  });

  test('marketPriceTwd 為 null 的 bucket 等同無資料', () => {
    const snapshots = [snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 100 })];
    const tcgBuckets = [{ bucketStartDate: '2026-08-10', marketPriceTwd: null, quantitySold: '0' }];
    const { series, points } = buildDailySeries({ snapshots, tcgBuckets, days: 7, now: NOW });
    assert.ok(!series.some((s) => s.isExternal), '全部無值時不應產生外部 series');
    assert.equal(points.at(-1)[TCG_MARKET_SERIES_KEY], undefined);
  });

  test('落在骨架範圍外的 bucket 被忽略，不擴張骨架', () => {
    const snapshots = [snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 100 })];
    const tcgBuckets = [
      { bucketStartDate: '2020-01-01', marketPriceTwd: 1, quantitySold: '0' },
      { bucketStartDate: '2026-08-10', marketPriceTwd: 5000, quantitySold: '0' },
    ];
    const { points } = buildDailySeries({ snapshots, tcgBuckets, days: 7, now: NOW });
    assert.equal(points.length, 1);
    assert.equal(points[0].dateKey, '2026-08-10');
  });

  test('tcgBuckets 為 null 時不影響其餘來源（FR-016）', () => {
    const snapshots = [snap({ fetchedAt: '2026-08-10T02:00:00Z', priceTwd: 100 })];
    const { series, points } = buildDailySeries({ snapshots, tcgBuckets: null, days: 7, now: NOW });
    assert.equal(series.length, 1);
    assert.equal(points[0].mockApi, 100);
  });
});
