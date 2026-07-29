// 契約測試（HTTP 層）：GET /admin/cards、PATCH /admin/sources/:id/deactivate-last
//
// 既有的 *.test.js 直接呼叫 service，碰不到 route 這一層——adminAuth 有沒有掛上、
// Zod 的 default/夾取/cuid 驗證、以及 service 丟的 httpError 有沒有被 errorHandler
// 對到正確的 HTTP status，都不會被覆蓋。這支從真正的 express app 打進去補上這段。
//
// auth 與驗證情境完全不碰 DB，任何環境都會跑；需要資料的情境連不到 DB 才 skip。
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker?schema=public';
process.env.JWT_SECRET ||= 'test-insecure-secret';

const { prisma } = await import('@pct/db');
const { createApp } = await import('../app.js');
const { signToken } = await import('../lib/jwt.js');
const { adminListCardsQuerySchema } = await import('@pct/shared');

const TEST_RUN_ID = `http-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// 開在隨機空閒 port，用 Node 內建 fetch 打，不引入 supertest
const server = createApp().listen(0);
await once(server, 'listening');
const BASE = `http://127.0.0.1:${server.address().port}`;
const TOKEN = signToken({ sub: 'test-admin', email: 'admin@pct.local', role: 'admin' });

test.after(async () => {
  server.close();
  await prisma.$disconnect().catch(() => {});
});

function api(path, { token = TOKEN, method = 'GET' } = {}) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// ── adminAuth 有掛在整個 router 上（不需 DB）──
test('未帶 / 帶壞 token 的請求一律 401，不會進到 service', async () => {
  assert.equal((await api('/admin/cards', { token: null })).status, 401);

  // 有 header 但不是 Bearer scheme
  const wrongScheme = await fetch(`${BASE}/admin/cards`, {
    headers: { Authorization: `Token ${TOKEN}` },
  });
  assert.equal(wrongScheme.status, 401);

  // 簽章對不上
  assert.equal((await api('/admin/cards', { token: 'not-a-jwt' })).status, 401);

  // 新端點同樣受保護
  assert.equal(
    (await api('/admin/sources/whatever/deactivate-last', { token: null, method: 'PATCH' })).status,
    401,
  );
});

// ── Zod 驗證失敗 → errorHandler 對到 400（不需 DB，parse 在呼叫 service 前就丟錯）──
test('query 不合法時回 400 並帶欄位訊息', async () => {
  for (const qs of ['cursor=not-a-cuid', 'limit=0', 'limit=-1', 'limit=abc', 'isActive=maybe']) {
    const res = await api(`/admin/cards?${qs}`);
    assert.equal(res.status, 400, `${qs} 應回 400`);
    const body = await res.json();
    assert.equal(body.error, '輸入資料驗證失敗');
    assert.ok(Array.isArray(body.issues) && body.issues.length > 0, `${qs} 應帶 issues`);
  }
});

// ── limit 的 default 與上限夾取（純 schema，不需 DB）──
test('adminListCardsQuerySchema：limit 預設 20、上限夾為 50', () => {
  assert.equal(adminListCardsQuerySchema.parse({}).limit, 20);
  assert.equal(adminListCardsQuerySchema.parse({ limit: '35' }).limit, 35);
  assert.equal(adminListCardsQuerySchema.parse({ limit: '50' }).limit, 50);
  assert.equal(adminListCardsQuerySchema.parse({ limit: '999' }).limit, 50);
  // isActive 是字串 enum → 轉 boolean 才進 service
  assert.equal(adminListCardsQuerySchema.parse({ isActive: 'false' }).isActive, false);
  // cursor 不帶就是 undefined（第一批）
  assert.equal(adminListCardsQuerySchema.parse({}).cursor, undefined);
});

// ── service 丟的 httpError → 正確的 HTTP status（需 DB）──
test('deactivate-last：守衛不成立回 409、找不到來源回 404、成功回 200', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this test');
    return;
  }

  // 找不到來源 → 404
  assert.equal((await api('/admin/sources/no-such-source/deactivate-last', { method: 'PATCH' })).status, 404);

  const created = [];
  try {
    // 兩個啟用來源 → 都不是「最後一個」，守衛不成立 → 409
    const twoSources = await prisma.card.create({
      data: {
        name: `${TEST_RUN_ID} two`,
        cardNumber: `${TEST_RUN_ID}-two`,
        language: 'ja',
        condition: 'raw',
        isActive: true,
        sources: {
          create: [0, 1].map((i) => ({
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
    created.push(twoSources.id);

    const conflict = await api(`/admin/sources/${twoSources.sources[0].id}/deactivate-last`, {
      method: 'PATCH',
    });
    assert.equal(conflict.status, 409);
    assert.match((await conflict.json()).error, /最後一個啟用中來源/);
    // 409 時整筆不變更
    assert.equal(
      (await prisma.priceSource.findUnique({ where: { id: twoSources.sources[0].id } })).isActive,
      true,
    );
    assert.equal((await prisma.card.findUnique({ where: { id: twoSources.id } })).isActive, true);

    // 只有一個啟用來源 → 200，來源與卡片一起停用
    const oneSource = await prisma.card.create({
      data: {
        name: `${TEST_RUN_ID} one`,
        cardNumber: `${TEST_RUN_ID}-one`,
        language: 'ja',
        condition: 'raw',
        isActive: true,
        sources: {
          create: [{ type: 'api', provider: 'p0', externalId: 'ext-0', currency: 'JPY', isActive: true }],
        },
      },
      include: { sources: true },
    });
    created.push(oneSource.id);

    const ok = await api(`/admin/sources/${oneSource.sources[0].id}/deactivate-last`, {
      method: 'PATCH',
    });
    assert.equal(ok.status, 200);
    const { data } = await ok.json();
    assert.equal(data.source.isActive, false);
    assert.equal(data.card.isActive, false);
  } finally {
    for (const id of created) {
      await prisma.card.delete({ where: { id } }).catch(() => {});
    }
  }
});

// ── 一般 PATCH /admin/sources/:id 也擋「關掉最後一個啟用來源」（需 DB）──
// 前端是用展開時抓的快取判斷，快取過期就會誤走這條路，
// 讓卡片停在「追蹤中但沒有任何啟用來源」的不一致狀態
test('PATCH /admin/sources/:id：關掉最後一個啟用來源回 409，其餘照常更新', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this test');
    return;
  }

  const created = [];
  const makeCard = async (label, activeFlags) => {
    const card = await prisma.card.create({
      data: {
        name: `${TEST_RUN_ID} ${label}`,
        cardNumber: `${TEST_RUN_ID}-${label}`,
        language: 'ja',
        condition: 'raw',
        isActive: true,
        sources: {
          create: activeFlags.map((isActive, i) => ({
            type: 'api',
            provider: `p${i}`,
            externalId: `ext-${i}`,
            currency: 'JPY',
            isActive,
          })),
        },
      },
      include: { sources: true },
    });
    created.push(card.id);
    return card;
  };

  const patch = (id, body) =>
    fetch(`${BASE}/admin/sources/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    // 唯一啟用來源 → 409，且來源與卡片都不變
    const single = await makeCard('single', [true]);
    const blocked = await patch(single.sources[0].id, { isActive: false });
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /最後一個啟用中來源/);
    assert.equal(
      (await prisma.priceSource.findUnique({ where: { id: single.sources[0].id } })).isActive,
      true,
    );
    assert.equal((await prisma.card.findUnique({ where: { id: single.id } })).isActive, true);

    // 還有其他啟用來源 → 正常關閉
    const many = await makeCard('many', [true, true]);
    assert.equal((await patch(many.sources[0].id, { isActive: false })).status, 200);
    assert.equal(
      (await prisma.priceSource.findUnique({ where: { id: many.sources[0].id } })).isActive,
      false,
    );
    // 卡片不受影響（FR-017：關閉非最後來源不動卡片）
    assert.equal((await prisma.card.findUnique({ where: { id: many.id } })).isActive, true);

    // 重新啟用不受守衛影響
    const off = await makeCard('off', [false, true]);
    assert.equal((await patch(off.sources[0].id, { isActive: true })).status, 200);

    // 非 isActive 的欄位編輯不受守衛影響（即使是唯一啟用來源）
    const rename = await makeCard('rename', [true]);
    assert.equal((await patch(rename.sources[0].id, { url: 'https://example.com/x' })).status, 200);

    // 找不到來源 → 404
    assert.equal((await patch('no-such-source', { isActive: false })).status, 404);
  } finally {
    for (const id of created) {
      await prisma.card.delete({ where: { id } }).catch(() => {});
    }
  }
});

// ── GET /admin/cards 的回應形狀與路由順序（需 DB）──
test('GET /admin/cards 回 { data, nextCursor }，且 limit 未帶時預設 20', async (t) => {
  if (!(await canReachDatabase())) {
    t.skip('database is not reachable; start postgres and run migrations to execute this test');
    return;
  }

  const created = [];
  try {
    for (let i = 0; i < 21; i++) {
      const card = await prisma.card.create({
        data: {
          name: `${TEST_RUN_ID} 皮卡丘 ${i}`,
          cardNumber: `${TEST_RUN_ID}-${String(i).padStart(2, '0')}`,
          language: 'ja',
          condition: 'raw',
          isActive: true,
        },
      });
      created.push(card.id);
    }

    const res = await api(`/admin/cards?keyword=${TEST_RUN_ID}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.ok('nextCursor' in body);
    // 沒帶 limit → Zod default 20（不是撈全部 21 張）
    assert.equal(body.data.length, 20);
    assert.ok(body.nextCursor);
    assert.equal(body.data[0]._count.sources, 0);
  } finally {
    for (const id of created) {
      await prisma.card.delete({ where: { id } }).catch(() => {});
    }
  }
});
