// 認證 HTTP 測試 － 對應 docs/test-plan.md §6.4 AU-01~09
import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { prisma } from '@pct/db';
import { createApp } from '../../src/app.js';
import { signToken } from '../../src/lib/jwt.js';
import { makeRunId, cleanupByRunId } from '../helpers/db.js';
import { createTestAdmin, cleanupTestAdmins, makeAuthHeader } from '../helpers/auth.js';

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
const app = createApp();
const request = supertest(app);

test('認證 HTTP', { skip: !dbReachable && '資料庫無法連線' }, async (t) => {
  await t.test('POST /admin/auth/login － 正確帳密 → 200 + token', async (t) => {
    const runId = makeRunId('au01');
    const { password } = await createTestAdmin(runId, { email: `${runId}@pct.local` });
    t.after(() => cleanupTestAdmins(runId));

    const res = await request.post('/admin/auth/login').send({ email: `${runId}@pct.local`, password });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['data'], '成功回應只有 data 一個頂層 key');
    assert.ok(res.body.data.token);
    assert.equal(res.body.data.admin.email, `${runId}@pct.local`);
    assert.equal(res.body.data.admin.passwordHash, undefined);
  });

  await t.test('POST /admin/auth/login － 密碼錯 → 401，訊息不洩漏帳號是否存在', async (t) => {
    const runId = makeRunId('au02');
    await createTestAdmin(runId, { email: `${runId}@pct.local`, password: 'correct-password' });
    t.after(() => cleanupTestAdmins(runId));

    const res = await request.post('/admin/auth/login').send({ email: `${runId}@pct.local`, password: 'wrong-password' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, '帳號或密碼錯誤');
  });

  await t.test('POST /admin/auth/login － email 不存在 → 401，訊息與密碼錯一致', async () => {
    const res = await request.post('/admin/auth/login').send({ email: 'nobody-here@pct.local', password: 'whatever' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, '帳號或密碼錯誤');
  });

  await t.test('POST /admin/auth/login － 缺欄位 → 400', async () => {
    const res = await request.post('/admin/auth/login').send({ email: 'x@pct.local' });
    assert.equal(res.status, 400);
  });

  await t.test('POST /admin/auth/login － email 格式錯誤 → 400', async () => {
    const res = await request.post('/admin/auth/login').send({ email: 'not-an-email', password: 'x' });
    assert.equal(res.status, 400);
  });

  await t.test('受保護路由：無 Authorization header → 401', async () => {
    const res = await request.get('/admin/jobs');
    assert.equal(res.status, 401);
  });

  await t.test('受保護路由：Authorization 格式錯（缺 Bearer）→ 401', async () => {
    const res = await request.get('/admin/jobs').set('Authorization', 'sometoken');
    assert.equal(res.status, 401);
  });

  await t.test('受保護路由：Authorization 只有 "Bearer"（無 token）→ 401', async () => {
    const res = await request.get('/admin/jobs').set('Authorization', 'Bearer');
    assert.equal(res.status, 401);
  });

  await t.test('受保護路由：過期 token → 401', async () => {
    // signToken 不支援自訂 expiresIn 覆寫，這裡改用手動組一個已過期的 JWT
    const jwt = await import('jsonwebtoken');
    const expired = jwt.default.sign(
      { sub: 'x', email: 'x@pct.local', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: -10 },
    );
    const res = await request.get('/admin/jobs').set('Authorization', `Bearer ${expired}`);
    assert.equal(res.status, 401);
  });

  await t.test('受保護路由：篡改簽章的 token → 401', async () => {
    const token = signToken({ sub: 'x', email: 'x@pct.local', role: 'admin' });
    const tampered = token.slice(0, -2) + 'xx';
    const res = await request.get('/admin/jobs').set('Authorization', `Bearer ${tampered}`);
    assert.equal(res.status, 401);
  });

  await t.test('受保護路由：合法 token → 通過驗證', async () => {
    const res = await request.get('/admin/jobs').set('Authorization', makeAuthHeader());
    assert.equal(res.status, 200);
  });

  await t.test('GET /admin/auth/me － 合法 token → 回傳與登入相同的 admin profile', async (t) => {
    const runId = makeRunId('aume');
    const { admin } = await createTestAdmin(runId, { email: `${runId}@pct.local` });
    t.after(() => cleanupTestAdmins(runId));

    const res = await request
      .get('/admin/auth/me')
      .set('Authorization', makeAuthHeader({ sub: admin.id, email: admin.email, role: admin.role }));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body), ['data'], '成功回應只有 data 一個頂層 key');
    assert.deepEqual(res.body.data, {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    });
    assert.equal(res.body.data.passwordHash, undefined);
    assert.equal(res.body.data.sub, undefined);
    assert.equal(res.body.data.iat, undefined);
    assert.equal(res.body.data.exp, undefined);
  });

  await t.test('GET /admin/auth/me － token 有效但帳號已刪 → 401', async () => {
    const runId = makeRunId('aume2');
    const { admin } = await createTestAdmin(runId, { email: `${runId}@pct.local` });
    const header = makeAuthHeader({ sub: admin.id, email: admin.email, role: admin.role });
    await cleanupTestAdmins(runId);

    const res = await request.get('/admin/auth/me').set('Authorization', header);
    assert.equal(res.status, 401);
    assert.equal(res.body.error, '帳號已失效');
  });
});
