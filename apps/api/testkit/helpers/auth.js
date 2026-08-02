// 測試用 JWT／Admin helper
// adminAuth middleware 只驗證 JWT 簽章，不查 DB，所以多數路由測試不必真的建立 Admin row，
// 只有 /admin/auth/login 本身需要真實 Admin（含 hash 密碼）
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
