// getCardPriceSummary 的漲跌幅基準挑選 － 對應 review 的邊界情境
// 重點不在「算得對不對」，而在「該回 null 的時候有沒有誠實回 null」：
// 拿自己當基準、拿過舊的價格當基準，都會讓畫面顯示看似正常卻錯誤的數字。
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker?schema=public';

const { prisma } = await import('@pct/db');
const { getCardPriceSummary } = await import('./card.service.js');

const TEST_RUN_ID = `summary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS);

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// snapshots: [{ days, price, currency, priceTwd }]，days 是「幾天前」
async function createCardWith(label, snapshots) {
  const card = await prisma.card.create({
    data: {
      name: `Summary Test ${label} ${TEST_RUN_ID}`,
      cardNumber: `${TEST_RUN_ID}-${label}`,
      setName: 'Summary Test',
      language: 'ja',
      condition: 'raw',
      sources: {
        create: [
          {
            type: 'api',
            provider: 'mockApi',
            externalId: `${TEST_RUN_ID}-${label}`,
            currency: 'JPY',
          },
        ],
      },
    },
    include: { sources: true },
  });

  await prisma.priceSnapshot.createMany({
    data: snapshots.map((s) => ({
      cardId: card.id,
      sourceId: card.sources[0].id,
      provider: 'mockApi',
      price: s.price ?? 100,
      currency: s.currency ?? 'JPY',
      priceTwd: s.priceTwd,
      fetchedAt: daysAgo(s.days),
    })),
  });

  return card;
}

// 每個案例包一層：跑完一定刪卡（sources / snapshots 會 cascade）
async function withCard(t, label, snapshots, assertFn) {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this integration test');
    return;
  }
  let card;
  try {
    card = await createCardWith(label, snapshots);
    assertFn(await getCardPriceSummary(card.id));
  } finally {
    if (card?.id) await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
  }
}

test('正常情況：7 日與 30 日各自挑到對應窗口的基準', async (t) => {
  await withCard(
    t,
    'happy',
    [
      { days: 31, priceTwd: 500 },
      { days: 8, priceTwd: 800 },
      { days: 0, priceTwd: 1000 },
    ],
    (summary) => {
      assert.equal(summary.change7d.diffTwd, 200);
      assert.equal(summary.change7d.pct, 25);
      assert.equal(summary.change30d.diffTwd, 500);
      assert.equal(summary.change30d.pct, 100);
      assert.ok(summary.change7d.basisFetchedAt instanceof Date);
    },
  );
});

test('最新快照沒有台幣價（換算失敗）→ 兩個窗口都回 null', async (t) => {
  await withCard(
    t,
    'latest-null',
    [
      { days: 8, priceTwd: 800 },
      { days: 0, priceTwd: null },
    ],
    (summary) => {
      assert.equal(summary.change7d, null);
      assert.equal(summary.change30d, null);
    },
  );
});

test('最新快照台幣價為 0 → 回 null，不是 -100%', async (t) => {
  await withCard(
    t,
    'latest-zero',
    [
      { days: 8, priceTwd: 800 },
      { days: 0, priceTwd: 0 },
    ],
    (summary) => {
      assert.equal(summary.change7d, null);
    },
  );
});

test('窗口內較新的基準是 null → 跳過它，挑到有台幣價的那筆', async (t) => {
  await withCard(
    t,
    'skip-null-basis',
    [
      { days: 8, priceTwd: 800 },
      { days: 7.2, priceTwd: null },
      { days: 0, priceTwd: 1000 },
    ],
    (summary) => {
      assert.equal(summary.change7d.diffTwd, 200);
      assert.equal(summary.change7d.pct, 25);
    },
  );
});

test('基準台幣價為 0 → 回 null，不會除以 0 變成 Infinity', async (t) => {
  await withCard(
    t,
    'basis-zero',
    [
      { days: 8, priceTwd: 0 },
      { days: 0, priceTwd: 1000 },
    ],
    (summary) => {
      assert.equal(summary.change7d, null);
    },
  );
});

test('最新快照本身就超過 7 天 → 回 null，不是拿自己比自己得到 0%', async (t) => {
  await withCard(t, 'stale-latest', [{ days: 10, priceTwd: 1000 }], (summary) => {
    assert.equal(summary.change7d, null);
    assert.equal(summary.change30d, null);
  });
});

test('只有一筆很舊的歷史快照 → 不會被當成 7 日／30 日基準', async (t) => {
  await withCard(
    t,
    'too-old-basis',
    [
      { days: 100, priceTwd: 500 },
      { days: 0, priceTwd: 1000 },
    ],
    (summary) => {
      assert.equal(summary.change7d, null);
      assert.equal(summary.change30d, null);
    },
  );
});

test('完全沒有歷史快照 → 兩個窗口都回 null', async (t) => {
  await withCard(t, 'no-history', [{ days: 0, priceTwd: 1000 }], (summary) => {
    assert.equal(summary.change7d, null);
    assert.equal(summary.change30d, null);
  });
});

test('跨幣別：USD 與 JPY 的快照一律用台幣比較', async (t) => {
  await withCard(
    t,
    'cross-currency',
    [
      { days: 8, price: 30, currency: 'USD', priceTwd: 900 },
      { days: 0, price: 4000, currency: 'JPY', priceTwd: 990 },
    ],
    (summary) => {
      assert.equal(summary.latestCurrency, 'JPY');
      assert.equal(summary.change7d.diffTwd, 90);
      assert.equal(summary.change7d.pct, 10);
    },
  );
});
