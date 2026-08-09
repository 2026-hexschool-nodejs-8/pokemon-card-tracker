// 測試用 JWT／Admin helper
// adminAuth middleware 只驗證 JWT 簽章，不查 DB，所以多數受保護路由測試不必真的建立 Admin row。
// 例外：/admin/auth/login（需 hash 密碼）、/admin/auth/me（會再查 DB 確認帳號仍存在）
import { prisma } from '@pct/db';
import { signToken } from '../../src/lib/jwt.js';
import { hashPassword } from '../../src/lib/password.js';

export function makeAuthHeader(payload = {}) {
  const token = signToken({
    sub: 'test-admin-id',
    email: 'test-admin@pct.local',
    role: 'admin',
    ...payload,
  });
  return `Bearer ${token}`;
}

export async function createTestAdmin(runId, { email, password = 'test-password-123' } = {}) {
  const admin = await prisma.admin.create({
    data: {
      email: email || `${runId}-admin@pct.local`,
      passwordHash: await hashPassword(password),
      name: `${runId}-admin`,
    },
  });
  return { admin, password };
}

export async function cleanupTestAdmins(runId) {
  await prisma.admin.deleteMany({ where: { name: { startsWith: runId } } });
}
