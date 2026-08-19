// 前台公開 API HTTP 測試 － 對應 docs/test-plan.md §6.4 CRD-01~15
import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import nock from 'nock';
import { prisma } from '@pct/db';
import { createApp } from '../../src/app.js';
import { makeRunId, createCard, createSource, createSnapshot, cleanupByRunId } from '../helpers/db.js';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker_test?schema=public';

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbReachable = await canReachDatabase();
const app = await createApp();
const request = supertest(app);

test('前台公開 API HTTP', { skip: !dbReachable && '資料庫無法連線' }, async (t) => {
  await t.test('GET /health － 200', async () => {
    const res = await request.get('/health');
    assert.equal(res.status, 200);
  });

  await t.test('GET /cards － 200，只回傳 active 卡', async (t) => {
    const runId = makeRunId('crd02');
    const active = await createCard(runId, { name: `${runId}-active` });
    const inactive = await createCard(runId, { name: `${runId}-inactive`, isActive: false });
    t.after(() => cleanupByRunId(runId));

    const res = await request.get('/cards');
    assert.equal(res.status, 200);
    const ids = res.body.data.map((c) => c.id);
    assert.ok(ids.includes(active.id));
    assert.ok(!ids.includes(inactive.id));
  });

  await t.test('GET /cards?keyword= － 命中篩選', async (t) => {
    const runId = makeRunId('crd03');
    const card = await createCard(runId, { name: `${runId}-Pikachu` });
    t.after(() => cleanupByRunId(runId));

    const res = await request.get('/cards').query({ keyword: 'Pikachu' });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((c) => c.id === card.id));
  });

  await t.test('GET /cards?language=xx － 不在 enum 內 → 400', async () => {
    const res = await request.get('/cards').query({ language: 'xx' });
    assert.equal(res.status, 400);
  });

  await t.test('GET /cards/:id － 存在 → 200，含 sources', async (t) => {
    const runId = makeRunId('crd05');
    const card = await createCard(runId);
    await createSource(card.id);
    t.after(() => cleanupByRunId(runId));

    const res = await request.get(`/cards/${card.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.sources.length, 1);
  });

  await t.test('GET /cards/:id － 不存在 → 404', async () => {
    const res = await request.get('/cards/non-existent-id');
    assert.equal(res.status, 404);
  });

  await t.test('GET /cards/:id － 已停用卡 → 404', async (t) => {
    const runId = makeRunId('crd06b');
    const card = await createCard(runId, { isActive: false });
    t.after(() => cleanupByRunId(runId));

    const res = await request.get(`/cards/${card.id}`);
    assert.equal(res.status, 404);
  });

  await t.test('GET /cards/:id/prices － fetchedAt 遞增排序', async (t) => {
    const runId = makeRunId('crd07');
    const card = await createCard(runId);
    const source = await createSource(card.id);
    await createSnapshot(card.id, source.id, { fetchedAt: new Date('2026-06-01T00:00:00Z') });
    await createSnapshot(card.id, source.id, { fetchedAt: new Date('2026-01-01T00:00:00Z') });
    t.after(() => cleanupByRunId(runId));

    const res = await request.get(`/cards/${card.id}/prices`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 2);
    assert.ok(new Date(res.body.data[0].fetchedAt) <= new Date(res.body.data[1].fetchedAt));
  });

  // R5（已修正）：/cards/:id/prices 現在用 cardPricesQuerySchema 驗證 query，
  // 非法日期字串在進到 service／Prisma 之前就被 Zod 擋下，回 400 而非未預期的 500。
  await t.test('（R5 已修正）GET /cards/:id/prices?from=abc － 400', async (t) => {
    const runId = makeRunId('crd08');
    const card = await createCard(runId);
    t.after(() => cleanupByRunId(runId));

    const res = await request.get(`/cards/${card.id}/prices`).query({ from: 'abc' });
    assert.equal(res.status, 400);
  });

  await t.test('GET /cards/:id/prices?source= － 篩選 provider', async (t) => {
    const runId = makeRunId('crd09');
    const card = await createCard(runId);
    const sourceA = await createSource(card.id, { provider: `${runId}-A` });
    const sourceB = await createSource(card.id, { provider: `${runId}-B` });
    await createSnapshot(card.id, sourceA.id, { provider: `${runId}-A` });
    await createSnapshot(card.id, sourceB.id, { provider: `${runId}-B` });
    t.after(() => cleanupByRunId(runId));

    const res = await request.get(`/cards/${card.id}/prices`).query({ source: `${runId}-A` });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
  });

  await t.test('GET /cards/:id/prices/summary － 無資料時欄位齊全皆為 null', async (t) => {
    const runId = makeRunId('crd10');
    const card = await createCard(runId);
    t.after(() => cleanupByRunId(runId));

    const res = await request.get(`/cards/${card.id}/prices/summary`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.latestPrice, null);
  });

  await t.test('GET /cards/:id/tcgplayer-history － 正常回應 → 200', async (t) => {
    const runId = makeRunId('crd11');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'tcgplayer', externalId: '12345' });
    t.after(() => {
      nock.cleanAll();
      return cleanupByRunId(runId);
    });

    nock('https://infinite-api.tcgplayer.com')
      .get('/price/history/12345/detailed?range=quarter')
      .reply(200, {
        result: [{ condition: 'Near Mint', variant: 'Normal', language: 'English', price: 45.5 }],
      });

    const res = await request.get(`/cards/${card.id}/tcgplayer-history`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.condition, 'Near Mint');
  });

  // R6（已修正）：range 現在用 cardTcgplayerHistoryQuerySchema 白名單（month/quarter/annual），
  // 未在白名單內的字串直接在路由層被 Zod 擋下，不會再被串進外部 URL。
  await t.test('（R6 已修正）?range=<不在白名單內的字串> － 400', async (t) => {
    const runId = makeRunId('crd12');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'tcgplayer', externalId: '12345' });
    t.after(() => cleanupByRunId(runId));

    const res = await request.get(`/cards/${card.id}/tcgplayer-history`).query({ range: 'not-a-real-range' });
    assert.equal(res.status, 400);
  });

  // R6（已修正）：外部 API 呼叫現在有 timeout + try/catch，失敗時優雅降級回 data: null，
  // 語意與「找不到 tcgplayer 來源」一致，不再讓整個端點變成 500。
  await t.test('（R6 已修正）外部 tcgplayer API 回 500 － 優雅降級為 200 data: null', async (t) => {
    const runId = makeRunId('crd13');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'tcgplayer', externalId: '99999' });
    t.after(() => {
      nock.cleanAll();
      return cleanupByRunId(runId);
    });

    nock('https://infinite-api.tcgplayer.com')
      .get('/price/history/99999/detailed?range=quarter')
      .reply(500);

    const res = await request.get(`/cards/${card.id}/tcgplayer-history`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data, null);
  });

  await t.test('未知路徑 → 404 格式一致', async () => {
    const res = await request.get('/nope-does-not-exist');
    assert.equal(res.status, 404);
    assert.ok(res.body.error);
  });
});
