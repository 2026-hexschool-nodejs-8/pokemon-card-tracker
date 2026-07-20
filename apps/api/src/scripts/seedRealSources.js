// 建立「真實 crawler 來源」的示範卡牌與 PriceSource（非破壞式，可重複執行）－ 對應開發規格書階段 3
// 四個來源各自對應不同卡牌
// 執行：npm run seed:real-sources（從根目錄）
import '@pct/shared/load-env';
import { prisma } from '@pct/db';

const ENTRIES = [
  {
    card: {
      name: '超級皮可西ex',
      cardNumber: '112/080',
      setName: '虛無歸零 M3',
      language: 'zh',
      condition: 'raw',
    },
    source: {
      type: 'crawler',
      provider: 'cardLand',
      url: 'https://cardland.com.hk/product/%e8%b6%85%e7%b4%9a%e7%9a%ae%e5%8f%af%e8%a5%bfex-3/',
      currency: 'HKD',
    },
  },
  {
    card: {
      name: 'SR ヤドン＆コダックGX',
      cardNumber: '095/094',
      setName: 'ミラクルツイン',
      language: 'ja',
      condition: 'raw',
    },
    source: {
      type: 'crawler',
      provider: 'yuyutei',
      url: 'https://yuyu-tei.jp/sell/poc/card/sm11/10095',
      currency: 'JPY',
    },
  },
  {
    card: {
      name: 'Pikachu with Grey Felt Hat',
      cardNumber: '085/S-P',
      setName: 'Pokemon Promo',
      language: 'en',
      condition: 'raw',
    },
    source: {
      type: 'crawler',
      provider: 'priceCharting',
      url: 'https://www.pricecharting.com/game/pokemon-promo/pikachu-with-grey-felt-hat-85#used-prices',
      currency: 'USD',
    },
  },
  {
    card: {
      name: 'ニンフィア',
      cardNumber: '2-4-037',
      setName: 'ポケモンフレンダ',
      language: 'ja',
      condition: 'raw',
    },
    source: {
      type: 'crawler',
      provider: 'rakuten',
      url: 'https://item.rakuten.co.jp/fullahead/pmf-09-071/',
      currency: 'JPY',
    },
  },
];

async function upsertCardAndSource({ card: cardData, source: sourceData }) {
  let card = await prisma.card.findFirst({
    where: { name: cardData.name, cardNumber: cardData.cardNumber },
  });
  if (!card) {
    card = await prisma.card.create({ data: cardData });
    console.log(`建立卡牌：${card.name} ${card.cardNumber}（${card.id}）`);
  } else {
    console.log(`卡牌已存在：${card.name} ${card.cardNumber}（${card.id}）`);
  }

  const existingSource = await prisma.priceSource.findFirst({
    where: { cardId: card.id, provider: sourceData.provider },
  });
  if (existingSource) {
    console.log(`來源已存在：${sourceData.provider}（${existingSource.id}）`);
  } else {
    const createdSource = await prisma.priceSource.create({
      data: { ...sourceData, cardId: card.id },
    });
    console.log(`建立來源：${createdSource.provider}（${createdSource.type}）→ ${createdSource.id}`);
  }

  return card;
}

async function main() {
  const cards = [];
  for (const entry of ENTRIES) {
    cards.push(await upsertCardAndSource(entry));
  }

  console.log('\n接續執行逐卡抓價：');
  for (const card of cards) {
    console.log(`  npm run job:once -w @pct/api -- ${card.id}  # ${card.name}`);
  }
  console.log('\n一次執行全部抓價： npm run job:once');
}

main()
  .catch((e) => {
    console.error('建立真實來源失敗：', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
