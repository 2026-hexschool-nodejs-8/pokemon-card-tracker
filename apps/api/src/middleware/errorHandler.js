// 統一錯誤處理 － 放在所有 route 之後
import { ZodError } from 'zod';
import { Prisma } from '@pct/db';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  // Zod 驗證錯誤 → 400，回傳欄位訊息
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: '輸入資料驗證失敗',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  // Prisma 已知錯誤（如唯一鍵衝突 P2002、找不到 P2025）
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return res.status(404).json({ error: '找不到資源' });
    if (err.code === 'P2002') return res.status(409).json({ error: '資料重複（唯一鍵衝突）' });
  }

  // 自訂 HttpError
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  logger.error('未預期錯誤：', err);
  return res.status(500).json({ error: '伺服器發生錯誤' });
}

export function notFoundHandler(_req, res) {
  res.status(404).json({ error: '找不到這個 endpoint' });
}
