import { Router } from 'express';
import { prisma } from '@pct/db';
import { loginSchema } from '@pct/shared';
import { verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { toAdminProfile } from '../lib/adminProfile.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { unauthorized } from '../lib/httpError.js';

const router = Router();

// POST /admin/auth/login
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
      throw unauthorized('帳號或密碼錯誤');
    }

    const token = signToken({ sub: admin.id, email: admin.email, role: admin.role });
    res.json({
      token,
      admin: toAdminProfile(admin),
    });
  }),
);

// GET /admin/auth/me － 驗證 token，並確認帳號仍存在
router.get(
  '/me',
  adminAuth,
  asyncHandler(async (req, res) => {
    const admin = await prisma.admin.findUnique({ where: { id: req.admin.sub } });
    if (!admin) throw unauthorized('帳號已失效');
    res.json({ admin: toAdminProfile(admin) });
  }),
);

export default router;
