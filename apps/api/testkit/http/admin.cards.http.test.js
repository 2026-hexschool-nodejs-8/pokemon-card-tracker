// Admin Cards HTTP 測試 － 卡牌不存在時的 404（sources / price-sync）
import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { prisma } from '@pct/db';
import { createApp } from '../../src/app.js';
import { makeRunId, createCard, cleanupByRunId } from '../helpers/db.js';
import { makeAuthHeader } from '../helpers/auth.js';

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
const app = createApp();
const request = supertest(app);

const validSourceBody = {
  type: 'crawler',
  provider: 'mockCrawler',
  url: 'https://example.test/card',
  currency: 'JPY',
};

test('Admin Cards HTTP', { skip: !dbReachable && '資料庫無法連線' }, async (t) => {
  await t.test('POST /admin/cards/:id/sources － 卡牌存在 → 201', async (t) => {
    const runId = makeRunId('src01');
    const card = await createCard(runId);
    t.after(() => cleanupByRunId(runId));

    const res = await request
      .post(`/admin/cards/${card.id}/sources`)
      .set('Authorization', makeAuthHeader())
      .send({ ...validSourceBody, provider: `${runId}-src` });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.cardId, card.id);
    assert.equal(res.body.data.provider, `${runId}-src`);
  });

  await t.test('POST /admin/cards/:id/sources － 卡牌不存在 → 404，不建立來源', async () => {
    const before = await prisma.priceSource.count();
    const res = await request
      .post('/admin/cards/does-not-exist/sources')
      .set('Authorization', makeAuthHeader())
      .send(validSourceBody);

    assert.equal(res.status, 404);
    assert.equal(res.body.error, '找不到這張卡牌');
    assert.equal(await prisma.priceSource.count(), before);
  });

  await t.test('POST /admin/cards/:id/price-sync － 卡牌不存在 → 404，不建立 job', async () => {
    const before = await prisma.priceFetchJob.count();
    const res = await request
      .post('/admin/cards/does-not-exist/price-sync')
      .set('Authorization', makeAuthHeader());

    assert.equal(res.status, 404);
    assert.equal(res.body.error, '找不到這張卡牌');
    assert.equal(await prisma.priceFetchJob.count(), before);
  });
});
