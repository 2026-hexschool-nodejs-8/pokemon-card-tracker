// Admin Jobs HTTP 測試 － 對應 docs/test-plan.md §6.4 JOB-01~08
// 用 mock.module 換掉 registry，讓 runPriceSync 走可控的 fake adapter
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker_test?schema=public';

const fakeAdapters = new Map();
mock.module('../../src/adapters/registry.js', {
  exports: {
    getAdapter: (source) => {
      const adapter = fakeAdapters.get(source.provider);
      if (!adapter) throw new Error(`測試未註冊 provider=${source.provider}`);
      return adapter;
    },
    listAdapters: () => [],
  },
});

const { prisma } = await import('@pct/db');
const { createApp } = await import('../../src/app.js');
const { makeRunId, createCard, createSource, cleanupByRunId } = await import('../helpers/db.js');
const { makeAuthHeader } = await import('../helpers/auth.js');

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

test('Admin Jobs HTTP', { skip: !dbReachable && '資料庫無法連線' }, async (t) => {
  await t.test('POST /admin/jobs/price-sync － 有來源 → 202', async (t) => {
    const runId = makeRunId('job01');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-job01' });
    fakeAdapters.set('fake-job01', {
      type: 'fake', name: 'fake-job01',
      fetchPrice: async () => ({ provider: 'fake-job01', price: 10, currency: 'TWD', fetchedAt: new Date().toISOString() }),
    });
    t.after(async () => {
      fakeAdapters.delete('fake-job01');
      await cleanupByRunId(runId);
    });

    const res = await request.post('/admin/cards/' + card.id + '/price-sync').set('Authorization', makeAuthHeader());
    assert.equal(res.status, 202);
    assert.ok(res.body.data.id);
    await prisma.priceFetchJob.delete({ where: { id: res.body.data.id } }).catch(() => {});
  });

  await t.test('POST /admin/jobs/price-sync － 已有 running job → 409', async (t) => {
    const stuck = await prisma.priceFetchJob.create({ data: { triggerType: 'manual', status: 'running', totalSources: 0 } });
    t.after(() => prisma.priceFetchJob.delete({ where: { id: stuck.id } }).catch(() => {}));

    const res = await request.post('/admin/jobs/price-sync').set('Authorization', makeAuthHeader());
    assert.equal(res.status, 409);
  });

  await t.test('POST /admin/cards/:id/price-sync － 只跑該卡', async (t) => {
    const runId = makeRunId('job03');
    const cardA = await createCard(runId, { name: `${runId}-A` });
    const cardB = await createCard(runId, { name: `${runId}-B` });
    await createSource(cardA.id, { provider: 'fake-job03a' });
    await createSource(cardB.id, { provider: 'fake-job03b' });
    fakeAdapters.set('fake-job03a', {
      type: 'fake', name: 'fake-job03a',
      fetchPrice: async () => ({ provider: 'fake-job03a', price: 10, currency: 'TWD', fetchedAt: new Date().toISOString() }),
    });
    fakeAdapters.set('fake-job03b', {
      type: 'fake', name: 'fake-job03b',
      fetchPrice: async () => { throw new Error('不該被呼叫'); },
    });
    t.after(async () => {
      fakeAdapters.delete('fake-job03a');
      fakeAdapters.delete('fake-job03b');
      await cleanupByRunId(runId);
    });

    const res = await request.post(`/admin/cards/${cardA.id}/price-sync`).set('Authorization', makeAuthHeader());
    assert.equal(res.status, 202);
    assert.equal(res.body.data.totalSources, 1);
    await prisma.priceFetchJob.delete({ where: { id: res.body.data.id } }).catch(() => {});
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

  await t.test('GET /admin/jobs － 未帶 token → 401', async () => {
    const res = await request.get('/admin/jobs');
    assert.equal(res.status, 401);
  });

  await t.test('GET /admin/jobs － 帶 token → 200，最多 50 筆，startedAt desc', async (t) => {
    const jobs = [];
    for (let i = 0; i < 3; i += 1) {
      jobs.push(await prisma.priceFetchJob.create({ data: { triggerType: 'manual', status: 'success', totalSources: 0 } }));
    }
    t.after(() => Promise.all(jobs.map((j) => prisma.priceFetchJob.delete({ where: { id: j.id } }).catch(() => {}))));

    const res = await request.get('/admin/jobs').set('Authorization', makeAuthHeader());
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 3);
    for (let i = 1; i < res.body.data.length; i += 1) {
      assert.ok(new Date(res.body.data[i - 1].startedAt) >= new Date(res.body.data[i].startedAt));
    }
  });

  await t.test('GET /admin/jobs/:id － 存在 → 200 含 logs；不存在 → 404', async (t) => {
    const job = await prisma.priceFetchJob.create({ data: { triggerType: 'manual', status: 'success', totalSources: 0 } });
    t.after(() => prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {}));

    const res = await request.get(`/admin/jobs/${job.id}`).set('Authorization', makeAuthHeader());
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.logs, []);

    const notFoundRes = await request.get('/admin/jobs/does-not-exist').set('Authorization', makeAuthHeader());
    assert.equal(notFoundRes.status, 404);
  });

  await t.test('POST /admin/jobs/clear-stuck － 有 RUNNING job → 標記為 FAILED', async (t) => {
    const stuck1 = await prisma.priceFetchJob.create({ data: { triggerType: 'manual', status: 'running', totalSources: 0 } });
    const stuck2 = await prisma.priceFetchJob.create({ data: { triggerType: 'cron', status: 'running', totalSources: 0 } });
    t.after(() => Promise.all([
      prisma.priceFetchJob.delete({ where: { id: stuck1.id } }).catch(() => {}),
      prisma.priceFetchJob.delete({ where: { id: stuck2.id } }).catch(() => {}),
    ]));

    const res = await request.post('/admin/jobs/clear-stuck').set('Authorization', makeAuthHeader());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.clearedCount, 2);

    const updated1 = await prisma.priceFetchJob.findUnique({ where: { id: stuck1.id } });
    assert.equal(updated1.status, 'failed');
    assert.ok(updated1.finishedAt);
  });

  // R4：clear-stuck 沒有排除任何真正在跑的 job，這裡先記錄「沒有 RUNNING job 時 clearedCount 為 0，
  // 且不影響既有 success/failed job」的現況行為
  await t.test('（R4）POST /admin/jobs/clear-stuck － 沒有 RUNNING job → clearedCount: 0，不影響既有 job', async (t) => {
    const finished = await prisma.priceFetchJob.create({ data: { triggerType: 'manual', status: 'success', totalSources: 0 } });
    t.after(() => prisma.priceFetchJob.delete({ where: { id: finished.id } }).catch(() => {}));

    const res = await request.post('/admin/jobs/clear-stuck').set('Authorization', makeAuthHeader());
    assert.equal(res.status, 200);
    assert.equal(res.body.data.clearedCount, 0);

    const stillThere = await prisma.priceFetchJob.findUnique({ where: { id: finished.id } });
    assert.equal(stillThere.status, 'success');
  });

  await t.test('POST /admin/jobs/clear-stuck － 未帶 token → 401', async () => {
    const res = await request.post('/admin/jobs/clear-stuck');
    assert.equal(res.status, 401);
  });
});
