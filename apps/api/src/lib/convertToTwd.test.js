import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertToTwd } from './convertToTwd.js';

const rates = new Map([['USD', 32.15], ['JPY', 0.223], ['HKD', 4.11]]);

test('TWD 直通、不換算', () => {
  assert.deepEqual(convertToTwd(500, 'TWD', rates), { priceTwd: 500, reason: null });
});

test('USD 換算並四捨五入到整數', () => {
  assert.deepEqual(convertToTwd(9.99, 'USD', rates), { priceTwd: 321, reason: null });
});

test('JPY 換算', () => {
  assert.deepEqual(convertToTwd(1200, 'JPY', rates), { priceTwd: 268, reason: null });
});

test('查不到幣別 → priceTwd null + 原因', () => {
  const r = convertToTwd(100, 'EUR', rates);
  assert.equal(r.priceTwd, null);
  assert.match(r.reason, /找不到 EUR/);
});

test('匯率無效（0）→ priceTwd null', () => {
  assert.equal(convertToTwd(100, 'KRW', new Map([['KRW', 0]])).priceTwd, null);
});
