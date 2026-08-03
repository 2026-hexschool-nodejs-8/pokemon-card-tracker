import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrice, isSuspiciousPrice, PriceParseError } from './normalizePrice.js';

test('normalizePrice：合法輸入', async (t) => {
  await t.test('number 原樣通過', () => {
    assert.equal(normalizePrice(1234), 1234);
  });

  await t.test('number 帶小數原樣通過', () => {
    assert.equal(normalizePrice(49.7), 49.7);
  });

  await t.test('數字字串', () => {
    assert.equal(normalizePrice('1234'), 1234);
  });

  await t.test('日圓符號 + 千分位逗號', () => {
    assert.equal(normalizePrice('¥12,345'), 12345);
  });

  await t.test('日圓符號 + 円 單位混用："17,800 円"', () => {
    assert.equal(normalizePrice('17,800 円'), 17800);
  });

  await t.test('美元符號 + 小數', () => {
    assert.equal(normalizePrice('$1,234.56'), 1234.56);
  });

  await t.test('美元兩位小數："$922.00" → 922', () => {
    assert.equal(normalizePrice('$922.00'), 922);
  });

  await t.test('港幣無小數："$200" → 200', () => {
    assert.equal(normalizePrice('$200'), 200);
  });

  await t.test('NT$ 字首', () => {
    assert.equal(normalizePrice('NT$500'), 500);
  });

  await t.test('NT$ 字首 + 千分位："NT$1,500" → 1500', () => {
    assert.equal(normalizePrice('NT$1,500'), 1500);
  });

  await t.test('中文「円」單位', () => {
    assert.equal(normalizePrice('12,345円'), 12345);
  });

  await t.test('中文「元」單位（含空白）', () => {
    assert.equal(normalizePrice('1234 元'), 1234);
  });

  await t.test('內含空白會被清掉', () => {
    assert.equal(normalizePrice(' 1 234 '), 1234);
  });

  await t.test('幣別代碼字首 USD', () => {
    assert.equal(normalizePrice('USD 99.9'), 99.9);
  });

  await t.test('幣別代碼字首 HKD："HKD 200" → 200', () => {
    assert.equal(normalizePrice('HKD 200'), 200);
  });

  await t.test('科學記號字串會被 Number() 解析', () => {
    assert.equal(normalizePrice('1e3'), 1000);
  });
});

// ── 歐系格式：逗號是小數點（feat/currency-eur）──
test('normalizePrice：歐系逗號小數點格式', async (t) => {
  await t.test('單一逗號 + 2 位數視為小數點："12,50" → 12.5（不是 1250）', () => {
    assert.equal(normalizePrice('12,50'), 12.5);
  });

  await t.test('點千分位 + 逗號小數點："€1.234,56" → 1234.56', () => {
    assert.equal(normalizePrice('€1.234,56'), 1234.56);
  });

  await t.test('EUR 代碼被清掉："EUR 12,50" → 12.5', () => {
    assert.equal(normalizePrice('EUR 12,50'), 12.5);
  });

  await t.test('點當千分位且出現多次："1.234.567" → 1234567', () => {
    assert.equal(normalizePrice('1.234.567'), 1234567);
  });

  // 同一條規則下，"1.2.3" 不再視為無法解析：兩個點都當千分位清掉 → "123"
  await t.test('點出現多次時一律當千分位（含短數字）："1.2.3" → 123（非 PriceParseError）', () => {
    assert.equal(normalizePrice('1.2.3'), 123);
  });

  await t.test('單一逗號 + 3 位數仍視為千分位："1,250" → 1250', () => {
    assert.equal(normalizePrice('1,250'), 1250);
  });
});

test('normalizePrice：邊界與非法輸入一律 throw PriceParseError', async (t) => {
  const cases = [
    ['0（number）', 0],
    ['"0"（字串）', '0'],
    ['"$0"（帶幣別符號）', '$0'],
    ['-5（number）', -5],
    ['"-5"（字串）', '-5'],
    ['NaN', NaN],
    ['Infinity（number）', Infinity],
    ['"Infinity"（字串，Number() 會解析成 Infinity）', 'Infinity'],
    ['null', null],
    ['undefined', undefined],
    ['空字串', ''],
    ['"abc"（無法解析）', 'abc'],
    ['"缺貨"（無法解析）', '缺貨'],
    ['"--5"（無法解析）', '--5'],
  ];

  for (const [label, input] of cases) {
    await t.test(label, () => {
      assert.throws(() => normalizePrice(input), PriceParseError);
    });
  }
});

test('normalizePrice：錯誤型別與訊息', () => {
  try {
    normalizePrice(0);
    assert.fail('應該要 throw');
  } catch (err) {
    assert.equal(err.name, 'PriceParseError');
    assert.ok(err instanceof PriceParseError);
    assert.match(err.message, /須大於 0/);
  }

  try {
    normalizePrice(null);
    assert.fail('應該要 throw');
  } catch (err) {
    assert.match(err.message, /價格為空/);
  }

  try {
    normalizePrice('abc');
    assert.fail('應該要 throw');
  } catch (err) {
    assert.match(err.message, /無法解析為數字/);
  }
});

test('normalizePrice：全形數字目前不支援（記錄現況行為）', () => {
  // 全形數字不會被 CURRENCY_SYMBOLS / Number() 正確處理，Number('１２３') 為 NaN
  assert.throws(() => normalizePrice('１２３'), PriceParseError);
});

test('isSuspiciousPrice：正常比較', () => {
  assert.equal(isSuspiciousPrice(100, 100), false);
});

test('isSuspiciousPrice：暴漲 51% 判定為可疑', () => {
  assert.equal(isSuspiciousPrice(151, 100), true);
});

test('isSuspiciousPrice：剛好 +50% 不算可疑（邊界為 > 0.5）', () => {
  assert.equal(isSuspiciousPrice(150, 100), false);
});

test('isSuspiciousPrice：暴跌 51% 判定為可疑', () => {
  assert.equal(isSuspiciousPrice(49, 100), true);
});

test('isSuspiciousPrice：剛好 -50% 不算可疑', () => {
  assert.equal(isSuspiciousPrice(50, 100), false);
});

test('isSuspiciousPrice：任一價格為 null／0／負數 視為不可疑', async (t) => {
  const cases = [
    ['newPrice 為 null', null, 100],
    ['prevPrice 為 null', 100, null],
    ['newPrice 為 0', 0, 100],
    ['prevPrice 為 0', 100, 0],
    ['prevPrice 為負數', 100, -10],
  ];
  for (const [label, newPrice, prevPrice] of cases) {
    await t.test(label, () => {
      assert.equal(isSuspiciousPrice(newPrice, prevPrice), false);
    });
  }
});
