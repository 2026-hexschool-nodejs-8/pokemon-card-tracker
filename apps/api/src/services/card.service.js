import axios from 'axios';
import { Prisma, prisma } from '@pct/db';
import { notFound, conflict } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';
import { convertToTwd } from '../lib/convertToTwd.js';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;
const AVERAGE_PRICE_MAX_AGE_DAYS = Number(process.env.AVERAGE_PRICE_MAX_AGE_DAYS) || 90;

// 前台列表：支援 keyword（卡名/卡號）、language、grade（condition）
export async function listCards({ keyword, language, grade } = {}) {
  const cards = await prisma.card.findMany({
    where: {
      isActive: true,
      ...(language ? { language } : {}),
      // grade 比照 keyword 用 contains + 大小寫不敏感：完全相等比對會讓使用者打到一半就看到「查無資料」，
      // 而且 condition 的大小寫在資料面沒有統一（raw / PSA10），相等比對連打完整都可能落空
      ...(grade ? { condition: { contains: grade, mode: 'insensitive' } } : {}),
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

  // 列表 API 回傳前，幫每張卡補上查詢時計算出的各來源最新價與多來源平均價。
  // 這樣前端讀取 /cards 時，可直接取得 latestSourcePrices、averagePriceTwd 與 averagePriceSourceCount。
  return attachPriceSummaries(cards);
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
      // grade 比照 keyword 用 contains + 大小寫不敏感：完全相等比對會讓使用者打到一半就看到「查無資料」，
      // 而且 condition 的大小寫在資料面沒有統一（raw / PSA10），相等比對連打完整都可能落空
      ...(grade ? { condition: { contains: grade, mode: 'insensitive' } } : {}),
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
      // 併發防護（write skew）：兩個請求各關掉同一張卡剩下的兩個來源時，改的是不同 row、
      // DB 層沒有寫入衝突，兩邊的 count() 會各自讀到 2 而雙雙放行。這裡先鎖住 Card 那一列，
      // 拿它當「這張卡的來源集合」的代表——目的不是要改 Card，純粹是製造一個共同的排隊點。
      // 依賴 READ COMMITTED：等到鎖之後，下一個 statement 才會重新取快照讀到新的 count；
      // 隔離等級若改成 REPEATABLE READ 以上，count() 會沿用交易開頭的舊快照，這個防護會無聲失效。
      await tx.$queryRaw`SELECT id FROM "Card" WHERE id = ${source.cardId} FOR UPDATE`;
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
  // 詳情 API 回傳前，幫單張卡補上查詢時計算出的各來源最新價與多來源平均價。
  // 這樣前端讀取 /cards/:id 時，可直接取得 latestSourcePrices、averagePriceTwd 與 averagePriceSourceCount。
  return attachPriceSummary(card);
}

// 多來源平均價：不寫入 Card 欄位，改在查詢卡牌時即時計算給前端顯示。
// 計算規則：每個啟用來源只取最新一筆有效台幣價，排除可疑價格與換算失敗資料。
// 沒有任何有效來源價格時，統一回傳前端可判斷的空平均價摘要。
function buildEmptyAveragePriceSummary() {
  return {
    averagePriceTwd: null,
    averagePriceSourceCount: 0,
    averagePriceMaxAgeDays: AVERAGE_PRICE_MAX_AGE_DAYS,
    latestSourcePrices: [],
  };
}

// 整理前端需要顯示的各來源最新價格欄位。
function serializeLatestSourcePrice(snapshot, oldestAllowedFetchedAt) {
  return {
    sourceId: snapshot.sourceId,
    provider: snapshot.provider,
    price: snapshot.price,
    currency: snapshot.currency,
    priceTwd: snapshot.priceTwd,
    rawText: snapshot.rawText,
    fetchedAt: snapshot.fetchedAt,
    // 過期價格仍提供前端顯示，但不會參與平均價計算。
    isStale: new Date(snapshot.fetchedAt) < oldestAllowedFetchedAt,
  };
}

// 保留各來源最新價格，但平均價只採用期限內的近期快照。
function summarizePriceSnapshots(snapshots, oldestAllowedFetchedAt) {
  const latestSnapshotBySource = new Map();
  for (const snapshot of snapshots) {
    if (!latestSnapshotBySource.has(snapshot.sourceId)) {
      latestSnapshotBySource.set(snapshot.sourceId, snapshot);
    }
  }

  const latestSourcePrices = [...latestSnapshotBySource.values()].map((snapshot) =>
    serializeLatestSourcePrice(snapshot, oldestAllowedFetchedAt),
  );
  const prices = latestSourcePrices
    .filter((snapshot) => !snapshot.isStale)
    .map((snapshot) => snapshot.priceTwd)
    .filter(Number.isFinite);
  if (prices.length === 0) {
    return { ...buildEmptyAveragePriceSummary(), latestSourcePrices };
  }

  const average = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  return {
    // API 直接回傳整數台幣平均價，前端只負責格式化顯示。
    averagePriceTwd: Math.round(average),
    averagePriceSourceCount: prices.length,
    averagePriceMaxAgeDays: AVERAGE_PRICE_MAX_AGE_DAYS,
    latestSourcePrices,
  };
}

// 批次載入有效快照，避免列表頁為每張卡各查一次資料庫。
async function getPriceSummaries(cardIds) {
  const uniqueCardIds = [...new Set(cardIds)].filter(Boolean);
  if (uniqueCardIds.length === 0) return new Map();
  const oldestAllowedFetchedAt = new Date(Date.now() - AVERAGE_PRICE_MAX_AGE_DAYS * DAY_MS);

  // 每個來源都保留最後一筆有效價格供前端顯示；是否納入平均價會在摘要階段依期限判斷。
  const snapshots = await prisma.$queryRaw`
    SELECT "cardId", "sourceId", "provider", "price", "currency", "priceTwd", "rawText", "fetchedAt"
    FROM (
      SELECT
        ps."cardId",
        ps."sourceId",
        ps."provider",
        ps."price",
        ps."currency",
        ps."priceTwd",
        ps."rawText",
        ps."fetchedAt",
        ROW_NUMBER() OVER (
          PARTITION BY ps."cardId", ps."sourceId"
          ORDER BY ps."fetchedAt" DESC, ps."createdAt" DESC, ps."id" DESC
        ) AS rn
      FROM "PriceSnapshot" ps
      INNER JOIN "PriceSource" src ON src."id" = ps."sourceId"
      WHERE ps."cardId" IN (${Prisma.join(uniqueCardIds)})
        AND ps."priceTwd" IS NOT NULL
        AND ps."isSuspicious" = false
        AND src."isActive" = true
    ) ranked
    WHERE rn = 1
    ORDER BY "cardId" ASC, "sourceId" ASC
  `;

  const snapshotsByCardId = new Map();
  for (const snapshot of snapshots) {
    const list = snapshotsByCardId.get(snapshot.cardId) ?? [];
    list.push(snapshot);
    snapshotsByCardId.set(snapshot.cardId, list);
  }

  return new Map(
    uniqueCardIds.map((cardId) => [
      cardId,
      summarizePriceSnapshots(snapshotsByCardId.get(cardId) ?? [], oldestAllowedFetchedAt),
    ]),
  );
}

// 單張卡價格摘要查詢：沿用批次查詢邏輯，保持列表與詳情頁計算規則一致。
async function getPriceSummary(cardId) {
  const summaries = await getPriceSummaries([cardId]);
  return summaries.get(cardId) ?? buildEmptyAveragePriceSummary();
}

// 將價格摘要附加到每張卡，提供 /cards API 回傳給前端使用。
async function attachPriceSummaries(cards) {
  const summaries = await getPriceSummaries(cards.map((card) => card.id));
  return cards.map((card) => ({
    ...card,
    ...(summaries.get(card.id) ?? buildEmptyAveragePriceSummary()),
  }));
}

// 將價格摘要附加到單張卡，提供 /cards/:id API 回傳給前端使用。
async function attachPriceSummary(card) {
  return {
    ...card,
    ...(await getPriceSummary(card.id)),
  };
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
  const result = nm ?? data.result?.[0] ?? null;
  if (!result) return null;

  return { ...result, buckets: await withTwdPrices(result.buckets, id) };
}

// marketPrice 是美金字串（如 '18.11'）。前台要把它跟台幣線畫在同一條縱軸上就必須換算，
// 而匯率只存在於後端的 Currency 表 － 這是本功能唯一需要動到後端的原因。
// 換算失敗一律回 null 而非 throw：外部行情是輔助資訊，不該讓整個端點失敗。
async function withTwdPrices(buckets, cardId) {
  if (!Array.isArray(buckets) || buckets.length === 0) return buckets ?? [];

  const usd = await prisma.currency.findUnique({ where: { code: 'USD' } });
  if (!usd) {
    // 訊息只進後端 log，不回傳前台 － 訪客對匯率缺漏無從處置，也不該看到內部細節
    logger.warn(`找不到 USD 匯率，TCGPlayer 市場價無法換算成台幣（cardId=${cardId}）`);
    return buckets.map((b) => ({ ...b, marketPriceTwd: null }));
  }

  const rates = new Map([['USD', usd.rateToTwd]]);
  return buckets.map((b) => {
    // convertToTwd 已擋掉 <= 0 與非有限值，marketPrice 為 '0' 的 bucket 自然得到 null
    const { priceTwd } = convertToTwd(Number.parseFloat(b.marketPrice), 'USD', rates);
    return { ...b, marketPriceTwd: priceTwd };
  });
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
// 一般呼叫時要先確認卡牌存在，避免查不存在或已停用卡牌的價格。
// CSV 匯出 route 已經先查過 card 來組檔名和欄位，所以可傳 skipCardCheck 避免同一個 request 查兩次 card。
export async function getCardPrices(id, { from, to, source } = {}, { skipCardCheck = false } = {}) {
  if (!skipCardCheck) await getCardById(id);
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
