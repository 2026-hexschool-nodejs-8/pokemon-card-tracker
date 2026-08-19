import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shouldEnableApiDocs, createApp } from '../app.js';

const require = createRequire(import.meta.url);

function swaggerUiCacheKeys() {
  return Object.keys(require.cache).filter((k) => k.includes('swagger-ui-express'));
}

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

test('ENABLE_API_DOCS=false 時 swagger-ui-express 未載入', async (t) => {
  const prev = process.env.ENABLE_API_DOCS;
  t.after(() => {
    if (prev === undefined) delete process.env.ENABLE_API_DOCS;
    else process.env.ENABLE_API_DOCS = prev;
  });

  process.env.ENABLE_API_DOCS = 'false';
  const before = swaggerUiCacheKeys();
  await createApp();
  const after = swaggerUiCacheKeys();

  assert.deepEqual(
    after,
    before,
    `createApp 不應載入 swagger-ui-express，module cache 新增了：${after.filter((k) => !before.includes(k)).join(', ')}`,
  );
  assert.equal(after.length, 0, '此測試檔不應事先載入 swagger-ui-express');
});
