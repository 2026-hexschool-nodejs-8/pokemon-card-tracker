import { Router } from 'express';
import { prisma } from '@pct/db';
import { loginSchema } from '@pct/shared';
import { verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
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
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
  }),
);

// GET /admin/auth/me － 驗證 token 是否有效
router.get('/me', adminAuth, (req, res) => {
  res.json({ admin: req.admin });
});

export default router;
