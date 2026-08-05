// priceSync 主流程補充測試 － 對應 docs/test-plan.md §6.3 SYNC-01~25
// 沿用既有 priceSync.error-cases.test.js 的 DB 隔離慣例（唯一前綴 + finally 清理），
// 但用 mock.module 換掉 adapters/registry.js，讓每個測試可以完全控制 adapter 的回傳值／錯誤／時間，
// 不必再依賴 globalThis.fetch 攔截或 mock adapter 內建的隨機價格。
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker_test?schema=public';
process.env.FETCH_TIMEOUT_MS = '50';

// provider 名稱 → fake adapter 實作，由每個測試在呼叫 runPriceSync 前設定
const fakeAdapters = new Map();

mock.module('../adapters/registry.js', {
  exports: {
    getAdapter: (source) => {
      const adapter = fakeAdapters.get(source.provider);
      if (!adapter) {
        throw new Error(`測試未註冊 provider=${source.provider} 的 fake adapter`);
      }
      return adapter;
    },
    listAdapters: () => [...fakeAdapters.keys()].map((name) => ({ type: 'fake', name })),
  },
});

const { prisma } = await import('@pct/db');
const { runPriceSync } = await import('./priceSync.service.js');
const {
  makeRunId,
  createCard,
  createSource,
  createSnapshot,
  setCurrencyRate,
  cleanupByRunId,
} = await import('../../testkit/helpers/db.js');

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function fakeAdapter(name, impl) {
  return { type: 'fake', name, fetchPrice: impl };
}

test('SYNC 主流程補充', { skip: !(await canReachDatabase()) && '資料庫無法連線' }, async (t) => {
  await t.test('0 個啟用來源 → job 直接 SUCCESS，totalSources: 0', async (t) => {
    const runId = makeRunId('sync01');
    const card = await createCard(runId, { isActive: true });
    t.after(() => cleanupByRunId(runId));

    // 建了卡但沒建 source，且卡片本身 isActive 為 true，符合「0 個啟用來源」情境
    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'success');
    assert.equal(job.totalSources, 0);
    assert.equal(job.successCount, 0);
    assert.equal(job.failedCount, 0);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('全部來源成功 → job SUCCESS，成功數與 snapshot 數一致', async (t) => {
    const runId = makeRunId('sync02');
    const card = await createCard(runId);
    const s1 = await createSource(card.id, { provider: 'fake-s1', currency: 'JPY' });
    const s2 = await createSource(card.id, { provider: 'fake-s2', currency: 'JPY' });
    fakeAdapters.set('fake-s1', fakeAdapter('fake-s1', async () => ({ provider: 'fake-s1', price: 1000, currency: 'JPY', fetchedAt: new Date().toISOString() })));
    fakeAdapters.set('fake-s2', fakeAdapter('fake-s2', async () => ({ provider: 'fake-s2', price: 2000, currency: 'JPY', fetchedAt: new Date().toISOString() })));
    t.after(async () => {
      fakeAdapters.delete('fake-s1');
      fakeAdapters.delete('fake-s2');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'success');
    assert.equal(job.successCount, 2);
    assert.equal(job.failedCount, 0);

    const snapshots = await prisma.priceSnapshot.findMany({ where: { cardId: card.id } });
    assert.equal(snapshots.length, 2);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('全部來源失敗 → job FAILED', async (t) => {
    const runId = makeRunId('sync04');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-allfail' });
    fakeAdapters.set('fake-allfail', fakeAdapter('fake-allfail', async () => { throw new Error('模擬全部失敗'); }));
    t.after(async () => {
      fakeAdapters.delete('fake-allfail');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'failed');
    assert.equal(job.successCount, 0);
    assert.equal(job.failedCount, 1);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  // R3：已有 RUNNING job 時整個 runPriceSync 應該直接 409，且不建立新 job
  await t.test('（SYNC-05／R3）已有 RUNNING job → 409 conflict，不建立新 job', async (t) => {
    const stuckJob = await prisma.priceFetchJob.create({
      data: { triggerType: 'manual', status: 'running', totalSources: 0 },
    });
    t.after(() => prisma.priceFetchJob.delete({ where: { id: stuckJob.id } }).catch(() => {}));

    const jobsBefore = await prisma.priceFetchJob.count();
    await assert.rejects(
      () => runPriceSync({ triggerType: 'manual' }),
      (err) => err.status === 409,
    );
    const jobsAfter = await prisma.priceFetchJob.count();
    assert.equal(jobsAfter, jobsBefore, '不應該建立新 job');
  });

  await t.test('帶 cardId 只跑該卡，其他卡的 snapshot 不受影響', async (t) => {
    const runId = makeRunId('sync06');
    const cardA = await createCard(runId, { name: `${runId}-A` });
    const cardB = await createCard(runId, { name: `${runId}-B` });
    await createSource(cardA.id, { provider: 'fake-a' });
    await createSource(cardB.id, { provider: 'fake-b' });
    fakeAdapters.set('fake-a', fakeAdapter('fake-a', async () => ({ provider: 'fake-a', price: 100, currency: 'JPY', fetchedAt: new Date().toISOString() })));
    fakeAdapters.set('fake-b', fakeAdapter('fake-b', async () => { throw new Error('不應該被呼叫'); }));
    t.after(async () => {
      fakeAdapters.delete('fake-a');
      fakeAdapters.delete('fake-b');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: cardA.id });
    assert.equal(job.totalSources, 1);
    assert.equal(job.successCount, 1);

    const snapshotsB = await prisma.priceSnapshot.findMany({ where: { cardId: cardB.id } });
    assert.equal(snapshotsB.length, 0);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('卡片 isActive: false → 該卡來源不被撈出', async (t) => {
    const runId = makeRunId('sync07');
    const card = await createCard(runId, { isActive: false });
    await createSource(card.id, { provider: 'fake-inactive-card' });
    fakeAdapters.set('fake-inactive-card', fakeAdapter('fake-inactive-card', async () => { throw new Error('不應該被呼叫'); }));
    t.after(async () => {
      fakeAdapters.delete('fake-inactive-card');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.totalSources, 0);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('來源 isActive: false → 不被撈出', async (t) => {
    const runId = makeRunId('sync08');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-inactive-source', isActive: false });
    fakeAdapters.set('fake-inactive-source', fakeAdapter('fake-inactive-source', async () => { throw new Error('不應該被呼叫'); }));
    t.after(async () => {
      fakeAdapters.delete('fake-inactive-source');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.totalSources, 0);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('adapter 逾時 → failed log 含 timeout 訊息，job 仍完成結算', async (t) => {
    const runId = makeRunId('sync09');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-slow' });
    fakeAdapters.set('fake-slow', fakeAdapter('fake-slow', () => new Promise((r) => setTimeout(r, 5000))));
    t.after(async () => {
      fakeAdapters.delete('fake-slow');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'failed');
    assert.match(job.errorMessage, /逾時/);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('adapter 回傳 price: 0 → PriceParseError 寫進 failed log，不寫 snapshot', async (t) => {
    const runId = makeRunId('sync10');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-zero' });
    fakeAdapters.set('fake-zero', fakeAdapter('fake-zero', async () => ({ provider: 'fake-zero', price: 0, currency: 'JPY', fetchedAt: new Date().toISOString() })));
    t.after(async () => {
      fakeAdapters.delete('fake-zero');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'failed');
    assert.match(job.errorMessage, /須大於 0/);

    const snapshots = await prisma.priceSnapshot.findMany({ where: { cardId: card.id } });
    assert.equal(snapshots.length, 0);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('Currency 表沒有該幣別 → priceTwd null，job 仍 SUCCESS', async (t) => {
    const runId = makeRunId('sync11');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-nocurrency', currency: 'HKD' });
    fakeAdapters.set('fake-nocurrency', fakeAdapter('fake-nocurrency', async () => ({ provider: 'fake-nocurrency', price: 500, currency: 'ZZZ_NOT_SEEDED', fetchedAt: new Date().toISOString() })));
    t.after(async () => {
      fakeAdapters.delete('fake-nocurrency');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'success');

    const snapshot = await prisma.priceSnapshot.findFirst({ where: { cardId: card.id } });
    assert.equal(snapshot.priceTwd, null);

    const updatedCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(updatedCard.latestPriceTwd, null);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（SYNC-12）isSuspicious 用 priceTwd 比較，跨幣別也能正確判定暴漲暴跌', async (t) => {
    const runId = makeRunId('sync12');
    const card = await createCard(runId);
    const sourceJpy = await createSource(card.id, { provider: 'fake-jpy', currency: 'JPY', isActive: true });
    const sourceUsd = await createSource(card.id, { provider: 'fake-usd', currency: 'USD', isActive: false });
    await setCurrencyRate('JPY', 0.22);
    await setCurrencyRate('USD', 32);

    fakeAdapters.set('fake-jpy', fakeAdapter('fake-jpy', async () => ({ provider: 'fake-jpy', price: 4500, currency: 'JPY', fetchedAt: new Date().toISOString() })));
    t.after(async () => {
      fakeAdapters.delete('fake-jpy');
      fakeAdapters.delete('fake-usd');
      await cleanupByRunId(runId);
    });

    // 第一次：只跑 JPY 來源，priceTwd = round(4500*0.22) = 990
    const job1 = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job1.status, 'success');
    const cardAfterFirst = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(cardAfterFirst.latestPriceTwd, 990);
    await prisma.priceFetchJob.delete({ where: { id: job1.id } }).catch(() => {});

    // 切換：關掉 JPY 來源，開啟 USD 來源，價格換算後與前次 TWD 差距 > 50%
    await prisma.priceSource.update({ where: { id: sourceJpy.id }, data: { isActive: false } });
    await prisma.priceSource.update({ where: { id: sourceUsd.id }, data: { isActive: true } });
    fakeAdapters.set('fake-usd', fakeAdapter('fake-usd', async () => ({ provider: 'fake-usd', price: 100, currency: 'USD', fetchedAt: new Date().toISOString() })));

    const job2 = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job2.status, 'success');

    const snapshotUsd = await prisma.priceSnapshot.findFirst({ where: { sourceId: sourceUsd.id } });
    assert.equal(snapshotUsd.priceTwd, 3200);
    assert.equal(snapshotUsd.isSuspicious, true, '990 → 3200 漲幅 > 50%，應標記可疑');

    await prisma.priceFetchJob.delete({ where: { id: job2.id } }).catch(() => {});
  });

  await t.test('首次抓價（latestPriceTwd 為 null）時 isSuspicious 恆為 false', async (t) => {
    const runId = makeRunId('sync13');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-first', currency: 'TWD' });
    fakeAdapters.set('fake-first', fakeAdapter('fake-first', async () => ({ provider: 'fake-first', price: 999999, currency: 'TWD', fetchedAt: new Date().toISOString() })));
    t.after(async () => {
      fakeAdapters.delete('fake-first');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    const snapshot = await prisma.priceSnapshot.findFirst({ where: { cardId: card.id } });
    assert.equal(snapshot.isSuspicious, false);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('imageUrl 為空字串時也會被寫入', async (t) => {
    const runId = makeRunId('sync16');
    const card = await createCard(runId, { imageUrl: '' });
    await createSource(card.id, { provider: 'fake-img-empty' });
    fakeAdapters.set('fake-img-empty', fakeAdapter('fake-img-empty', async () => ({
      provider: 'fake-img-empty', price: 100, currency: 'JPY', fetchedAt: new Date().toISOString(),
      imageUrl: 'https://example.test/card.jpg',
    })));
    t.after(async () => {
      fakeAdapters.delete('fake-img-empty');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    const updatedCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(updatedCard.imageUrl, 'https://example.test/card.jpg');

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（SYNC-19）tcgplayer 去重：既有 snapshot 較新或相同 → 略過寫入但更新 lastSuccessAt', async (t) => {
    const runId = makeRunId('sync19');
    const card = await createCard(runId);
    const source = await createSource(card.id, { provider: 'tcgplayer', currency: 'USD', lastError: '舊錯誤' });
    const newFetchedAt = new Date('2026-01-01T00:00:00Z');
    await createSnapshot(card.id, source.id, { fetchedAt: new Date('2026-06-01T00:00:00Z'), currency: 'USD' });

    fakeAdapters.set('tcgplayer', fakeAdapter('tcgplayer', async () => ({
      provider: 'tcgplayer', price: 55, currency: 'USD', fetchedAt: newFetchedAt.toISOString(),
    })));
    t.after(async () => {
      fakeAdapters.delete('tcgplayer');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'success');

    const snapshots = await prisma.priceSnapshot.findMany({ where: { sourceId: source.id } });
    assert.equal(snapshots.length, 1, '沒有新成交時不應寫入新 snapshot');

    const updatedSource = await prisma.priceSource.findUnique({ where: { id: source.id } });
    assert.ok(updatedSource.lastSuccessAt);
    assert.equal(updatedSource.lastError, null);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（SYNC-20）tcgplayer 去重：本次 fetchedAt 較新 → 正常寫入', async (t) => {
    const runId = makeRunId('sync20');
    const card = await createCard(runId);
    const source = await createSource(card.id, { provider: 'tcgplayer', currency: 'USD' });
    await createSnapshot(card.id, source.id, { fetchedAt: new Date('2026-01-01T00:00:00Z'), currency: 'USD' });

    fakeAdapters.set('tcgplayer', fakeAdapter('tcgplayer', async () => ({
      provider: 'tcgplayer', price: 60, currency: 'USD', fetchedAt: new Date('2026-06-01T00:00:00Z').toISOString(),
    })));
    t.after(async () => {
      fakeAdapters.delete('tcgplayer');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    const snapshots = await prisma.priceSnapshot.findMany({ where: { sourceId: source.id } });
    assert.equal(snapshots.length, 2, '本次成交時間較新，應該正常寫入');

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（SYNC-21）非 tcgplayer 來源不受去重規則影響，即使 fetchedAt 相同也照樣寫入', async (t) => {
    const runId = makeRunId('sync21');
    const card = await createCard(runId);
    const source = await createSource(card.id, { provider: 'fake-nodedupe', currency: 'JPY' });
    const sameTime = new Date('2026-01-01T00:00:00Z');
    await createSnapshot(card.id, source.id, { fetchedAt: sameTime, currency: 'JPY' });

    fakeAdapters.set('fake-nodedupe', fakeAdapter('fake-nodedupe', async () => ({
      provider: 'fake-nodedupe', price: 200, currency: 'JPY', fetchedAt: sameTime.toISOString(),
    })));
    t.after(async () => {
      fakeAdapters.delete('fake-nodedupe');
      await cleanupByRunId(runId);
    });

    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    const snapshots = await prisma.priceSnapshot.findMany({ where: { sourceId: source.id } });
    assert.equal(snapshots.length, 2, '非 tcgplayer 來源不去重，應該寫入第二筆');

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  await t.test('（SYNC-22）去重比較僅限同一 sourceId，不同來源的既有 snapshot 互不影響', async (t) => {
    const runId = makeRunId('sync22');
    const cardX = await createCard(runId, { name: `${runId}-X` });
    const cardY = await createCard(runId, { name: `${runId}-Y` });
    const sourceX = await createSource(cardX.id, { provider: 'tcgplayer', currency: 'USD' });
    const sourceY = await createSource(cardY.id, { provider: 'tcgplayer', currency: 'USD' });

    // 只有 sourceX 有既有 snapshot（且比本次新），sourceY 完全沒有歷史資料
    await createSnapshot(cardX.id, sourceX.id, { fetchedAt: new Date('2026-06-01T00:00:00Z'), currency: 'USD' });

    fakeAdapters.set('tcgplayer', fakeAdapter('tcgplayer', async () => ({
      provider: 'tcgplayer', price: 30, currency: 'USD', fetchedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    })));
    t.after(async () => {
      fakeAdapters.delete('tcgplayer');
      await cleanupByRunId(runId);
    });

    // 分兩次各自帶 cardId 呼叫，避免掃到測試資料庫裡其他卡的來源（不對全域下手）
    const jobX = await runPriceSync({ triggerType: 'manual', cardId: cardX.id });
    const jobY = await runPriceSync({ triggerType: 'manual', cardId: cardY.id });

    const snapshotsX = await prisma.priceSnapshot.findMany({ where: { sourceId: sourceX.id } });
    assert.equal(snapshotsX.length, 1, 'sourceX 應該因去重而略過寫入');

    const snapshotsY = await prisma.priceSnapshot.findMany({ where: { sourceId: sourceY.id } });
    assert.equal(snapshotsY.length, 1, 'sourceY 沒有既有 snapshot，不受 sourceX 影響，應正常寫入');

    await prisma.priceFetchJob.delete({ where: { id: jobX.id } }).catch(() => {});
    await prisma.priceFetchJob.delete({ where: { id: jobY.id } }).catch(() => {});
  });

  await t.test('成功後 card 摘要欄位（latestPrice/latestCurrency/latestPriceTwd/lastFetchedAt）全部更新', async (t) => {
    const runId = makeRunId('sync23');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-summary', currency: 'TWD' });
    fakeAdapters.set('fake-summary', fakeAdapter('fake-summary', async () => ({
      provider: 'fake-summary', price: 777, currency: 'TWD', fetchedAt: new Date().toISOString(),
    })));
    t.after(async () => {
      fakeAdapters.delete('fake-summary');
      await cleanupByRunId(runId);
    });

    const before = new Date();
    const job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    const updatedCard = await prisma.card.findUnique({ where: { id: card.id } });

    assert.equal(updatedCard.latestPrice, 777);
    assert.equal(updatedCard.latestCurrency, 'TWD');
    assert.equal(updatedCard.latestPriceTwd, 777);
    assert.ok(updatedCard.lastFetchedAt >= before);

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });

  // SYNC-25：模擬「未預期錯誤」－ adapter reject 一個非 Error 的值（例如寫壞的第三方 adapter
  // 直接 reject 字串），導致 handleSourceFailure 內 `err.message.slice()` 對 undefined 呼叫而 throw，
  // 這個 throw 發生在 for 迴圈的 catch 區塊內，會逃出最外層 try，驗證外層 catch 仍把 job 標記為
  // FAILED，而不是留下永久 RUNNING 的殭屍 job。
  await t.test('（SYNC-25）來源以非 Error 值 reject → 外層 catch 仍將 job 標記 FAILED', async (t) => {
    const runId = makeRunId('sync25');
    const card = await createCard(runId);
    await createSource(card.id, { provider: 'fake-bad-reject' });
    fakeAdapters.set('fake-bad-reject', fakeAdapter('fake-bad-reject', () => Promise.reject('boom-not-an-error')));
    t.after(async () => {
      fakeAdapters.delete('fake-bad-reject');
      await cleanupByRunId(runId);
    });

    await assert.rejects(() => runPriceSync({ triggerType: 'manual', cardId: card.id }));

    const job = await prisma.priceFetchJob.findFirst({ orderBy: { startedAt: 'desc' } });
    assert.ok(job, '應該找得到本次建立的 job');
    assert.equal(job.status, 'failed');
    assert.ok(job.finishedAt, '應該有結算時間，不是永久卡在 running');

    await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
  });
});
