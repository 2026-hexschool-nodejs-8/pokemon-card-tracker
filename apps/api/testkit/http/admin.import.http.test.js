// Admin Import HTTP 測試 － 對應 docs/test-plan.md §6.4 IMP-01~18
// 用 mock.module 換掉 tcgplayer.scraper.js，隔離 Playwright／chromium 與外部網路
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker_test?schema=public';
process.env.FETCH_TIMEOUT_MS = '50';

let getProductIdsImpl = async () => [];
let scrapeCardImpl = async (productId) => ({
  productId,
  name: `Card ${productId}`,
  imageUrl: `https://example.test/${productId}.jpg`,
  price: 10,
  latestSales: [],
});

mock.module('../../src/adapters/crawler/tcgplayer.scraper.js', {
  exports: {
    getProductIds: (...args) => getProductIdsImpl(...args),
    scrapeCard: (...args) => scrapeCardImpl(...args),
    extractProductIds: () => [],
  },
});

const { prisma } = await import('@pct/db');
const { createApp } = await import('../../src/app.js');
const { makeRunId, cleanupByRunId } = await import('../helpers/db.js');
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
const app = createApp();
const request = supertest(app);

// 每個 productId 對應一份 cardData（讓 scrapeCard 針對不同 id 回不同內容／行為）
function useScrapeCardMap(map, { throwFor = new Set() } = {}) {
  scrapeCardImpl = async (productId) => {
    if (throwFor.has(productId)) {
      throw new Error(`scrapeCard(${productId}) 模擬失敗`);
    }
    const data = map.get(productId);
    if (!data) throw new Error(`未設定 productId=${productId} 的假資料`);
    return data;
  };
}

async function cleanupImportedCards(productIds) {
  await prisma.card.deleteMany({ where: { cardNumber: { in: productIds.map(String) } } });
}

test('Admin Import HTTP', { skip: !dbReachable && '資料庫無法連線' }, async (t) => {
  t.afterEach(() => {
    getProductIdsImpl = async () => [];
    scrapeCardImpl = async (productId) => ({
      productId, name: `Card ${productId}`, imageUrl: `https://example.test/${productId}.jpg`, price: 10, latestSales: [],
    });
  });

  await t.test('IMP-01：全部成功 → imported: 3，建立 3 張卡 + job SUCCESS', async (t) => {
    const ids = [910001, 910002, 910003];
    getProductIdsImpl = async () => ids;
    useScrapeCardMap(new Map(ids.map((id) => [id, {
      productId: id, name: `Card ${id}`, imageUrl: `https://example.test/${id}.jpg`, price: 10, latestSales: [],
    }])));
    t.after(() => cleanupImportedCards(ids));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 3);
    assert.equal(res.body.failed, 0);

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    assert.equal(job.status, 'success');
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('IMP-02：其中一筆失敗 → imported: 2 failed: 1，job PARTIAL_SUCCESS，沒有孤兒卡', async (t) => {
    const ids = [910011, 910012, 910013];
    getProductIdsImpl = async () => ids;
    useScrapeCardMap(
      new Map(ids.map((id) => [id, { productId: id, name: `Card ${id}`, imageUrl: `https://example.test/${id}.jpg`, price: 10, latestSales: [] }])),
      { throwFor: new Set([910012]) },
    );
    t.after(() => cleanupImportedCards(ids));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 2);
    assert.equal(res.body.failed, 1);

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    assert.equal(job.status, 'partial_success');
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});

    const orphan = await prisma.card.findFirst({ where: { cardNumber: '910012' } });
    assert.equal(orphan, null, '失敗的那筆不應該留下卡片');
  });

  await t.test('IMP-03：全部失敗 → imported: 0 failed: 3，job FAILED', async (t) => {
    const ids = [910021, 910022, 910023];
    getProductIdsImpl = async () => ids;
    useScrapeCardMap(new Map(), { throwFor: new Set(ids) });
    t.after(() => cleanupImportedCards(ids));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 0);
    assert.equal(res.body.failed, 3);

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    assert.equal(job.status, 'failed');
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（R9／IMP-04）同一個 externalId 已存在 → skipped: 1，不重複建卡', async (t) => {
    const id = 910031;
    // 先手動建一張已有此 externalId 的卡
    const existingCard = await prisma.card.create({
      data: {
        name: 'Existing Card', cardNumber: String(id), language: 'en', condition: 'raw',
        sources: { create: { type: 'crawler', provider: 'tcgplayer', externalId: String(id), currency: 'USD' } },
      },
    });
    getProductIdsImpl = async () => [id];
    t.after(async () => {
      await prisma.card.delete({ where: { id: existingCard.id } }).catch(() => {});
    });

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.skipped, 1);
    assert.equal(res.body.imported, 0);

    const cardCount = await prisma.card.count({ where: { cardNumber: String(id) } });
    assert.equal(cardCount, 1, '不應該重複建卡');

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（R11／IMP-06）cardData.price 為 "0" 造成 normalizePrice 丟錯 → 外層 catch 刪卡，不留孤兒', async (t) => {
    const id = 910041;
    getProductIdsImpl = async () => [id];
    scrapeCardImpl = async (productId) => ({
      productId, name: `Card ${productId}`, imageUrl: `https://example.test/${productId}.jpg`, price: '0', latestSales: [],
    });
    t.after(() => cleanupImportedCards([id]));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.failed, 1);
    assert.equal(res.body.imported, 0);

    const orphan = await prisma.card.findFirst({ where: { cardNumber: String(id) } });
    assert.equal(orphan, null, 'normalizePrice 失敗後應該回滾，不留孤兒卡');

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  // R1（已修正）：admin.import.js 原本對「最新一筆」用 validSales[length-1]，
  // 與 tcgplayerCrawler.adapter.js（用 latestSales[0]）的假設相反。TCGPlayer latestsales API
  // 回傳順序為新到舊（見 tcgplayer.latestsales.json fixture），故已改為取 [0]，兩者假設統一。
  await t.test('（R1 已修正／IMP-07）latestSales 多筆時，card.latestPrice 取陣列第一筆（最新一筆）', async (t) => {
    const id = 910051;
    getProductIdsImpl = async () => [id];
    scrapeCardImpl = async (productId) => ({
      productId,
      name: `Card ${productId}`,
      imageUrl: `https://example.test/${productId}.jpg`,
      price: 50,
      latestSales: [
        { purchasePrice: 45, orderDate: '2026-07-20T10:00:00Z' }, // [0] － 最新一筆
        { purchasePrice: 42, orderDate: '2026-07-18T10:00:00Z' },
      ],
    });
    t.after(() => cleanupImportedCards([id]));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);

    const card = await prisma.card.findFirst({ where: { cardNumber: String(id) } });
    assert.equal(card.latestPrice, 45, '取 validSales[0]，與 adapter 的 latestSales[0] 假設一致（R1 已修正）');

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  // R2：匯入路徑完全沒有換算 priceTwd，isSuspicious 恆為 false。這裡鎖住現況行為。
  await t.test('（R2／IMP-08,09）匯入後 priceTwd 與 latestPriceTwd 恆為 null，isSuspicious 恆為 false（現況行為）', async (t) => {
    const id = 910061;
    getProductIdsImpl = async () => [id];
    scrapeCardImpl = async (productId) => ({
      productId, name: `Card ${productId}`, imageUrl: `https://example.test/${productId}.jpg`, price: 100,
      latestSales: [{ purchasePrice: 100, orderDate: '2026-07-20T10:00:00Z' }],
    });
    t.after(() => cleanupImportedCards([id]));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    const card = await prisma.card.findFirst({ where: { cardNumber: String(id) } });
    assert.equal(card.latestPriceTwd, null, '現況行為：匯入路徑未換算 TWD，與 priceSync 行為不一致（見 test-plan R2）');

    const snapshot = await prisma.priceSnapshot.findFirst({ where: { cardId: card.id } });
    assert.equal(snapshot.priceTwd, null);
    assert.equal(snapshot.isSuspicious, false);

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  // R3：匯入期間會建立 RUNNING job，與 priceSync 的防重入互相衝突
  await t.test('（R3／IMP-10）匯入建立的 RUNNING job 結束前，price-sync 端點會被擋 409（現況耦合）', async (t) => {
    // 模擬「匯入仍在進行中」：直接手動插入一個 running 的 job（等同匯入尚未跑完的瞬間）
    const stuck = await prisma.priceFetchJob.create({ data: { triggerType: 'manual', status: 'running', totalSources: 1 } });
    t.after(() => prisma.priceFetchJob.delete({ where: { id: stuck.id } }).catch(() => {}));

    const res = await request.post('/admin/jobs/price-sync').set('Authorization', makeAuthHeader());
    assert.equal(res.status, 409, '現況行為：匯入與排程共用同一個 job running 鎖，會互相阻塞（見 test-plan R3）');
  });

  await t.test('（R7／IMP-11）page 為 0／負數／非數字 → clamp 為 1，不丟錯', async (t) => {
    let capturedPage;
    getProductIdsImpl = async (page) => { capturedPage = page; return []; };

    for (const input of [0, -5, 'abc', undefined]) {
      const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: input, limit: 1 });
      assert.equal(res.status, 200);
      assert.equal(capturedPage, 1, `page=${input} 應該 clamp 為 1`);
    }
  });

  await t.test('（R7／IMP-12）limit 會 clamp 到 [1, 50]', async (t) => {
    let capturedTargets;
    getProductIdsImpl = async () => [1, 2, 3, 4, 5];
    // 用 spy 觀察傳進 importProductIds 的目標數量：透過 scrapeCard 被呼叫次數間接驗證
    let callCount = 0;
    scrapeCardImpl = async (id) => { callCount += 1; return { productId: id, name: `Card ${id}`, imageUrl: 'https://example.test/x.jpg', price: 10, latestSales: [] }; };

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 999 });
    assert.equal(res.status, 200);
    assert.ok(callCount <= 50);
    assert.equal(callCount, 5, 'getProductIds 只回 5 筆，limit clamp 到 50 不影響這裡的結果');
    t.after(() => cleanupImportedCards([1, 2, 3, 4, 5]));

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（R7／IMP-13）POST /tcgplayer/search 缺 name → 400', async () => {
    const res = await request.post('/admin/import/tcgplayer/search').set('Authorization', makeAuthHeader()).send({});
    assert.equal(res.status, 400);
  });

  await t.test('（R7／IMP-13）POST /tcgplayer/search name 為空白字串 → 400', async () => {
    const res = await request.post('/admin/import/tcgplayer/search').set('Authorization', makeAuthHeader()).send({ name: '   ' });
    assert.equal(res.status, 400);
  });

  await t.test('IMP-14：search 搜不到 → 200，不建立 job', async () => {
    getProductIdsImpl = async () => [];
    const jobsBefore = await prisma.priceFetchJob.count();

    const res = await request.post('/admin/import/tcgplayer/search').set('Authorization', makeAuthHeader()).send({ name: '找不到的卡牌名稱' });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 0);
    assert.match(res.body.message, /找不到/);

    const jobsAfter = await prisma.priceFetchJob.count();
    assert.equal(jobsAfter, jobsBefore, 'search 搜不到時不應該建立 job');
  });

  await t.test('IMP-15：getProductIds 本身丟錯 → 500，且不留 RUNNING job', async () => {
    getProductIdsImpl = async () => { throw new Error('無法從搜尋頁取得 productId'); };
    const jobsBefore = await prisma.priceFetchJob.count({ where: { status: 'running' } });

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 500);

    const jobsAfter = await prisma.priceFetchJob.count({ where: { status: 'running' } });
    assert.equal(jobsAfter, jobsBefore, 'getProductIds 在建立 job 之前就失敗，不應該留下殭屍 running job');
  });

  await t.test('IMP-16：單筆逾時，其他筆繼續（不中斷整批）', async (t) => {
    const ids = [910071, 910072];
    getProductIdsImpl = async () => ids;
    scrapeCardImpl = async (id) => {
      if (id === 910071) return new Promise((r) => setTimeout(r, 5000));
      return { productId: id, name: `Card ${id}`, imageUrl: 'https://example.test/x.jpg', price: 10, latestSales: [] };
    };
    t.after(() => cleanupImportedCards(ids));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.body.imported, 1);
    assert.equal(res.body.failed, 1);

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('IMP-17：回應格式包含 imported/skipped/failed/results[]/jobId', async (t) => {
    const ids = [910081];
    getProductIdsImpl = async () => ids;
    useScrapeCardMap(new Map(ids.map((id) => [id, { productId: id, name: `Card ${id}`, imageUrl: 'https://example.test/x.jpg', price: 10, latestSales: [] }])));
    t.after(() => cleanupImportedCards(ids));

    const res = await request.post('/admin/import/tcgplayer').set('Authorization', makeAuthHeader()).send({ page: 1, limit: 10 });
    assert.equal(res.status, 200);
    assert.ok('imported' in res.body);
    assert.ok('skipped' in res.body);
    assert.ok('failed' in res.body);
    assert.ok(Array.isArray(res.body.results));
    assert.ok('jobId' in res.body);
    assert.ok('productId' in res.body.results[0]);
    assert.ok('status' in res.body.results[0]);

    const job = await prisma.priceFetchJob.findUnique({ where: { id: res.body.jobId } });
    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('IMP-18：未帶 token → 401', async () => {
    const res = await request.post('/admin/import/tcgplayer').send({ page: 1, limit: 1 });
    assert.equal(res.status, 401);
  });
});
