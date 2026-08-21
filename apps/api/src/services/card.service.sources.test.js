// 來源開關守衛測試 － 守的是「追蹤中的卡片至少要有一個啟用來源」這條不變式（FR-015～FR-017）
import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@pct/db';
import { updateSource } from './card.service.js';
import { makeRunId, createCard, createSource, cleanupByRunId } from '../../testkit/helpers/db.js';

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

// 兩個交易要真的在時間上重疊才會踩到問題，而重疊與否是機率性的
// （剛好前後錯開就會僥倖通過），所以跑多輪把僥倖過關的機率壓掉
const ROUNDS = 10;

// 一輪 = 一張全新的卡 + 兩個啟用來源，同時各發一個「關掉」的請求
async function raceTwoDeactivations(runId, round) {
  const card = await createCard(runId, { name: `${runId}-${round}` });
  const [a, b] = await Promise.all([createSource(card.id), createSource(card.id)]);

  const results = await Promise.allSettled([
    updateSource(a.id, { isActive: false }),
    updateSource(b.id, { isActive: false }),
  ]);

  const after = await prisma.card.findUnique({ where: { id: card.id } });
  const activeCount = await prisma.priceSource.count({
    where: { cardId: card.id, isActive: true },
  });
  return { results, card: after, activeCount };
}

test('card.service 來源開關守衛', { skip: !dbReachable && '資料庫無法連線' }, async (t) => {
  await t.test('併發關閉同一張卡的最後兩個啟用來源：只有一個能成功，另一個回 409', async (t) => {
    const runId = makeRunId('src-race');
    t.after(() => cleanupByRunId(runId));

    for (let round = 0; round < ROUNDS; round++) {
      const { results, card, activeCount } = await raceTwoDeactivations(runId, round);

      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(rejected.length, 1, `第 ${round} 輪：應該恰好有一個請求被守衛擋下`);
      assert.equal(rejected[0].reason.status, 409, `第 ${round} 輪：被擋下的請求應回 409`);

      // 真正在意的結果：卡片還在追蹤，就不能一個啟用來源都沒有
      assert.ok(
        !(card.isActive && activeCount === 0),
        `第 ${round} 輪：卡片仍為追蹤中，卻已經沒有任何啟用來源`,
      );
    }
  });

  // 對照組：同樣兩個關閉請求，前後序列執行。守衛本身有沒有效在這裡驗，
  // 上面那個測試才能單純用來指出「守衛在併發下有沒有被繞過」
  await t.test('序列關閉同一張卡的兩個啟用來源：第二個被守衛擋下回 409', async (t) => {
    const runId = makeRunId('src-seq');
    t.after(() => cleanupByRunId(runId));

    const card = await createCard(runId);
    const a = await createSource(card.id);
    const b = await createSource(card.id);

    await updateSource(a.id, { isActive: false });
    await assert.rejects(() => updateSource(b.id, { isActive: false }), { status: 409 });

    const after = await prisma.card.findUnique({ where: { id: card.id } });
    const activeCount = await prisma.priceSource.count({
      where: { cardId: card.id, isActive: true },
    });
    assert.equal(after.isActive, true);
    assert.equal(activeCount, 1);
  });
});
