// service 層測試：adminListCards 的 cursor 分頁與篩選
//（HTTP 層的 adminAuth / Zod / status 對應見 admin.cards.http.test.js）
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

// 迴歸測試：排序鍵若用 updatedAt（會被開關切換與抓價 job 改寫），
// 被改的卡會跳到排序最前，游標定位錯位 → 後續批次重複或遺漏。
// 改用 createdAt（建立後不再變動）後，分頁途中有資料被更新也不受影響。
test('cursor 分頁：批次之間有卡片被更新，仍不重複、不遺漏', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this integration test');
    return;
  }

  const RUN = `mut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const created = [];
  try {
    for (let i = 0; i < 25; i++) {
      created.push(
        await prisma.card.create({
          data: {
            name: `${RUN} 卡 ${i}`,
            cardNumber: `${RUN}-${String(i).padStart(2, '0')}`,
            language: 'ja',
            condition: 'raw',
            isActive: true,
          },
        }),
      );
    }

    // 第一批
    const page1 = await adminListCards({ keyword: RUN, limit: 10 });
    assert.equal(page1.data.length, 10);

    // 模擬兩種會改寫 updatedAt 的事件：
    // (1) 管理者關掉「游標那張卡」的追蹤
    await prisma.card.update({
      where: { id: page1.data[page1.data.length - 1].id },
      data: { isActive: false },
    });
    // (2) 抓價 job 更新一張「還沒載入」的卡的摘要
    await prisma.card.update({
      where: { id: created[0].id },
      data: { lastFetchedAt: new Date(), latestPrice: 1234 },
    });

    // 走完剩下的批次
    const seen = [...page1.data.map((c) => c.id)];
    let cursor = page1.nextCursor;
    let guard = 0;
    while (cursor && guard++ < 10) {
      const page = await adminListCards({ keyword: RUN, limit: 10, cursor });
      seen.push(...page.data.map((c) => c.id));
      cursor = page.nextCursor;
    }

    // 25 張全部拿到，且沒有任何一張重複
    assert.equal(new Set(seen).size, 25, '不應遺漏任何卡片');
    assert.equal(seen.length, 25, '不應重複回傳同一張卡片');
    assert.deepEqual(new Set(seen), new Set(created.map((c) => c.id)));
  } finally {
    for (const c of created) {
      await prisma.card.delete({ where: { id: c.id } }).catch(() => {});
    }
  }
});
