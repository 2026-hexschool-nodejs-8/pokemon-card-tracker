// Seed 資料 － 對應 PRD 第二十九章（demo 卡牌 / 價格 / job，不含 Admin）
// 執行：npm run db:seed（從根目錄）
// 註：Admin 已獨立成 seedAdmin.js（本專案無註冊功能），此腳本不建也不刪 Admin。
import '@pct/shared/load-env';
import { SUPPORTED_CURRENCIES, BASE_CURRENCY } from '@pct/shared';
import { prisma } from '../index.js';

// Demo 用的近似匯率。`db:reset` 會清空 Currency 表，而 `db:seed` 與 `job:once` 都只讀不寫，
// 沒有備援的話所有快照的 priceTwd 都是 null，前台趨勢圖會整張空白。
// 寫死在這裡是刻意的：seed 不該依賴外部匯率 API 才跑得起來（Demo 當天斷網也要能展示）。
const FALLBACK_RATES = { TWD: 1, USD: 32.2, JPY: 0.199, HKD: 4.13, EUR: 35 };

// 取得幣別 → 台幣匯率。Currency 表是空的就補上備援值並提醒改用真實匯率。
async function ensureRates() {
  const existing = await prisma.currency.findMany();
  if (existing.length > 0) {
    return new Map(existing.map((c) => [c.code, c.rateToTwd]));
  }

  const fetchedAt = new Date();
  await prisma.currency.createMany({
    data: SUPPORTED_CURRENCIES.map((code) => ({
      code,
      rateToTwd: FALLBACK_RATES[code],
      source: 'seed-fallback', // 一眼分辨得出這不是匯率 API 拿的真實值
      fetchedAt,
    })),
  });

  console.warn('⚠️  Currency 表是空的，已寫入 seed 備援匯率（僅供 Demo，非真實匯率）');
  console.warn('   要換成真實匯率請執行：npm run currency:once');

  return new Map(SUPPORTED_CURRENCIES.map((code) => [code, FALLBACK_RATES[code]]));
}

// 換算規則與 apps/api 的 convertToTwd 一致（四捨五入到整數台幣、擋掉非正值）。
// 刻意不 import 那支：packages/db 去依賴 apps/api 是反向依賴，會讓資料層綁死在應用層上。
function toTwd(price, currency, rates) {
  if (currency === BASE_CURRENCY) return price;
  const rate = rates.get(currency);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  const raw = price * rate;
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
}

async function main() {
  console.log('🌱 開始 seed...');

  const rates = await ensureRates();

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
          // 真實的外部來源，讓詳情頁的「TCGPlayer 市場價」線有東西可畫。
          // 歷史不由 seed 灌（見下方迴圈的 filter）－ 灌假的美金歷史會跟圖上
          // 真實的市場行情線互相矛盾，這條的資料交給 job:once 實際抓取。
          {
            type: 'crawler',
            provider: 'tcgplayer',
            externalId: '610969',
            currency: 'USD',
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

  console.log('✅ 建立 5 張卡牌（含 1 張高價、1 張尚未抓價、1 張已停用追蹤）');

  // ── 歷史快照（為前 3 張卡的每個來源各灌 90 天，形成可比較的多條趨勢線）──
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HISTORY_DAYS = 90; // 要讓前台 7／30／90 三個區間各自有差異，最長區間就得有資料

  // 隨機漫步 + 均值回歸。三個要素缺一不可：
  //  ① 從前一天的價格出發（每天獨立取亂數的話，90 天會是一團雜訊，看不出「趨勢」）
  //  ② 每步往自己的基準價拉回一點，否則長期漂移會讓各來源的價差被抹平 —
  //     沒有均值回歸時實測兩個來源會纏在一起，失去「比較不同來源」的意義
  //  ③ 硬夾在 ±25% 內，防止極端連續亂數把線拉到荒謬的位置
  function walk(prev, base) {
    const reversion = (base - prev) * 0.05;
    const noise = prev * (Math.random() - 0.5) * 0.05;
    return Math.round(Math.min(base * 1.25, Math.max(base * 0.75, prev + reversion + noise)));
  }

  const seedSnapshots = [
    { card: pikachu, base: 12000 },
    { card: charizard, base: 3500 },
    { card: charizardHigh, base: 85000 },
  ];

  const snapshotRows = [];
  for (const { card, base } of seedSnapshots) {
    // tcgplayer 的資料交給 job:once 實際抓取。灌假的美金歷史會跟前台圖上
    // 真實的「TCGPlayer 市場價」線互相矛盾。
    const sources = card.sources.filter((s) => s.provider !== 'tcgplayer');
    let summary = null;

    sources.forEach((source, idx) => {
      // 不同平台本來就有價差。若各來源共用同一個基準價，多條線會疊在一起，
      // 使用者根本看不出「比較不同來源」的意義。
      const sourceBase = base * (1 + idx * 0.18);
      let price = sourceBase;

      for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
        price = walk(price, sourceBase);
        snapshotRows.push({
          cardId: card.id,
          sourceId: source.id,
          provider: source.provider,
          price,
          currency: source.currency,
          priceTwd: toTwd(price, source.currency, rates),
          rawText: source.currency === 'JPY' ? `¥${price.toLocaleString()}` : `${source.currency} ${price.toLocaleString()}`,
          fetchedAt: new Date(Date.now() - i * DAY_MS),
        });
        // 卡牌摘要取第一個來源的最新價，行為與改動前一致
        if (idx === 0 && i === 0) {
          summary = { price, currency: source.currency, priceTwd: toTwd(price, source.currency, rates) };
        }
      }
    });

    if (summary) {
      await prisma.card.update({
        where: { id: card.id },
        data: {
          latestPrice: summary.price,
          latestCurrency: summary.currency,
          latestPriceTwd: summary.priceTwd,
          lastFetchedAt: new Date(),
        },
      });
    }
  }

  // 逐筆 create 在 90 天 × 多來源的量級下會有數百次來回，改用一次寫入
  await prisma.priceSnapshot.createMany({ data: snapshotRows });
  console.log(`✅ 建立 ${snapshotRows.length} 筆歷史價格快照（${HISTORY_DAYS} 天 × 多來源）`);

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
