// Seed 資料 － 對應 PRD 第二十九章（demo 卡牌 / 價格 / job，不含 Admin）
// 執行：npm run db:seed（從根目錄）
// 註：Admin 已獨立成 seedAdmin.js（本專案無註冊功能），此腳本不建也不刪 Admin。
import '@pct/shared/load-env';
import { prisma } from '../index.js';

async function main() {
  console.log('🌱 開始 seed...');

  // ── 清空 demo 資料（方便重複執行）；Admin 不動 ──
  await prisma.priceFetchLog.deleteMany();
  await prisma.priceFetchJob.deleteMany();
  await prisma.priceSnapshot.deleteMany();
  await prisma.priceSource.deleteMany();
  await prisma.card.deleteMany();

  // ── 卡牌 ──
  const pikachu = await prisma.card.create({
    data: {
      name: '皮卡丘 V',
      cardNumber: '208/XY-P',
      setName: 'XY промо',
      language: 'ja',
      condition: 'PSA10',
      imageUrl: 'https://placehold.co/240x336?text=Pikachu+V',
      sources: {
        create: [
          { type: 'api', provider: 'mockApi', externalId: 'pikachu-v', currency: 'JPY' },
          {
            type: 'crawler',
            provider: 'mockCrawler',
            url: 'https://example.com/cards/pikachu-v',
            currency: 'JPY',
          },
        ],
      },
    },
    include: { sources: true },
  });

  const charizard = await prisma.card.create({
    data: {
      name: 'リザードン V',
      cardNumber: '100/S-P',
      setName: 'Sword & Shield',
      language: 'ja',
      condition: 'raw',
      imageUrl: 'https://placehold.co/240x336?text=Charizard',
      sources: {
        create: [{ type: 'api', provider: 'mockApi', externalId: 'charizard-v', currency: 'JPY' }],
      },
    },
    include: { sources: true },
  });

  // 高價卡
  const charizardHigh = await prisma.card.create({
    data: {
      name: 'リザードン VMAX (SSR)',
      cardNumber: '308/S-P',
      setName: 'Shiny Star V',
      language: 'ja',
      condition: 'PSA10',
      imageUrl: 'https://placehold.co/240x336?text=Charizard+VMAX',
      sources: {
        create: [
          { type: 'crawler', provider: 'mockCrawler', url: 'https://example.com/cards/charizard-vmax', currency: 'JPY' },
        ],
      },
    },
    include: { sources: true },
  });

  // 一張「尚未成功抓過價格」的卡
  await prisma.card.create({
    data: {
      name: 'ミュウツー GX',
      cardNumber: '150/SM-P',
      setName: 'Sun & Moon',
      language: 'ja',
      condition: 'raw',
      sources: {
        create: [{ type: 'crawler', provider: 'mockCrawler', url: 'https://example.com/cards/mewtwo-gx', currency: 'JPY' }],
      },
    },
  });

  console.log('✅ 建立 4 張卡牌（含 1 張高價、1 張尚未抓價）');

  // ── 歷史快照（為前 3 張卡各灌幾筆，形成趨勢）──
  const seedSnapshots = [
    { card: pikachu, source: pikachu.sources[0], base: 12000 },
    { card: charizard, source: charizard.sources[0], base: 3500 },
    { card: charizardHigh, source: charizardHigh.sources[0], base: 85000 },
  ];

  for (const { card, source, base } of seedSnapshots) {
    const days = 7;
    let last = null;
    for (let i = days; i >= 0; i--) {
      const fetchedAt = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const price = Math.round(base * (1 + (Math.random() - 0.5) * 0.15));
      last = price;
      await prisma.priceSnapshot.create({
        data: {
          cardId: card.id,
          sourceId: source.id,
          provider: source.provider,
          price,
          currency: source.currency,
          rawText: `¥${price.toLocaleString()}`,
          fetchedAt,
        },
      });
    }
    // 同步卡牌最新價格摘要
    await prisma.card.update({
      where: { id: card.id },
      data: { latestPrice: last, latestCurrency: source.currency, lastFetchedAt: new Date() },
    });
  }
  console.log('✅ 建立 24 筆歷史價格快照');

  // ── 一筆成功 job、一筆失敗 job ──
  const successJob = await prisma.priceFetchJob.create({
    data: {
      triggerType: 'cron',
      status: 'success',
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: new Date(),
      totalSources: 4,
      successCount: 4,
      failedCount: 0,
      logs: {
        create: [
          { cardId: pikachu.id, sourceId: pikachu.sources[0].id, status: 'success', message: '抓價成功 ¥12,000', durationMs: 320 },
        ],
      },
    },
  });

  await prisma.priceFetchJob.create({
    data: {
      triggerType: 'manual',
      status: 'failed',
      startedAt: new Date(Date.now() - 120_000),
      finishedAt: new Date(Date.now() - 119_000),
      totalSources: 1,
      successCount: 0,
      failedCount: 1,
      errorMessage: '來源回傳 429 Too Many Requests',
      logs: {
        create: [
          { cardId: charizardHigh.id, sourceId: charizardHigh.sources[0].id, status: 'failed', message: 'HTTP 429 rate limited', durationMs: 5000 },
        ],
      },
    },
  });
  console.log(`✅ 建立 2 筆 job（success: ${successJob.id}, 1 筆 failed）`);

  console.log('🎉 Seed 完成');
}

main()
  .catch((e) => {
    console.error('❌ Seed 失敗：', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
