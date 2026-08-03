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

test('匯率為負數 → priceTwd null', () => {
  const r = convertToTwd(100, 'KRW', new Map([['KRW', -1]]));
  assert.equal(r.priceTwd, null);
  assert.match(r.reason, /找不到 KRW/);
});

test('匯率為 NaN → priceTwd null', () => {
  assert.equal(convertToTwd(100, 'KRW', new Map([['KRW', NaN]])).priceTwd, null);
});

test('匯率為 Infinity → priceTwd null', () => {
  assert.equal(convertToTwd(100, 'KRW', new Map([['KRW', Infinity]])).priceTwd, null);
});

test('匯率非 number 型別 → priceTwd null', () => {
  assert.equal(convertToTwd(100, 'KRW', new Map([['KRW', '32.15']])).priceTwd, null);
});

test('四捨五入邊界：10.5 進位到 11', () => {
  // rate 設計成 price*rate 剛好等於 10.5
  const r = convertToTwd(1, 'USD', new Map([['USD', 10.5]]));
  assert.equal(r.priceTwd, 11);
});

test('極大值換算導致 Infinity → priceTwd null', () => {
  const r = convertToTwd(Number.MAX_VALUE, 'USD', rates);
  assert.equal(r.priceTwd, null);
  assert.match(r.reason, /異常/);
});

// 已知邊界情況（見 docs/test-plan.md §6.1 CV-07、§10 待決事項 4）：
// raw（四捨五入前）為正數即可通過防呆，但 Math.round 後可能變成 0，
// 目前會把 priceTwd: 0 寫進 DB，而非回傳 null。這裡先記錄現況行為，
// 待決定「換算後為 0 該視為 null 還是允許 0」後再調整程式與此測試。
test('換算結果四捨五入後為 0（現況行為，非預期規格 － 待決）', () => {
  const r = convertToTwd(1, 'JPY', new Map([['JPY', 0.4]]));
  assert.equal(r.priceTwd, 0);
  assert.equal(r.reason, null);
});
