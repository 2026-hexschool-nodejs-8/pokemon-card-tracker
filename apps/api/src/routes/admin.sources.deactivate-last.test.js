// 契約測試：PATCH /admin/sources/:id/deactivate-last（透過 service deactivateLastSource）
// 需可連到 DB；連不到則 skip（與既有 *.test.js 慣例一致）
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker?schema=public';

const { prisma } = await import('@pct/db');
const { deactivateLastSource } = await import('../services/card.service.js');

const TEST_RUN_ID = `dl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// 建一張啟用卡 + N 個啟用來源
async function makeCard(activeSourceCount) {
  return prisma.card.create({
    data: {
      name: `${TEST_RUN_ID} card`,
      cardNumber: `${TEST_RUN_ID}-${Math.random().toString(36).slice(2)}`,
      language: 'ja',
      condition: 'raw',
      isActive: true,
      sources: {
        create: Array.from({ length: activeSourceCount }, (_, i) => ({
          type: 'api',
          provider: `p${i}`,
          externalId: `ext-${i}`,
          currency: 'JPY',
          isActive: true,
        })),
      },
    },
    include: { sources: true },
  });
}

// 包一層 client：讓交易內 tx.card.update 拋錯，用來驗證整筆 rollback
function makeThrowingClient(realPrisma) {
  const bindIfFn = (target, prop) => {
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  };
  return {
    $transaction: (fn) =>
      realPrisma.$transaction((tx) => {
        const cardProxy = new Proxy(tx.card, {
          get(ct, cp) {
            if (cp === 'update') {
              return async () => {
                throw new Error('simulated card.update failure');
              };
            }
            return bindIfFn(ct, cp);
          },
        });
        const wrappedTx = new Proxy(tx, {
          get(target, prop) {
            if (prop === 'card') return cardProxy;
            return bindIfFn(target, prop);
          },
        });
        return fn(wrappedTx);
      }),
  };
}

test('deactivate-last：唯一啟用來源 → 來源與卡片同時停用且持久、單向不回復（FR-016/FR-018、SC-008）', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable');
    return;
  }

  let card;
  try {
    card = await makeCard(1);
    const src = card.sources[0];

    const result = await deactivateLastSource(src.id);
    assert.equal(result.source.isActive, false);
    assert.equal(result.card.isActive, false);

    // 重查一致
    const dbSrc = await prisma.priceSource.findUnique({ where: { id: src.id } });
    const dbCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(dbSrc.isActive, false);
    assert.equal(dbCard.isActive, false);

    // 單向性（FR-018）：重新啟用來源後卡片仍停用（不自動回復追蹤）
    await prisma.priceSource.update({ where: { id: src.id }, data: { isActive: true } });
    const cardAfter = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(cardAfter.isActive, false);
  } finally {
    if (card?.id) await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
  }
});

test('deactivate-last 防呆守衛：仍有 ≥2 個啟用來源 → 409 且來源與卡片皆不變', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable');
    return;
  }

  let card;
  try {
    card = await makeCard(2);
    const src = card.sources[0];

    await assert.rejects(
      () => deactivateLastSource(src.id),
      (err) => {
        assert.equal(err.status, 409);
        return true;
      },
    );

    // 皆不變
    const dbSrc = await prisma.priceSource.findUnique({ where: { id: src.id } });
    const dbCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(dbSrc.isActive, true);
    assert.equal(dbCard.isActive, true);
  } finally {
    if (card?.id) await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
  }
});

test('deactivate-last 交易失敗 → 整筆 rollback（來源維持啟用、卡片維持啟用）', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable');
    return;
  }

  let card;
  try {
    card = await makeCard(1);
    const src = card.sources[0];

    const throwingClient = makeThrowingClient(prisma);
    await assert.rejects(() => deactivateLastSource(src.id, throwingClient));

    // 來源 rollback 回啟用；卡片維持啟用
    const dbSrc = await prisma.priceSource.findUnique({ where: { id: src.id } });
    const dbCard = await prisma.card.findUnique({ where: { id: card.id } });
    assert.equal(dbSrc.isActive, true);
    assert.equal(dbCard.isActive, true);
  } finally {
    if (card?.id) await prisma.card.delete({ where: { id: card.id } }).catch(() => {});
  }
});
