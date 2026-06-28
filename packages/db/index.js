// @pct/db － 全專案共用的 Prisma client
// api / seed / scripts 都從這裡 import，避免建立多份 client 實例
import { PrismaClient, Prisma } from '@prisma/client';

// 開發時用 globalThis 快取，避免 --watch 熱重載時建立過多連線
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__pctPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__pctPrisma = prisma;
}

// Prisma 命名空間（型別、錯誤類別如 Prisma.PrismaClientKnownRequestError）
export { Prisma };
