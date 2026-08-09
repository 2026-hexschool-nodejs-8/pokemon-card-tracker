// TCGPlayer 匯入相關 Zod schema
import { z } from 'zod';

// clamp 而非拒絕：維持現有「隨便給都能跑」的行為（缺值／非數字／超出範圍一律夾回合法區間），
// 只是把邏輯集中到 shared 供前後端共用，取代原本散落在 route 裡的 parseInt/Math.max/Math.min
const clampedInt = (min, max, fallback) =>
  z
    .coerce
    .number()
    .catch(fallback)
    .transform((n) => {
      const int = Math.trunc(n);
      if (!Number.isFinite(int)) return fallback;
      return Math.min(max, Math.max(min, int));
    });

export const importTcgplayerSchema = z.object({
  page: clampedInt(1, Number.MAX_SAFE_INTEGER, 1),
  limit: clampedInt(1, 50, 10),
});

export const importTcgplayerSearchSchema = z.object({
  name: z.string().trim().min(1, '請輸入卡牌名稱'),
  limit: clampedInt(1, 20, 5),
});
