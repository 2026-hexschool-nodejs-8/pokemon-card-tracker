import { z } from 'zod';

// 對齊 apps/api/src/lib/adminProfile.js，登入與 /me 共用
export const adminProfileSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.string(),
});

export const loginResultSchema = z.object({
  token: z.string(),
  admin: adminProfileSchema,
});
