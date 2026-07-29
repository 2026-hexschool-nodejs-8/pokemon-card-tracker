import { prisma } from '@pct/db';
import { notFound, conflict } from '../lib/httpError.js';

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

// 7 / 30 天漲跌幅
export async function getCardPriceSummary(id) {
  await getCardById(id);
  const now = new Date();
  const day7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const day30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const latest = await prisma.priceSnapshot.findFirst({ where: { cardId: id }, orderBy: { fetchedAt: 'desc' } });

  // 同一張卡可能綁多個不同幣別的來源，只拿跟 latest 同幣別的歷史快照比較，
  // 避免拿不同幣別的 price 直接相減算出沒意義的漲跌幅。
  // TODO(#23 priceTwd 換算合併後)：改成直接比較 priceTwd，就不用管幣別是否一致。
  const [price7dAgo, price30dAgo] = latest
    ? await Promise.all([
        prisma.priceSnapshot.findFirst({
          where: { cardId: id, currency: latest.currency, fetchedAt: { lte: day7 } },
          orderBy: { fetchedAt: 'desc' },
        }),
        prisma.priceSnapshot.findFirst({
          where: { cardId: id, currency: latest.currency, fetchedAt: { lte: day30 } },
          orderBy: { fetchedAt: 'desc' },
        }),
      ])
    : [null, null];

  const calcChange = (current, past) => {
    if (!current || !past || past.price === 0) return null;
    const diff = current.price - past.price;
    return { diff, pct: Math.round((diff / past.price) * 10000) / 100 };
  };

  return {
    latestPrice: latest?.price ?? null,
    latestCurrency: latest?.currency ?? null,
    fetchedAt: latest?.fetchedAt ?? null,
    change7d: calcChange(latest, price7dAgo),
    change30d: calcChange(latest, price30dAgo),
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
