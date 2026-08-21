// Seed 資料 － DEMO 備援（demo 卡牌 / 價格 / job / 匯率，不含 Admin）
// 執行：npm run db:seed（從根目錄）
// 註：Admin 已獨立成 seedAdmin.js（本專案無註冊功能），此腳本不建也不刪 Admin。
// 主角卡（6 張）的設計說明見 docs/seed_data_plan.md；
// 批次卡（25 張）純粹是給後台總覽頁的無限滾動 / 篩選 / 空狀態湊資料量。
import '@pct/shared/load-env';
import { SUPPORTED_CURRENCIES, BASE_CURRENCY } from '@pct/shared';
import { prisma } from '../index.js';

// ── 固定匯率（同一份用於快照 priceTwd、卡片 latestPriceTwd、Currency upsert）──
const RATES = Object.freeze({
  TWD: 1,
  JPY: 0.22,
  USD: 32.0,
  HKD: 4.1,
  EUR: 34.5,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const CRON_HOUR = 2; // 對齊 PRICE_SYNC_CRON 預設 "0 2 * * *"

// 與 mockApi / mockCrawler 相同的雜湊（啟用來源價位必須對齊，live 抓價才不會跳價）
function apiBase(seed = '') {
  return 2000 + ([...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 20) * 500;
}
function crawlerBase(seed = '') {
  return 3000 + ([...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % 30) * 1000;
}

/** 找讓雜湊剛好等於 target 的字串（prefix + 數字後綴） */
function findAligned(fn, target, prefix) {
  for (let i = 0; i < 100_000; i++) {
    const s = `${prefix}${i}`;
    if (fn(s) === target) return s;
  }
  throw new Error(`找不到對齊 ${target} 的字串（prefix=${prefix}）`);
}

function toTwd(price, currency) {
  const rate = RATES[currency];
  if (typeof rate !== 'number') throw new Error(`未知幣別：${currency}`);
  return Math.round(price * rate);
}

function rawTextOf(price, currency, type) {
  if (type === 'api') return String(price);
  const symbols = { JPY: '¥', USD: '$', HKD: 'HK$', EUR: '€', TWD: 'NT$' };
  const sym = symbols[currency] ?? '';
  return `${sym}${price.toLocaleString('en-US')}`;
}

/** 當天（或 N 天前）02:00 本地時間 */
function atCronHour(daysAgo) {
  const d = new Date();
  d.setHours(CRON_HOUR, 0, 0, 0);
  d.setTime(d.getTime() - daysAgo * DAY_MS);
  return d;
}

/**
 * 產生固定漲跌係數序列（不用 Math.random）。
 * startFactor → endFactor 線性插值，天數 = days（含今天 = daysAgo 0）。
 * 回傳 Map<daysAgo, factor>
 */
function buildFactors(days, startFactor, endFactor) {
  const map = new Map();
  for (let i = 0; i < days; i++) {
    const daysAgo = days - 1 - i; // 最舊 → 今天
    const t = days === 1 ? 1 : i / (days - 1);
    map.set(daysAgo, startFactor + (endFactor - startFactor) * t);
  }
  return map;
}

function priceAt(base, factor) {
  return Math.round(base * factor);
}

async function main() {
  console.log('🌱 開始 seed...');

  // ── 清空 demo 資料（方便重複執行）；Admin / Currency 不動（Currency 用 upsert）──
  await prisma.priceFetchLog.deleteMany();
  await prisma.priceFetchJob.deleteMany();
  await prisma.priceSnapshot.deleteMany();
  await prisma.priceSource.deleteMany();
  await prisma.card.deleteMany();

  // ── 匯率：只補不覆蓋 ──
  const rateFetchedAt = atCronHour(0);
  for (const [code, rateToTwd] of Object.entries(RATES)) {
    await prisma.currency.upsert({
      where: { code },
      create: { code, rateToTwd, source: 'seed', fetchedAt: rateFetchedAt },
      update: {}, // 環境上已有真實匯率就不覆蓋
    });
  }
  console.log('✅ 匯率（TWD/JPY/USD/HKD/EUR）upsert 完成（只補不覆蓋）');

  // ── 對齊 mock 雜湊的 url / externalId ──
  const urlJp = findAligned(crawlerBase, 28000, 'https://example.com/cards/charizard-vmax-');
  const urlJp2 = findAligned(crawlerBase, 30000, 'https://example.com/cards/charizard-vmax-b-');
  const idTw = findAligned(apiBase, 4000, 'miraidon-ex-');
  const idJp = findAligned(apiBase, 4500, 'hitokage-');
  const idJp2 = findAligned(apiBase, 4500, 'fushigibana-ex-');

  // 驗證對齊
  for (const [label, fn, seed, expected] of [
    ['demoShopJp', crawlerBase, urlJp, 28000],
    ['demoShopJp2', crawlerBase, urlJp2, 30000],
    ['demoApiTw', apiBase, idTw, 4000],
    ['demoApiJp', apiBase, idJp, 4500],
    ['demoApiJp2', apiBase, idJp2, 4500],
  ]) {
    if (fn(seed) !== expected) throw new Error(`${label} 對齊失敗：${fn(seed)} !== ${expected}`);
  }

  const today0200 = atCronHour(0);
  const eightDaysAgo = atCronHour(8);

  // ── 卡1：リザードン VMAX（高價 / 上漲 / 35 天 / 多來源雙啟用）──
  const card1 = await prisma.card.create({
    data: {
      name: 'リザードン VMAX (SSR)',
      cardNumber: '308/S-P',
      setName: 'Shiny Star V',
      language: 'ja',
      condition: 'PSA10',
      imageUrl: 'https://placehold.co/240x336?text=Charizard+VMAX',
      sources: {
        create: [
          {
            type: 'crawler',
            provider: 'demoShopJp',
            url: urlJp,
            currency: 'JPY',
            isActive: true,
            lastSuccessAt: today0200,
          },
          {
            type: 'crawler',
            provider: 'demoShopJp2',
            url: urlJp2,
            currency: 'JPY',
            isActive: true,
            lastSuccessAt: today0200,
          },
        ],
      },
    },
    include: { sources: true },
  });
  const src1Jp = card1.sources.find((s) => s.provider === 'demoShopJp');
  const src1Jp2 = card1.sources.find((s) => s.provider === 'demoShopJp2');

  // ── 卡2：ミライドン ex（sv 稀有 / 下跌 / 21 天 / 多來源一條中斷）──
  const card2 = await prisma.card.create({
    data: {
      name: 'ミライドン ex',
      cardNumber: '106/SV4a',
      setName: 'SV4a 黑炎的支配者',
      language: 'zh',
      condition: 'raw',
      imageUrl: 'https://placehold.co/240x336?text=Miraidon+ex',
      sources: {
        create: [
          {
            type: 'api',
            provider: 'demoApiTw',
            externalId: idTw,
            currency: 'TWD',
            isActive: true,
            lastSuccessAt: today0200,
          },
          {
            type: 'crawler',
            provider: 'demoShopHk',
            url: 'https://example.com/cards/miraidon-hk',
            currency: 'HKD',
            isActive: false,
            lastSuccessAt: eightDaysAgo,
          },
        ],
      },
    },
    include: { sources: true },
  });
  const src2Tw = card2.sources.find((s) => s.provider === 'demoApiTw');
  const src2Hk = card2.sources.find((s) => s.provider === 'demoShopHk');

  // ── 卡3：ピカチュウ V（持平 / 14 天 / 停用 USD 來源）──
  const card3 = await prisma.card.create({
    data: {
      name: 'ピカチュウ V',
      cardNumber: '208/XY-P',
      setName: 'XY Promo',
      language: 'en',
      condition: 'PSA9',
      imageUrl: 'https://placehold.co/240x336?text=Pikachu+V',
      sources: {
        create: [
          {
            type: 'crawler',
            provider: 'demoShopUs',
            url: 'https://example.com/cards/pikachu-v-us',
            currency: 'USD',
            isActive: false,
            lastSuccessAt: today0200,
          },
        ],
      },
    },
    include: { sources: true },
  });
  const src3Us = card3.sources[0];

  // ── 卡4：コイキング（不足 7 天）──
  const card4 = await prisma.card.create({
    data: {
      name: 'コイキング',
      cardNumber: '004/BS',
      setName: 'Base Set',
      language: 'ja',
      condition: 'raw',
      imageUrl: 'https://placehold.co/240x336?text=Hitokage',
      sources: {
        create: [
          {
            type: 'api',
            provider: 'demoApiJp',
            externalId: idJp,
            currency: 'JPY',
            isActive: true,
            lastSuccessAt: today0200,
          },
        ],
      },
    },
    include: { sources: true },
  });
  const src4Jp = card4.sources[0];

  // ── 卡5：ミュウツー GX（尚未抓價 / 無圖 / fail 來源 / EUR）──
  const card5 = await prisma.card.create({
    data: {
      name: 'ミュウツー GX',
      cardNumber: '150/SM-P',
      setName: 'Sun & Moon',
      language: 'ja',
      condition: 'raw',
      // 無 imageUrl → 列表佔位圖
      sources: {
        create: [
          {
            type: 'crawler',
            provider: 'demoShopEu',
            url: 'https://example.com/cards/mewtwo-gx-fail',
            currency: 'EUR',
            isActive: true,
            lastSuccessAt: null,
            lastError: 'mock crawler 找不到價格 selector（頁面可能改版）',
          },
        ],
      },
    },
    include: { sources: true },
  });
  const src5Eu = card5.sources[0];

  // ── 卡6：フシギバナ EX（關閉追蹤，保留歷史）──
  const card6 = await prisma.card.create({
    data: {
      name: 'フシギバナ EX',
      cardNumber: '003/EX-P',
      setName: 'EX Series',
      language: 'en',
      condition: 'raw',
      isActive: false,
      imageUrl: 'https://placehold.co/240x336?text=Venusaur+EX',
      sources: {
        create: [
          {
            type: 'api',
            provider: 'demoApiJp2',
            externalId: idJp2,
            currency: 'JPY',
            isActive: true,
            lastSuccessAt: atCronHour(1), // 停用前最後成功
          },
        ],
      },
    },
    include: { sources: true },
  });
  const src6Jp = card6.sources[0];

  console.log('✅ 建立 6 張主角卡牌、8 個來源');

  // ── 批次卡牌 ──
  // 後台總覽頁每批載入 20 張，卡片總數要超過 20 才看得到「捲到底接續載入第二批」。
  // 這裡補 25 張湊到 31 張，並讓語言 / 狀態別 / 追蹤狀態 / 來源數量都有變化，
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
  const bulkLiveSources = []; // 啟用卡上的啟用來源，給 job log 用

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
        // 後台列表按 createdAt 倒序，批次卡的建立時間往前推，主角卡才會固定留在第一批
        createdAt: new Date(Date.now() - (BULK_NAMES.length - i + 1) * DAY_MS),
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
    if (isActive) {
      for (const source of card.sources) {
        bulkLiveSources.push({
          card,
          source,
          ok: true,
          price: 500 + i * 137,
          currency: source.currency,
        });
      }
    }
    // 每 4 張留 1 張「從未抓過價」，讓摘要列的「—」空狀態有資料可看
    if (sourceCount > 0 && i % 4 !== 3) {
      pricedBulk.push({ card, source: card.sources[0], base: 500 + i * 137, index: i });
    }
  }

  console.log(
    `✅ 建立 ${BULK_NAMES.length} 張批次卡牌（共 ${bulkSourceCount} 個來源），卡牌總數 ${6 + BULK_NAMES.length} 張`,
  );

  // ── 快照序列 ──
  // 卡1：35 天，start→end 讓近 7 日 ≈ +6%、近 30 日 ≈ +18%
  //   day30 factor ≈ 1/1.18 ≈ 0.8475；day7 factor ≈ 1/1.06 ≈ 0.9434；today = 1
  //   線性：day34(最舊) → day0。用 start=0.82、end=1.0
  //   day30: 0.82 + (1-0.82)*(4/34) = 0.82 + 0.0212 = 0.8412 → +18.9%
  //   day7:  0.82 + (1-0.82)*(27/34) = 0.82 + 0.1429 = 0.9629 → +3.9%  ← 偏小
  // 改用兩段：0..30 從 0.8475→1，但我們要固定係數表。
  // 直接設：最舊(34)=0.82，day30=0.8475，day7=0.9434，today=1.0
  // 簡化：線性 0.8475 → 1.0 共 31 點（day30..day0），再往前補 4 天略低
  const factors1 = buildFactors(35, 0.82, 1.0);
  // 微調 day7 / day30 讓百分比更準：覆寫關鍵點
  factors1.set(30, 1 / 1.18); // ≈ 0.8475 → +18%
  factors1.set(7, 1 / 1.06); // ≈ 0.9434 → +6%

  // 卡2：21 天，近 7 日 -12% → day7 = 1/0.88 ≈ 1.1364，today=1；最舊略高
  const factors2 = buildFactors(21, 1.2, 1.0);
  factors2.set(7, 1 / 0.88); // ≈ 1.1364 → -12%

  // 卡3：14 天，持平 → day7 與 today 同價
  const factors3 = buildFactors(14, 1.0, 1.0);
  // 中間加一點起伏再回到 1，讓圖不是完全水平
  factors3.set(10, 1.03);
  factors3.set(5, 0.98);
  factors3.set(7, 1.0);
  factors3.set(0, 1.0);

  // 卡4：4 天，略微波動
  const factors4 = buildFactors(4, 0.97, 1.0);

  // 卡6：6 天
  const factors6 = buildFactors(6, 0.95, 1.0);

  const snapshots = [];

  function pushSeries({ card, source, base, currency, type, factors, daysAgoList, suspiciousDay }) {
    for (const daysAgo of daysAgoList) {
      let factor = factors.get(daysAgo);
      if (factor == null) continue;
      let price = priceAt(base, factor);
      let isSuspicious = false;

      // 卡1 主線第 12 天插尖刺（相對正常價 +66%）
      if (suspiciousDay != null && daysAgo === suspiciousDay) {
        price = Math.round(price * 1.66);
        isSuspicious = true;
      }

      snapshots.push({
        cardId: card.id,
        sourceId: source.id,
        provider: source.provider,
        price,
        currency,
        priceTwd: toTwd(price, currency),
        rawText: rawTextOf(price, currency, type),
        fetchedAt: atCronHour(daysAgo),
        isSuspicious,
      });
    }
  }

  const days35 = [...Array(35).keys()]; // 0..34
  const days21 = [...Array(21).keys()];
  const days14 = [...Array(14).keys()];
  const days4 = [...Array(4).keys()];
  const days6 = [...Array(6).keys()];
  // 卡2 HKD：從 20 天前到 8 天前（含）→ 13 筆
  const daysHk = [...Array(13).keys()].map((i) => 20 - i); // 20,19,...,8

  // 卡1 兩條線共用 factors1，基準價不同
  pushSeries({
    card: card1,
    source: src1Jp,
    base: 28000,
    currency: 'JPY',
    type: 'crawler',
    factors: factors1,
    daysAgoList: days35,
    suspiciousDay: 12,
  });
  pushSeries({
    card: card1,
    source: src1Jp2,
    base: 30000,
    currency: 'JPY',
    type: 'crawler',
    factors: factors1,
    daysAgoList: days35,
    // 不加 suspicious
  });

  // 卡2
  pushSeries({
    card: card2,
    source: src2Tw,
    base: 4000,
    currency: 'TWD',
    type: 'api',
    factors: factors2,
    daysAgoList: days21,
  });
  pushSeries({
    card: card2,
    source: src2Hk,
    base: 1150,
    currency: 'HKD',
    type: 'crawler',
    factors: factors2,
    daysAgoList: daysHk,
  });

  // 卡3
  pushSeries({
    card: card3,
    source: src3Us,
    base: 42,
    currency: 'USD',
    type: 'crawler',
    factors: factors3,
    daysAgoList: days14,
  });

  // 卡4
  pushSeries({
    card: card4,
    source: src4Jp,
    base: 4500,
    currency: 'JPY',
    type: 'api',
    factors: factors4,
    daysAgoList: days4,
  });

  // 卡6
  pushSeries({
    card: card6,
    source: src6Jp,
    base: 4500,
    currency: 'JPY',
    type: 'api',
    factors: factors6,
    daysAgoList: days6,
  });

  const heroSnapshotCount = snapshots.length;

  // 批次卡：目的只是讓摘要列的最新價 / 最後更新時間有值，不是畫趨勢圖，各灌 3 天就好。
  // 起始係數同樣由索引推導，重跑 seed 價格才不會變。
  for (const { card, source, base, index } of pricedBulk) {
    pushSeries({
      card,
      source,
      base,
      currency: source.currency,
      type: source.type,
      factors: buildFactors(3, 0.94 + (index % 5) * 0.02, 1.0),
      daysAgoList: [0, 1, 2],
    });
  }

  await prisma.priceSnapshot.createMany({ data: snapshots });
  console.log(
    `✅ 建立 ${snapshots.length} 筆歷史價格快照（主角卡 ${heroSnapshotCount} 筆、` +
      `批次卡 ${snapshots.length - heroSnapshotCount} 筆 / ${pricedBulk.length} 張有最新價）`,
  );

  // ── 對齊卡片摘要（取該卡最新快照；卡1 取 demoShopJp）──
  function latestOf(cardId, preferSourceId) {
    const rows = snapshots
      .filter((s) => s.cardId === cardId)
      .sort((a, b) => b.fetchedAt - a.fetchedAt);
    if (preferSourceId) {
      const preferred = rows.find((s) => s.sourceId === preferSourceId);
      if (preferred) return preferred;
    }
    return rows[0] ?? null;
  }

  async function syncCardSummary(card, preferSourceId) {
    const latest = latestOf(card.id, preferSourceId);
    if (!latest) return;
    await prisma.card.update({
      where: { id: card.id },
      data: {
        latestPrice: latest.price,
        latestCurrency: latest.currency,
        latestPriceTwd: latest.priceTwd,
        lastFetchedAt: latest.fetchedAt,
      },
    });
  }

  await syncCardSummary(card1, src1Jp.id);
  await syncCardSummary(card2, src2Tw.id);
  await syncCardSummary(card3, src3Us.id);
  await syncCardSummary(card4, src4Jp.id);
  // 卡5：無快照，摘要保持 null
  await syncCardSummary(card6, src6Jp.id);
  // 批次卡走同一條路徑，latestPriceTwd 才不會缺（前台列表以台幣為主顯示）
  for (const { card, source } of pricedBulk) {
    await syncCardSummary(card, source.id);
  }
  console.log('✅ 對齊卡片 latestPrice / latestCurrency / latestPriceTwd / lastFetchedAt');

  // ── Job 與 Log（4 筆）──
  // live = 啟用卡上的啟用來源：主角 5 + 批次 23 = 28。
  // log 筆數、totalSources、successCount / failedCount 都從同一份清單推導，避免再對不上。
  const liveSources = [
    { card: card1, source: src1Jp, ok: true, price: 28000, currency: 'JPY' },
    { card: card1, source: src1Jp2, ok: true, price: 30000, currency: 'JPY' },
    { card: card2, source: src2Tw, ok: true, price: 4000, currency: 'TWD' },
    { card: card4, source: src4Jp, ok: true, price: 4500, currency: 'JPY' },
    { card: card5, source: src5Eu, ok: false },
    ...bulkLiveSources,
  ];
  const liveOk = liveSources.filter((s) => s.ok);
  // success job 那時卡5 尚未加入
  const beforeCard5 = liveSources.filter((s) => s.source.id !== src5Eu.id);

  function successMsg({ price, currency }) {
    const twd = toTwd(price, currency);
    return `抓價成功 ${currency} ${price} ≈ TWD ${twd}`;
  }
  const failMsg = 'mock crawler 找不到價格 selector（頁面可能改版）';

  function makeLogs(entries, startedAt, stepMs, mode) {
    return entries.map((s, i) => {
      const failed = mode === 'allFailed' || (mode === 'mixed' && !s.ok);
      return {
        cardId: s.card.id,
        sourceId: s.source.id,
        status: failed ? 'failed' : 'success',
        message: failed ? (s.ok ? 'HTTP 429 rate limited' : failMsg) : successMsg(s),
        durationMs: mode === 'allFailed' ? 5000 : s.ok ? 220 + i * 30 : 4800,
        createdAt: new Date(startedAt.getTime() + (i + 1) * stepMs),
      };
    });
  }

  // 1) running（25 分鐘前，卡住）
  const runningJob = await prisma.priceFetchJob.create({
    data: {
      triggerType: 'manual',
      status: 'running',
      startedAt: new Date(Date.now() - 25 * 60_000),
      finishedAt: null,
      totalSources: liveSources.length,
      successCount: 0,
      failedCount: 0,
    },
  });

  // 2) success（cron，2 天前）
  const successStarted = atCronHour(2);
  const successFinished = new Date(successStarted.getTime() + 8_000);
  const successJob = await prisma.priceFetchJob.create({
    data: {
      triggerType: 'cron',
      status: 'success',
      startedAt: successStarted,
      finishedAt: successFinished,
      totalSources: beforeCard5.length,
      successCount: beforeCard5.length,
      failedCount: 0,
      logs: {
        create: makeLogs(beforeCard5, successStarted, 500, 'success'),
      },
    },
  });

  // 3) partial_success（cron，今天 02:00）
  const partialStarted = today0200;
  const partialFinished = new Date(partialStarted.getTime() + 12_000);
  const partialJob = await prisma.priceFetchJob.create({
    data: {
      triggerType: 'cron',
      status: 'partial_success',
      startedAt: partialStarted,
      finishedAt: partialFinished,
      totalSources: liveSources.length,
      successCount: liveOk.length,
      failedCount: liveSources.length - liveOk.length,
      logs: {
        create: makeLogs(liveSources, partialStarted, 600, 'mixed'),
      },
    },
  });

  // 4) failed（manual，昨天）
  const failedStarted = atCronHour(1);
  // 讓它跟 cron 錯開一點：昨天 14:00
  failedStarted.setHours(14, 0, 0, 0);
  const failedFinished = new Date(failedStarted.getTime() + 15_000);
  const failedJob = await prisma.priceFetchJob.create({
    data: {
      triggerType: 'manual',
      status: 'failed',
      startedAt: failedStarted,
      finishedAt: failedFinished,
      totalSources: liveSources.length,
      successCount: 0,
      failedCount: liveSources.length,
      errorMessage: '來源回傳 429 Too Many Requests',
      logs: {
        create: makeLogs(liveSources, failedStarted, 700, 'allFailed'),
      },
    },
  });

  console.log(
    `✅ 建立 4 筆 job：running=${runningJob.id.slice(-6)} (${liveSources.length} 來源), ` +
      `success=${successJob.id.slice(-6)} (${beforeCard5.length} log), ` +
      `partial=${partialJob.id.slice(-6)} (${liveSources.length} log), ` +
      `failed=${failedJob.id.slice(-6)} (${liveSources.length} log)`,
  );

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
