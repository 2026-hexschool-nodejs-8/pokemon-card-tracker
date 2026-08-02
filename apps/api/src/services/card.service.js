import { prisma } from '@pct/db';
import { notFound } from '../lib/httpError.js';

// 前台列表：支援 keyword（卡名/卡號）、language、grade（condition）
export async function listCards({ keyword, language, grade } = {}) {
  const cards = await prisma.card.findMany({
    where: {
      isActive: true,
      ...(language ? { language } : {}),
      ...(grade ? { condition: grade } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { cardNumber: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: 'desc' },
  });

  // 列表 API 回傳前，幫每張卡補上查詢時計算出的多來源平均價。
  // 這樣前端讀取 /cards 時，可直接取得每張卡的 averagePriceTwd 與 averagePriceSourceCount。
  return attachAveragePriceSummaries(cards);
}

export async function getCardById(id) {
  const card = await prisma.card.findUnique({
    where: { id, isActive: true },
    include: { sources: { where: { isActive: true } } },
  });
  if (!card) throw notFound('找不到這張卡牌');
  // 詳情 API 回傳前，補上查詢時計算出的多來源平均價。
  // 這樣前端讀取 /cards/:id 時，可直接取得 averagePriceTwd 與 averagePriceSourceCount。
  return attachAveragePriceSummary(card);
}

// 多來源平均價：不寫入 Card 欄位，改在查詢卡牌時即時計算給前端顯示。
// 計算規則：每個啟用來源只取最新一筆有效台幣價，排除可疑價格與換算失敗資料。
// 沒有任何有效來源價格時，統一回傳前端可判斷的空平均價摘要。
function buildEmptyAveragePriceSummary() {
  return { averagePriceTwd: null, averagePriceSourceCount: 0 };
}

// 將同一張卡的快照整理成平均價摘要：同一來源只採用排序後遇到的第一筆最新價格。
function summarizeAveragePriceSnapshots(snapshots) {
  const latestPriceBySource = new Map();
  for (const snapshot of snapshots) {
    if (!latestPriceBySource.has(snapshot.sourceId)) {
      latestPriceBySource.set(snapshot.sourceId, snapshot.priceTwd);
    }
  }

  const prices = [...latestPriceBySource.values()].filter(Number.isFinite);
  if (prices.length === 0) return buildEmptyAveragePriceSummary();

  const average = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  return {
    averagePriceTwd: Math.round(average * 100) / 100,
    averagePriceSourceCount: prices.length,
  };
}

// 批次查詢多張卡的有效快照，避免列表頁為每張卡各查一次資料庫。
async function getAveragePriceSummaries(cardIds) {
  const uniqueCardIds = [...new Set(cardIds)].filter(Boolean);
  if (uniqueCardIds.length === 0) return new Map();

  const snapshots = await prisma.priceSnapshot.findMany({
    where: {
      cardId: { in: uniqueCardIds },
      priceTwd: { not: null },
      isSuspicious: false,
      source: { isActive: true },
    },
    orderBy: [{ cardId: 'asc' }, { sourceId: 'asc' }, { fetchedAt: 'desc' }],
  });

  const snapshotsByCardId = new Map();
  for (const snapshot of snapshots) {
    const list = snapshotsByCardId.get(snapshot.cardId) ?? [];
    list.push(snapshot);
    snapshotsByCardId.set(snapshot.cardId, list);
  }

  return new Map(
    uniqueCardIds.map((cardId) => [
      cardId,
      summarizeAveragePriceSnapshots(snapshotsByCardId.get(cardId) ?? []),
    ]),
  );
}

// 單張卡平均價查詢：沿用批次查詢邏輯，保持列表與詳情頁計算規則一致。
async function getAveragePriceSummary(cardId) {
  const summaries = await getAveragePriceSummaries([cardId]);
  return summaries.get(cardId) ?? buildEmptyAveragePriceSummary();
}

// 將平均價摘要附加到卡牌列表中的每張卡，提供 /cards API 回傳給前端使用。
async function attachAveragePriceSummaries(cards) {
  const summaries = await getAveragePriceSummaries(cards.map((card) => card.id));
  return cards.map((card) => ({
    ...card,
    ...(summaries.get(card.id) ?? buildEmptyAveragePriceSummary()),
  }));
}

// 將平均價摘要附加到單張卡，提供 /cards/:id API 回傳給前端使用。
async function attachAveragePriceSummary(card) {
  return {
    ...card,
    ...(await getAveragePriceSummary(card.id)),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 基準點允許偏離目標日期幾天。抓價排程是每天一次（PRICE_SYNC_CRON 預設 "0 2 * * *"），
// 正常情況下第 N 天前一定有快照，這個容許值只是讓「連續幾天抓價失敗」不至於整個算不出來。
// 放太寬會讓 13 天前的價格被當成「近 7 日」基準，失去這個功能的意義。
const BASIS_TOLERANCE_DAYS = 2;

// 算單一窗口的漲跌幅（一律用台幣 priceTwd，跨幣別的快照才能相減）。
// 基準點的挑選規則：
//  ① 至少要 days 天前，否則不能叫「近 N 日」
//  ② 但最多只能再往前 BASIS_TOLERANCE_DAYS 天：避免拿更舊的價格充當基準，
//     也避免 7 日與 30 日撈到同一筆而顯示相同數字
//  ③ latest 必須落在窗口內，否則代表這段期間根本沒抓到價 → 回 null。
//     少了這關，排程停擺時 latest 會同時被選為基準，算出 0% 讓「沒資料」看起來像「持平」
//  ④ 只挑有台幣價的快照：priceTwd 上線前的舊資料是 null，算不出漲跌
async function calcChange(cardId, latest, days, now) {
  const newestAllowed = new Date(now - days * DAY_MS);
  const oldestAllowed = new Date(now - (days + BASIS_TOLERANCE_DAYS) * DAY_MS);

  if (latest.fetchedAt <= newestAllowed) return null;

  const basis = await prisma.priceSnapshot.findFirst({
    where: {
      cardId,
      priceTwd: { not: null },
      fetchedAt: { lte: newestAllowed, gte: oldestAllowed },
    },
    orderBy: { fetchedAt: 'desc' },
  });
  // 基準價為 0 會除以 0，用 falsy 一起擋掉
  if (!basis?.priceTwd) return null;

  const diffTwd = latest.priceTwd - basis.priceTwd;
  return {
    diffTwd,
    pct: Math.round((diffTwd / basis.priceTwd) * 10000) / 100,
    basisFetchedAt: basis.fetchedAt,
  };
}

// 7 / 30 天漲跌幅
export async function getCardPriceSummary(id) {
  await getCardById(id);
  const now = new Date();

  const latest = await prisma.priceSnapshot.findFirst({
    where: { cardId: id },
    orderBy: { fetchedAt: 'desc' },
  });

  // 最新這筆沒有有效台幣價就無從比起，直接不查。
  // 用 falsy 判斷連 0 一起擋：convertToTwd 會 Math.round，極小的原幣價可能被四捨五入成 0，
  // 讓 0 當分子會算出 -100% 的假跌幅
  // 多來源平均價與漲跌幅一起回傳給前端
  const [change7d, change30d, averagePriceSummary] = latest?.priceTwd
    ? await Promise.all([
        calcChange(id, latest, 7, now),
        calcChange(id, latest, 30, now),
        getAveragePriceSummary(id),
      ])
    : [null, null, await getAveragePriceSummary(id)];

  return {
    latestPrice: latest?.price ?? null,
    latestCurrency: latest?.currency ?? null,
    latestPriceTwd: latest?.priceTwd ?? null,
    averagePriceTwd: averagePriceSummary.averagePriceTwd,
    averagePriceSourceCount: averagePriceSummary.averagePriceSourceCount,
    fetchedAt: latest?.fetchedAt ?? null,
    change7d,
    change30d,
  };
}

// 歷史價格：可用 from / to / source 篩選
export async function getCardPrices(id, { from, to, source } = {}) {
  await getCardById(id); // 確認卡牌存在
  return prisma.priceSnapshot.findMany({
    where: {
      cardId: id,
      ...(source ? { provider: source } : {}),
      ...(from || to
        ? {
            fetchedAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { fetchedAt: 'asc' },
  });
}
