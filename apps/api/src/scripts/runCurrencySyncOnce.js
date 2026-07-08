// 手動跑一次匯率同步（不啟動 server）－ 方便驗證與 Demo
// 執行：npm run currency:once（從根目錄）
import '../loadEnv.js';
import { prisma } from '@pct/db';
import { runCurrencySync } from '../services/currencySync.service.js';

try {
  const { source, fetchedAt, updated } = await runCurrencySync();
  console.log('\n=== 匯率同步結果 ===');
  console.log(`來源：${source}`);
  console.log(`資料時間：${fetchedAt.toISOString()}`);
  for (const u of updated) {
    console.log(`  1 ${u.code} = ${u.rateToTwd.toFixed(4)} TWD`);
  }
} catch (err) {
  console.error('匯率同步失敗：', err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}