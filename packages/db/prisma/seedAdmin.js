// 建立／更新唯一的管理者帳號（本專案無註冊功能，admin 一律用此腳本建）
// 執行：npm run db:seed:admin（從根目錄）
//
// 帳密從環境變數讀，沒設時 fallback 到 demo 值 —— 正式站務必用環境變數，勿走 fallback：
//   SEED_ADMIN_EMAIL、SEED_ADMIN_PASSWORD
//
// 用 upsert：admin 已存在就更新密碼（等於「重設密碼」），不存在就建立。
// 只碰 Admin 一張表，不刪任何其他資料。
import '@pct/shared/load-env';
import bcrypt from 'bcryptjs';
import { prisma } from '../index.js';

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@pct.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin1234';
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.admin.upsert({
    where: { email },
    update: { passwordHash },
    create: { email, passwordHash, name: '管理者' },
  });

  console.log(`✅ 管理者已就緒：${email}`); // 不印密碼
}

main()
  .catch((e) => {
    console.error('❌ 建立管理者失敗：', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
