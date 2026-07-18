// 匯率同步主流程 － W2 會議決策：定期抓匯率、覆蓋寫入 Currency 表，供價格清洗換算 TWD。
//   抓匯率（各外幣對 TWD）→ upsert 每個幣別（覆蓋）→ 回傳結果
import { prisma } from '@pct/db';
import { fetchRatesToTwd } from '../adapters/exchangeRate.adapter.js';
import { logger } from '../lib/logger.js';

/**
 * 執行一次匯率同步：抓最新匯率並覆蓋寫入 Currency 表。
 */
export async function runCurrencySync() {
  const { source, fetchedAt, rates } = await fetchRatesToTwd();

  const entries = Object.entries(rates); // [ [code, rateToTwd], ... ]
  // 覆蓋寫入：每個幣別一列，存在就更新、不存在就新增。
  // $transaction 回傳每個 upsert 實際寫入 DB 的列，後續直接沿用（單一事實來源）。
  const rows = await prisma.$transaction(
    entries.map(([code, rateToTwd]) =>
      prisma.currency.upsert({
        where: { code },
        create: { code, rateToTwd, source, fetchedAt },
        update: { rateToTwd, source, fetchedAt },
      }),
    ),
  );

  const updated = rows.map(({ code, rateToTwd }) => ({ code, rateToTwd }));
  logger.info(
    `匯率同步完成（來源 ${source}）：` +
      updated.map((u) => `${u.code}=${u.rateToTwd.toFixed(4)}`).join(', '),
  );
  return { source, fetchedAt, updated };
}
