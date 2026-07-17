import { prisma } from '@pct/db';
import { notFound } from '../lib/httpError.js';

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
