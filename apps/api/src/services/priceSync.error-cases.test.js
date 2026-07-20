import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker?schema=public';
process.env.FETCH_TIMEOUT_MS = '20';

const { prisma } = await import('@pct/db');
const { runPriceSync } = await import('./priceSync.service.js');

const TEST_RUN_ID = `phase4-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function installFetchMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);

    if (value.includes('/success-alt-image')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          `<table><tbody><tr><td id="used_price"><span class="price js-price">$10.00</span></td></tr></tbody></table>
           <div id="product_details"><img itemprop="image" src="https://images.example.test/card-second.jpg" /></div>`,
      };
    }

    if (value.includes('/success-no-image')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          '<table><tbody><tr><td id="used_price"><span class="price js-price">$12.34</span></td></tr></tbody></table>',
      };
    }

    if (value.includes('/success')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          `<table><tbody><tr><td id="used_price"><span class="price js-price">$948.43</span></td></tr></tbody></table>
           <div id="product_details"><img itemprop="image" src="https://images.example.test/card-success.jpg" /></div>`,
      };
    }

    if (value.includes('/selector-missing')) {
      return {
        ok: true,
        status: 200,
        text: async () => '<html><body><p>price moved</p></body></html>',
      };
    }

    if (value.includes('/rate-limited')) {
      return {
        ok: false,
        status: 429,
        text: async () => '',
      };
    }

    if (value.includes('/zero-price')) {
      return {
        ok: true,
        status: 200,
        text: async () => '<p class="price product-page-price">$0</p>',
      };
    }

    if (value.includes('/timeout')) {
      return new Promise(() => {});
    }

    throw new Error(`unexpected test URL: ${value}`);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

test('runPriceSync records failures and finishes partial_success when only one crawler source succeeds', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this integration test');
    return;
  }

  const runningJobs = await prisma.priceFetchJob.count({ where: { status: 'running' } });
  if (runningJobs > 0) {
    t.skip('a price fetch job is already running');
    return;
  }

  const restoreFetch = installFetchMock();
  let card;
  let job;

  try {
    card = await prisma.card.create({
      data: {
        name: `Phase 4 Test Card ${TEST_RUN_ID}`,
        cardNumber: TEST_RUN_ID,
        setName: 'Phase 4',
        language: 'ja',
        condition: 'raw',
        sources: {
          create: [
            {
              type: 'crawler',
              provider: 'priceCharting',
              url: `https://example.test/${TEST_RUN_ID}/success`,
              currency: 'USD',
            },
            {
              type: 'crawler',
              provider: 'yuyutei',
              url: `https://example.test/${TEST_RUN_ID}/selector-missing`,
              currency: 'JPY',
            },
            {
              type: 'crawler',
              provider: 'rakuten',
              url: `https://example.test/${TEST_RUN_ID}/rate-limited`,
              currency: 'JPY',
            },
            {
              type: 'crawler',
              provider: 'cardLand',
              url: `https://example.test/${TEST_RUN_ID}/zero-price`,
              currency: 'HKD',
            },
            {
              type: 'crawler',
              provider: 'priceCharting',
              url: `https://example.test/${TEST_RUN_ID}/timeout`,
              currency: 'USD',
            },
          ],
        },
      },
      include: { sources: true },
    });

    job = await runPriceSync({ triggerType: 'manual', cardId: card.id });

    assert.equal(job.status, 'partial_success');
    assert.equal(job.totalSources, 5);
    assert.equal(job.successCount, 1);
    assert.equal(job.failedCount, 4);
    assert.equal(job.logs.length, 5);

    const snapshots = await prisma.priceSnapshot.findMany({
      where: { cardId: card.id },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].provider, 'priceCharting');
    assert.equal(snapshots[0].price, 948.43);
    assert.equal(snapshots[0].rawText, '$948.43');

    const logs = await prisma.priceFetchLog.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(logs.filter((log) => log.status === 'success').length, 1);
    assert.equal(logs.filter((log) => log.status === 'failed').length, 4);
    assert.match(job.errorMessage, /找不到價格 selector/);
    assert.match(job.errorMessage, /HTTP 429/);
    assert.match(job.errorMessage, /價格須大於 0/);
    assert.match(job.errorMessage, /逾時/);

    const updatedCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(updatedCard.latestPrice, 948.43);
    assert.equal(updatedCard.latestCurrency, 'USD');
    assert.equal(updatedCard.imageUrl, 'https://images.example.test/card-success.jpg');
    assert.ok(updatedCard.lastFetchedAt);
  } finally {
    restoreFetch();

    if (job?.id) {
      await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
    }

    if (card?.id) {
      await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
    }
  }
});

test('runPriceSync writes imageUrl only when card.imageUrl is empty', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this integration test');
    return;
  }

  const runningJobs = await prisma.priceFetchJob.count({ where: { status: 'running' } });
  if (runningJobs > 0) {
    t.skip('a price fetch job is already running');
    return;
  }

  const restoreFetch = installFetchMock();
  const existingImage = 'https://images.example.test/already-set.jpg';
  let card;
  let job;

  try {
    card = await prisma.card.create({
      data: {
        name: `Phase 4 Image Guard ${TEST_RUN_ID}`,
        cardNumber: `${TEST_RUN_ID}-img`,
        setName: 'Phase 4',
        language: 'ja',
        condition: 'raw',
        imageUrl: existingImage,
        sources: {
          create: [
            {
              type: 'crawler',
              provider: 'priceCharting',
              url: `https://example.test/${TEST_RUN_ID}/success`,
              currency: 'USD',
            },
          ],
        },
      },
    });

    job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'success');

    const updatedCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(updatedCard.imageUrl, existingImage);
    assert.equal(updatedCard.latestPrice, 948.43);
  } finally {
    restoreFetch();
    if (job?.id) {
      await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
    }
    if (card?.id) {
      await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
    }
  }
});

test('runPriceSync keeps first imageUrl when multiple sources succeed in one job', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this integration test');
    return;
  }

  const runningJobs = await prisma.priceFetchJob.count({ where: { status: 'running' } });
  if (runningJobs > 0) {
    t.skip('a price fetch job is already running');
    return;
  }

  const restoreFetch = installFetchMock();
  let card;
  let job;

  try {
    card = await prisma.card.create({
      data: {
        name: `Phase 4 Multi Image ${TEST_RUN_ID}`,
        cardNumber: `${TEST_RUN_ID}-multiimg`,
        setName: 'Phase 4',
        language: 'ja',
        condition: 'raw',
        sources: {
          create: [
            {
              type: 'crawler',
              provider: 'priceCharting',
              url: `https://example.test/${TEST_RUN_ID}/success`,
              currency: 'USD',
            },
            {
              type: 'crawler',
              provider: 'priceCharting',
              url: `https://example.test/${TEST_RUN_ID}/success-alt-image`,
              currency: 'USD',
            },
          ],
        },
      },
    });

    job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'success');
    assert.equal(job.successCount, 2);

    const updatedCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(updatedCard.imageUrl, 'https://images.example.test/card-success.jpg');
    assert.equal(updatedCard.latestPrice, 10);
  } finally {
    restoreFetch();
    if (job?.id) {
      await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
    }
    if (card?.id) {
      await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
    }
  }
});

test('runPriceSync keeps card.imageUrl empty and succeeds when adapter omits image', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this integration test');
    return;
  }

  const runningJobs = await prisma.priceFetchJob.count({ where: { status: 'running' } });
  if (runningJobs > 0) {
    t.skip('a price fetch job is already running');
    return;
  }

  const restoreFetch = installFetchMock();
  let card;
  let job;

  try {
    card = await prisma.card.create({
      data: {
        name: `Phase 4 No Image ${TEST_RUN_ID}`,
        cardNumber: `${TEST_RUN_ID}-noimg`,
        setName: 'Phase 4',
        language: 'ja',
        condition: 'raw',
        sources: {
          create: [
            {
              type: 'crawler',
              provider: 'priceCharting',
              url: `https://example.test/${TEST_RUN_ID}/success-no-image`,
              currency: 'USD',
            },
          ],
        },
      },
    });

    job = await runPriceSync({ triggerType: 'manual', cardId: card.id });
    assert.equal(job.status, 'success');

    const updatedCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(updatedCard.imageUrl, null);
    assert.equal(updatedCard.latestPrice, 12.34);
  } finally {
    restoreFetch();
    if (job?.id) {
      await prisma.priceFetchJob.delete({ where: { id: job.id } }).catch(() => {});
    }
    if (card?.id) {
      await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
    }
  }
});
