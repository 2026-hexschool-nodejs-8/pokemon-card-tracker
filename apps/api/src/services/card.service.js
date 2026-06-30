import axios from 'axios';
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
    where: { id },
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

  const { data } = await axios.get(
    `https://infinite-api.tcgplayer.com/price/history/${src.externalId}/detailed?range=${range}`,
    { headers: INFINITE_HEADERS },
  );

  const nm = data.result?.find(
    (r) => r.condition === 'Near Mint' && r.variant === 'Normal' && r.language === 'English',
  );
  return nm ?? data.result?.[0] ?? null;
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
