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

  // 一張「已停用追蹤」的卡（測試停用卡公開 API 回 404）
  await prisma.card.create({
    data: {
      name: 'フシギバナ EX',
      cardNumber: '003/EX-P',
      setName: 'EX Series',
      language: 'ja',
      condition: 'raw',
      isActive: false,
      sources: {
        create: [{ type: 'api', provider: 'mockApi', externalId: 'bulbasaur-ex', currency: 'JPY' }],
      },
    },
  });

  console.log('✅ 建立 5 張手工卡牌（含 1 張高價、1 張尚未抓價、1 張已停用追蹤）');

  // ── 批次卡牌 ──
  // 後台總覽頁每批載入 20 張，卡片總數要超過 20 才看得到「捲到底接續載入第二批」。
  // 這裡補 25 張湊到 30 張，並讓語言 / 狀態別 / 追蹤狀態 / 來源數量都有變化，
  // 好讓篩選、來源數量欄位、「尚無來源」空狀態都有資料可驗。
  // 屬性一律由索引推導而非亂數，重跑 seed 結果才會一致。
  const BULK_NAMES = [
    'ヒトカゲ', 'ゼニガメ', 'フシギダネ', 'イーブイ', 'ミミッキュ',
    'ゲンガー', 'カビゴン', 'ラプラス', 'ギャラドス', 'サーナイト',
    'ルカリオ', 'ガブリアス', 'レックウザ', 'ミュウ', 'セレビィ',
    'ジラーチ', 'デオキシス', 'ダークライ', 'アルセウス', 'ゾロアーク',
    'ゼクロム', 'レシラム', 'キュレム', 'ゼラオラ', 'マギアナ',
  ];
  const LANGS = ['ja', 'en', 'zh'];
  const CURRENCY_BY_LANG = { ja: 'JPY', en: 'USD', zh: 'TWD' };
  const CONDITIONS = ['raw', 'PSA9', 'PSA10'];

  let bulkSourceCount = 0;
  const pricedBulk = []; // 之後要灌快照與最新價摘要的卡

  for (const [i, name] of BULK_NAMES.entries()) {
    const language = LANGS[i % LANGS.length];
    const currency = CURRENCY_BY_LANG[language];
    // 每 7 張安排 1 張停用，讓「僅停用」篩選有東西可看
    const isActive = i % 7 !== 6;
    // 來源數量輪流 2 / 1 / 1 / 1 / 0，0 用來驗「尚無來源」空狀態
    const sourceCount = i % 5 === 4 ? 0 : i % 3 === 0 ? 2 : 1;

    const card = await prisma.card.create({
      data: {
        name,
        cardNumber: `${String(i + 1).padStart(3, '0')}/BULK`,
        setName: `Demo Set ${Math.floor(i / 5) + 1}`,
        language,
        condition: CONDITIONS[i % CONDITIONS.length],
        isActive,
        imageUrl: `https://placehold.co/240x336?text=${encodeURIComponent(name)}`,
        sources: {
          create: Array.from({ length: sourceCount }, (_, s) =>
            s % 2 === 0
              ? { type: 'api', provider: 'mockApi', externalId: `bulk-${i}-${s}`, currency }
              : {
                  type: 'crawler',
                  provider: 'mockCrawler',
                  url: `https://example.com/cards/bulk-${i}-${s}`,
                  currency,
                },
          ),
        },
      },
      include: { sources: true },
    });

    bulkSourceCount += sourceCount;
    // 每 4 張留 1 張「從未抓過價」，讓摘要列的「—」空狀態有資料可看
    if (sourceCount > 0 && i % 4 !== 3) {
      pricedBulk.push({ card, source: card.sources[0], base: 500 + i * 137 });
    }
  }

  console.log(
    `✅ 建立 ${BULK_NAMES.length} 張批次卡牌（共 ${bulkSourceCount} 個來源），卡牌總數 ${5 + BULK_NAMES.length} 張`,
  );

  // ── 歷史快照（為前 3 張卡各灌幾筆，形成趨勢）──
  const seedSnapshots = [
    { card: pikachu, source: pikachu.sources[0], base: 12000, days: 7 },
    { card: charizard, source: charizard.sources[0], base: 3500, days: 7 },
    { card: charizardHigh, source: charizardHigh.sources[0], base: 85000, days: 7 },
    // 批次卡各灌 3 天就好：目的是讓摘要列的最新價 / 最後更新時間有值，不是畫趨勢圖
    ...pricedBulk.map((entry) => ({ ...entry, days: 2 })),
  ];

  let snapshotCount = 0;
  for (const { card, source, base, days } of seedSnapshots) {
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
      snapshotCount++;
    }
    // 同步卡牌最新價格摘要
    await prisma.card.update({
      where: { id: card.id },
      data: { latestPrice: last, latestCurrency: source.currency, lastFetchedAt: new Date() },
    });
  }
  console.log(`✅ 建立 ${snapshotCount} 筆歷史價格快照（${seedSnapshots.length} 張卡有最新價）`);

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
