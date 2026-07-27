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
// orderBy 以 updatedAt desc 為主、id desc 為次鍵——updatedAt 可能同毫秒重複，
// 補 id 作穩定次鍵才能保證 cursor 分頁不重複、不遺漏（research §1）。
export async function adminListCards({ keyword, language, grade, isActive, cursor, limit } = {}) {
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
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
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
