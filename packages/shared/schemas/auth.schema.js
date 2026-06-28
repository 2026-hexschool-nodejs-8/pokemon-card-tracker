// 管理者登入 Zod schema
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email 格式不正確'),
  password: z.string().min(1, '請輸入密碼'),
});
