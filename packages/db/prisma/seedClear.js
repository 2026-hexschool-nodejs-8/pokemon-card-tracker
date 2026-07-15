// 清空 demo / seed 產生的資料，但「保留 Admin」（本專案 admin 只有一個，不該被洗掉）
// 執行：npm run db:seed:clear（從根目錄）
//
// 用途：demo 資料要換成真資料前，先清掉假卡牌與價格紀錄，但保住登入帳號。
import '@pct/shared/load-env';
import { prisma } from '../index.js';

async function main() {
  // 依外鍵順序：子表先刪，最後刪 Card。Admin 不在清單內，故保留。
  await prisma.priceFetchLog.deleteMany();
  await prisma.priceFetchJob.deleteMany();
  await prisma.priceSnapshot.deleteMany();
  await prisma.priceSource.deleteMany();
  await prisma.card.deleteMany();

  console.log('🧹 已清空 demo 資料（卡牌 / 來源 / 快照 / job / log），Admin 保留');
}

main()
  .catch((e) => {
    console.error('❌ 清空失敗：', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
