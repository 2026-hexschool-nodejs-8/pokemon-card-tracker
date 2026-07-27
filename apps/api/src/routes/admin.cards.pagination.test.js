// 契約測試：GET /admin/cards cursor 分頁（透過 service adminListCards）
// 需可連到 DB；連不到則 skip（與既有 *.test.js 慣例一致）
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker?schema=public';

const { prisma } = await import('@pct/db');
const { adminListCards } = await import('../services/card.service.js');

const TEST_RUN_ID = `pg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

test('GET /admin/cards cursor 分頁：批量、接續不重不漏、到底、isActive/keyword 篩選', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this integration test');
    return;
  }

  const created = [];
  try {
    // 建 23 張帶唯一標記的卡；前 3 張停用、其餘 20 張啟用
    for (let i = 0; i < 23; i++) {
      const card = await prisma.card.create({
        data: {
          name: `${TEST_RUN_ID} 皮卡丘 ${i}`,
          cardNumber: `${TEST_RUN_ID}-${String(i).padStart(2, '0')}`,
          language: 'ja',
          condition: 'raw',
          isActive: i >= 3,
        },
      });
      created.push(card);
    }

    // 第一批 limit=20：滿批且 nextCursor 非 null
    const page1 = await adminListCards({ keyword: TEST_RUN_ID, limit: 20 });
    assert.equal(page1.data.length, 20);
    assert.ok(page1.nextCursor, 'nextCursor 應為非 null');
    // 摘要含 _count.sources（本例皆 0）
    assert.equal(page1.data[0]._count.sources, 0);

    // 第二批以 nextCursor 接續：剩 3 張、最後一批 nextCursor === null
    const page2 = await adminListCards({ keyword: TEST_RUN_ID, limit: 20, cursor: page1.nextCursor });
    assert.equal(page2.data.length, 3);
    assert.equal(page2.nextCursor, null);

    // 不重複、不遺漏：兩批合併恰為 23 個 unique id
    const ids = [...page1.data, ...page2.data].map((c) => c.id);
    assert.equal(ids.length, 23);
    assert.equal(new Set(ids).size, 23);

    // isActive=false 只回停用卡（前 3 張）
    const inactive = await adminListCards({ keyword: TEST_RUN_ID, isActive: false, limit: 50 });
    assert.equal(inactive.data.length, 3);
    assert.ok(inactive.data.every((c) => c.isActive === false));

    // isActive=true 回其餘 20 張
    const active = await adminListCards({ keyword: TEST_RUN_ID, isActive: true, limit: 50 });
    assert.equal(active.data.length, 20);
    assert.ok(active.data.every((c) => c.isActive === true));

    // keyword 同時比對卡名與卡號：
    // 只命中卡號的關鍵字（name 不含此字串）→ 回該卡
    const byNumber = await adminListCards({ keyword: created[5].cardNumber, limit: 50 });
    assert.ok(byNumber.data.some((c) => c.id === created[5].id));
    // 只命中卡名的關鍵字（cardNumber 不含此字串）→ 回該卡
    const byName = await adminListCards({ keyword: `${TEST_RUN_ID} 皮卡丘 7`, limit: 50 });
    assert.ok(byName.data.some((c) => c.id === created[7].id));
  } finally {
    for (const c of created) {
      await prisma.card.delete({ where: { id: c.id } }).catch(() => {});
    }
  }
});
