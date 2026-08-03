import axios from 'axios';
import { prisma } from '@pct/db';
import { notFound, conflict } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;

// 前台列表：支援 keyword（卡名/卡號）、language、grade（condition）
export async function listCards({ keyword, language, grade } = {}) {
  return prisma.card.findMany({
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
}

// 後台列表（cursor 分頁，供無限滾動）：沿用 keyword/language/grade/isActive 篩選，
// 加 cursor（上一批最後一張卡 id）+ limit（預設 20、上限 50）。
//
// orderBy 以 createdAt desc 為主、id desc 為次鍵（createdAt 可能同毫秒重複，補 id 作穩定次鍵）。
// 排序鍵刻意「不」用 updatedAt：Prisma 的 cursor 是拿該筆的當前值去定位，而本頁的開關操作
// 與抓價 job 都會改寫 updatedAt，被改的卡會跳到排序最前 → 游標定位錯位 → 後續批次重複或遺漏。
// createdAt 建立後不再變動，往前掃描的分頁才不會漏掉「跳到掃描位置前面」的資料。
// limit 預設 20：route 端有 Zod .default(20) 把關，但 service 是 export 的，
// 直接呼叫時沒有預設值會變成 take: undefined（撈全表）且 nextCursor 恆為 null
export async function adminListCards({
  keyword,
  language,
  grade,
  isActive,
  cursor,
  limit = 20,
} = {}) {
  const cards = await prisma.card.findMany({
    where: {
      ...(isActive !== undefined ? { isActive } : {}),
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
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { _count: { select: { sources: true } } },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  // 拿滿一批（length === limit）代表可能還有下一批 → 回最後一張卡 id 當游標；否則已到底
  const nextCursor = cards.length === limit ? cards[cards.length - 1].id : null;
  return { data: cards, nextCursor };
}

// 交易連動：關閉「最後一個啟用來源」→ 同一交易內同時停用來源與其所屬卡片（FR-015/FR-016）。
// 先防呆守衛（該來源須為其卡片唯一啟用來源），不成立則整筆不變更並丟 409（FR-016）。
// 任一步失敗整筆 rollback。client 參數預設 prisma，僅供測試注入（模擬 rollback）。
export async function deactivateLastSource(sourceId, client = prisma) {
  return client.$transaction(async (tx) => {
    const source = await tx.priceSource.findUnique({ where: { id: sourceId } });
    if (!source) throw notFound('找不到這個來源');

    // 防呆守衛：計數該卡 isActive=true 的來源，僅當此來源為唯一啟用來源才續行
    const activeCount = await tx.priceSource.count({
      where: { cardId: source.cardId, isActive: true },
    });
    if (!source.isActive || activeCount !== 1) {
      throw conflict('此來源並非該卡片最後一個啟用中來源，請重新整理後再試');
    }

    const updatedSource = await tx.priceSource.update({
      where: { id: source.id },
      data: { isActive: false },
    });
    const updatedCard = await tx.card.update({
      where: { id: source.cardId },
      data: { isActive: false },
    });
    return { source: updatedSource, card: updatedCard };
  });
}

// 一般來源編輯（PATCH /admin/sources/:id）。若這次要關掉的正好是該卡「最後一個啟用來源」，
// 擋下來回 409——那條路徑必須走 deactivateLastSource 才會連動停用卡片。
//
// 前端是用「展開時抓的來源快取」判斷是不是最後一個，而快取不會重抓；快取過期時就會誤走這條路，
// 讓卡片停在「追蹤中但沒有任何啟用來源」的不一致狀態（抓價 job 撈不到來源，價格從此不再更新）。
// 這裡不要求前端做任何補救，擋住即可——重新整理或重進頁面就會拿到最新狀態。
export async function updateSource(sourceId, data) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.priceSource.findUnique({ where: { id: sourceId } });
    if (!source) throw notFound('找不到這個來源');

    if (source.isActive && data.isActive === false) {
      const activeCount = await tx.priceSource.count({
        where: { cardId: source.cardId, isActive: true },
      });
      if (activeCount === 1) {
        throw conflict('這是該卡片最後一個啟用中來源，關閉它會連動停用卡片，請重新整理後再操作');
      }
    }

    return tx.priceSource.update({ where: { id: sourceId }, data });
  });
}

export async function getCardById(id) {
  const card = await prisma.card.findUnique({
    where: { id, isActive: true },
    include: { sources: { where: { isActive: true } } },
  });
  if (!card) throw notFound('找不到這張卡牌');
  return card;
}

const INFINITE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Origin': 'https://www.tcgplayer.com',
  'Referer': 'https://www.tcgplayer.com/',
};

export async function getTcgplayerPriceHistory(id, range = 'quarter') {
  const card = await getCardById(id);
  const src = card.sources?.find((s) => s.provider === 'tcgplayer');
  if (!src?.externalId) return null;

  // 外部 API 失敗／逾時不應該讓這個端點整個 500：歷史圖表本來就是錦上添花的資訊，
  // 這裡的語意跟「找不到來源」一致 － 都回傳 null，前端已經會處理沒有資料的情況
  let data;
  try {
    ({ data } = await axios.get(
      `https://infinite-api.tcgplayer.com/price/history/${src.externalId}/detailed?range=${range}`,
      { headers: INFINITE_HEADERS, timeout: FETCH_TIMEOUT_MS },
    ));
  } catch (err) {
    logger.warn(`tcgplayer 歷史價格取得失敗（cardId=${id}）：${err.message}`);
    return null;
  }

  const nm = data.result?.find(
    (r) => r.condition === 'Near Mint' && r.variant === 'Normal' && r.language === 'English',
  );
  return nm ?? data.result?.[0] ?? null;
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
  const [change7d, change30d] = latest?.priceTwd
    ? await Promise.all([calcChange(id, latest, 7, now), calcChange(id, latest, 30, now)])
    : [null, null];

  return {
    latestPrice: latest?.price ?? null,
    latestCurrency: latest?.currency ?? null,
    latestPriceTwd: latest?.priceTwd ?? null,
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
