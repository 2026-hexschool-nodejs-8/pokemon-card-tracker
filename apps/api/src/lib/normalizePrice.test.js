import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrice, PriceParseError } from './normalizePrice.js';

// ── 既有來源的實際 rawText 格式（回歸測試，行為不得改變）──
test('JPY 千分位逗號："17,800 円" → 17800', () => {
  assert.equal(normalizePrice('17,800 円'), 17800);
});

test('JPY 日圓符號："¥12,345" → 12345', () => {
  assert.equal(normalizePrice('¥12,345'), 12345);
});

test('USD 千分位 + 小數點："$1,234.56" → 1234.56', () => {
  assert.equal(normalizePrice('$1,234.56'), 1234.56);
});

test('USD 兩位小數："$922.00" → 922', () => {
  assert.equal(normalizePrice('$922.00'), 922);
});

test('HKD 無小數："$200" → 200', () => {
  assert.equal(normalizePrice('$200'), 200);
});

test('台幣符號："NT$1,500" → 1500', () => {
  assert.equal(normalizePrice('NT$1,500'), 1500);
});

test('數字型別直接放行', () => {
  assert.equal(normalizePrice(49.7), 49.7);
});

// ── 歐系格式：逗號是小數點 ──
test('EUR 逗號小數點："12,50" → 12.5（不是 1250）', () => {
  assert.equal(normalizePrice('12,50'), 12.5);
});

test('EUR 點千分位 + 逗號小數點："€1.234,56" → 1234.56', () => {
  assert.equal(normalizePrice('€1.234,56'), 1234.56);
});

test('EUR 代碼被清掉："EUR 12,50" → 12.5', () => {
  assert.equal(normalizePrice('EUR 12,50'), 12.5);
});

test('HKD 代碼被清掉："HKD 200" → 200', () => {
  assert.equal(normalizePrice('HKD 200'), 200);
});

test('點當千分位且出現多次："1.234.567" → 1234567', () => {
  assert.equal(normalizePrice('1.234.567'), 1234567);
});

test('單一逗號 + 3 位數仍視為千分位："1,250" → 1250', () => {
  assert.equal(normalizePrice('1,250'), 1250);
});

// ── 防呆：擋掉空值 / 0 / 非數字 ──
test('空字串 → PriceParseError', () => {
  assert.throws(() => normalizePrice(''), PriceParseError);
});

test('null → PriceParseError', () => {
  assert.throws(() => normalizePrice(null), PriceParseError);
});

test('0 → PriceParseError', () => {
  assert.throws(() => normalizePrice('$0'), PriceParseError);
});

test('無法解析的字串 → PriceParseError', () => {
  assert.throws(() => normalizePrice('缺貨'), PriceParseError);
});

test('Infinity → PriceParseError', () => {
  assert.throws(() => normalizePrice(Infinity), PriceParseError);
});
