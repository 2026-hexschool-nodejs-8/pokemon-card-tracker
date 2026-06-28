// 手動跑一次抓價（不啟動 server）－ 方便驗證主流程與 Demo
// 執行：npm run job:once（從根目錄）
import { prisma } from '@pct/db';
import { JOB_TRIGGER_TYPE } from '@pct/shared';
import { runPriceSync } from '../services/priceSync.service.js';

const cardId = process.argv[2]; // 可選：只更新單張卡

try {
  const job = await runPriceSync({ triggerType: JOB_TRIGGER_TYPE.MANUAL, cardId });
  console.log('\n=== Job 結果 ===');
  console.log(`狀態：${job.status}`);
  console.log(`成功 ${job.successCount} / 失敗 ${job.failedCount}（共 ${job.totalSources} 來源）`);
  if (job.errorMessage) console.log(`錯誤摘要：${job.errorMessage}`);
} catch (err) {
  console.error('抓價失敗：', err.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
