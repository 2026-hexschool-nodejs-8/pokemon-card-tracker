import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldEnableApiDocs } from '../app.js';

test('shouldEnableApiDocs：僅 ENABLE_API_DOCS=true 時開啟', (t) => {
  const prev = process.env.ENABLE_API_DOCS;
  t.after(() => {
    if (prev === undefined) delete process.env.ENABLE_API_DOCS;
    else process.env.ENABLE_API_DOCS = prev;
  });

  delete process.env.ENABLE_API_DOCS;
  assert.equal(shouldEnableApiDocs(), false, '未設定 → 關閉');

  process.env.ENABLE_API_DOCS = 'false';
  assert.equal(shouldEnableApiDocs(), false, 'false → 關閉');

  process.env.ENABLE_API_DOCS = 'true';
  assert.equal(shouldEnableApiDocs(), true, 'true → 開啟');

  process.env.ENABLE_API_DOCS = 'TRUE';
  assert.equal(shouldEnableApiDocs(), false, '大小寫不符 → 關閉');
});
