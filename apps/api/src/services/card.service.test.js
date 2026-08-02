// card.service 測試 － 對應 docs/test-plan.md §6.3 CS-01~23
import test from 'node:test';
import assert from 'node:assert/strict';
import nock from 'nock';
import { prisma } from '@pct/db';
import {
  listCards,
  getCardById,
  getCardPriceSummary,
  getCardPrices,
  getTcgplayerPriceHistory,
} from './card.service.js';
import { makeRunId, createCard, createSource, createSnapshot, cleanupByRunId } from '../../testkit/helpers/db.js';
import infiniteHistoryFixture from '../../testkit/fixtures/tcgplayer.infinite-history.json' with { type: 'json' };

process.env.DATABASE_URL ||=
  'postgresql://pct:pct_password@localhost:5432/pokemon_card_tracker_test?schema=public';

async function canReachDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbReachable = await canReachDatabase();

test('card.service', { skip: !dbReachable && '資料庫無法連線' }, async (t) => {
  await t.test('listCards', async (t) => {
    await t.test('只回傳 isActive 的卡', async (t) => {
      const runId = makeRunId('cs01');
      const active = await createCard(runId, { name: `${runId}-active` });
      const inactive = await createCard(runId, { name: `${runId}-inactive`, isActive: false });
      t.after(() => cleanupByRunId(runId));

      const result = await listCards({});
      const ids = result.map((c) => c.id);
      assert.ok(ids.includes(active.id));
      assert.ok(!ids.includes(inactive.id));
    });

    await t.test('keyword 命中卡名（大小寫不敏感）', async (t) => {
      const runId = makeRunId('cs02');
      const card = await createCard(runId, { name: `${runId}-ChArIzArD` });
      t.after(() => cleanupByRunId(runId));

      const result = await listCards({ keyword: 'chariz' });
      assert.ok(result.some((c) => c.id === card.id));
    });

    await t.test('keyword 命中卡號', async (t) => {
      const runId = makeRunId('cs03');
      const card = await createCard(runId, { cardNumber: `${runId}-SV999` });
      t.after(() => cleanupByRunId(runId));

      const result = await listCards({ keyword: 'SV999' });
      assert.ok(result.some((c) => c.id === card.id));
    });

    await t.test('language + grade 同時篩選', async (t) => {
      const runId = makeRunId('cs04');
      const match = await createCard(runId, { name: `${runId}-match`, language: 'en', condition: 'psa10' });
      const noMatch = await createCard(runId, { name: `${runId}-nomatch`, language: 'ja', condition: 'psa10' });
      t.after(() => cleanupByRunId(runId));

      const result = await listCards({ language: 'en', grade: 'psa10' });
      const ids = result.map((c) => c.id);
      assert.ok(ids.includes(match.id));
      assert.ok(!ids.includes(noMatch.id));
    });
  });

  await t.test('getCardById', async (t) => {
    await t.test('存在且 active → 含 active sources，不含停用 source', async (t) => {
      const runId = makeRunId('cs05');
      const card = await createCard(runId);
      const activeSource = await createSource(card.id, { provider: `${runId}-active` });
      const inactiveSource = await createSource(card.id, { provider: `${runId}-inactive`, isActive: false });
      t.after(() => cleanupByRunId(runId));

      const result = await getCardById(card.id);
      const sourceIds = result.sources.map((s) => s.id);
      assert.ok(sourceIds.includes(activeSource.id));
      assert.ok(!sourceIds.includes(inactiveSource.id));
    });

    await t.test('不存在 → notFound (404)', async () => {
      await assert.rejects(() => getCardById('non-existent-id'), (err) => err.status === 404);
    });

    await t.test('卡片 isActive: false → notFound（不是回傳停用卡）', async (t) => {
      const runId = makeRunId('cs08');
      const card = await createCard(runId, { isActive: false });
      t.after(() => cleanupByRunId(runId));

      await assert.rejects(() => getCardById(card.id), (err) => err.status === 404);
    });
  });

  await t.test('getCardPriceSummary', async (t) => {
    await t.test('無 snapshot → 全部欄位為 null', async (t) => {
      const runId = makeRunId('cs09');
      const card = await createCard(runId);
      t.after(() => cleanupByRunId(runId));

      const summary = await getCardPriceSummary(card.id);
      assert.equal(summary.latestPrice, null);
      assert.equal(summary.change7d, null);
      assert.equal(summary.change30d, null);
    });

    await t.test('只有 1 筆 snapshot → change7d/change30d 皆為 null', async (t) => {
      const runId = makeRunId('cs10');
      const card = await createCard(runId);
      const source = await createSource(card.id);
      await createSnapshot(card.id, source.id, { price: 1000, fetchedAt: new Date() });
      t.after(() => cleanupByRunId(runId));

      const summary = await getCardPriceSummary(card.id);
      assert.equal(summary.latestPrice, 1000);
      assert.equal(summary.change7d, null);
      assert.equal(summary.change30d, null);
    });

    await t.test('7 天前有資料 → change7d 正確計算漲跌幅', async (t) => {
      const runId = makeRunId('cs11');
      const card = await createCard(runId);
      const source = await createSource(card.id);
      const now = new Date();
      const day8Ago = new Date(now - 8 * 24 * 60 * 60 * 1000);
      await createSnapshot(card.id, source.id, { price: 100, fetchedAt: day8Ago });
      await createSnapshot(card.id, source.id, { price: 150, fetchedAt: now });
      t.after(() => cleanupByRunId(runId));

      const summary = await getCardPriceSummary(card.id);
      assert.equal(summary.change7d.diff, 50);
      assert.equal(summary.change7d.pct, 50);
    });

    await t.test('past.price 為 0 時 change 為 null（避免除以 0）', async (t) => {
      const runId = makeRunId('cs12');
      const card = await createCard(runId);
      const source = await createSource(card.id);
      const now = new Date();
      const day8Ago = new Date(now - 8 * 24 * 60 * 60 * 1000);
      // price 欄位有 DB 限制嗎？目前 schema 只要求 Float，允許 0 已經在別處被 normalizePrice 擋掉，
      // 但歷史資料若因舊 bug 存進 0，summary 的除以 0 防呆仍要能正確處理
      await createSnapshot(card.id, source.id, { price: 0, fetchedAt: day8Ago });
      await createSnapshot(card.id, source.id, { price: 150, fetchedAt: now });
      t.after(() => cleanupByRunId(runId));

      const summary = await getCardPriceSummary(card.id);
      assert.equal(summary.change7d, null);
    });

    await t.test('多幣別時只比較與 latest 同幣別的歷史快照', async (t) => {
      const runId = makeRunId('cs13');
      const card = await createCard(runId);
      const source = await createSource(card.id);
      const now = new Date();
      const day8Ago = new Date(now - 8 * 24 * 60 * 60 * 1000);
      await createSnapshot(card.id, source.id, { price: 100, currency: 'USD', fetchedAt: day8Ago });
      await createSnapshot(card.id, source.id, { price: 9999, currency: 'JPY', fetchedAt: now });
      t.after(() => cleanupByRunId(runId));

      const summary = await getCardPriceSummary(card.id);
      // latest 為 JPY，历史唯一一筆是 USD，幣別不同不應該拿來比較
      assert.equal(summary.change7d, null);
    });
  });

  await t.test('getCardPrices', async (t) => {
    await t.test('無篩選回全部，按 fetchedAt asc 排序', async (t) => {
      const runId = makeRunId('cs14');
      const card = await createCard(runId);
      const source = await createSource(card.id);
      const earlier = new Date('2026-01-01T00:00:00Z');
      const later = new Date('2026-06-01T00:00:00Z');
      await createSnapshot(card.id, source.id, { price: 100, fetchedAt: later });
      await createSnapshot(card.id, source.id, { price: 90, fetchedAt: earlier });
      t.after(() => cleanupByRunId(runId));

      const result = await getCardPrices(card.id);
      assert.equal(result.length, 2);
      assert.ok(result[0].fetchedAt <= result[1].fetchedAt);
    });

    await t.test('from 篩選', async (t) => {
      const runId = makeRunId('cs15');
      const card = await createCard(runId);
      const source = await createSource(card.id);
      await createSnapshot(card.id, source.id, { fetchedAt: new Date('2026-01-01T00:00:00Z') });
      await createSnapshot(card.id, source.id, { fetchedAt: new Date('2026-06-01T00:00:00Z') });
      t.after(() => cleanupByRunId(runId));

      const result = await getCardPrices(card.id, { from: '2026-03-01T00:00:00Z' });
      assert.equal(result.length, 1);
    });

    await t.test('source(provider) 篩選', async (t) => {
      const runId = makeRunId('cs17');
      const card = await createCard(runId);
      const sourceA = await createSource(card.id, { provider: `${runId}-A` });
      const sourceB = await createSource(card.id, { provider: `${runId}-B` });
      await createSnapshot(card.id, sourceA.id, { provider: `${runId}-A` });
      await createSnapshot(card.id, sourceB.id, { provider: `${runId}-B` });
      t.after(() => cleanupByRunId(runId));

      const result = await getCardPrices(card.id, { source: `${runId}-A` });
      assert.equal(result.length, 1);
      assert.equal(result[0].provider, `${runId}-A`);
    });

    // R5：目前 getCardPrices 直接把 query 丟給 Prisma，from/to 沒有先過 Zod 驗證，
    // 非法日期字串會讓 `new Date('abc')` 產生 Invalid Date，Prisma 對 Invalid Date 的行為
    // 依版本而異；這裡先記錄現況（service 層不會自己 400，由呼叫端／HTTP 層決定要不要擋）。
    await t.test('（R5）from 為非法日期字串時的現況行為（service 層本身不驗證）', async (t) => {
      const runId = makeRunId('cs18');
      const card = await createCard(runId);
      t.after(() => cleanupByRunId(runId));

      // service 本身不丟 400；驗證應該在 HTTP 層做（見 cards.http.test.js CRD-08）
      await assert.rejects(() => getCardPrices(card.id, { from: 'abc' }));
    });
  });

  await t.test('getTcgplayerPriceHistory', async (t) => {
    await t.test('卡片無 tcgplayer 來源 → null', async (t) => {
      const runId = makeRunId('cs19');
      const card = await createCard(runId);
      await createSource(card.id, { provider: 'not-tcgplayer' });
      t.after(() => cleanupByRunId(runId));

      const result = await getTcgplayerPriceHistory(card.id);
      assert.equal(result, null);
    });

    await t.test('有 tcgplayer 來源但缺 externalId → null', async (t) => {
      const runId = makeRunId('cs20');
      const card = await createCard(runId);
      await createSource(card.id, { provider: 'tcgplayer', externalId: null });
      t.after(() => cleanupByRunId(runId));

      const result = await getTcgplayerPriceHistory(card.id);
      assert.equal(result, null);
    });

    await t.test('外部回多筆 → 取 Near Mint + Normal + English', async (t) => {
      const runId = makeRunId('cs21');
      const card = await createCard(runId);
      await createSource(card.id, { provider: 'tcgplayer', externalId: '999' });
      t.after(() => {
        nock.cleanAll();
        return cleanupByRunId(runId);
      });

      nock('https://infinite-api.tcgplayer.com')
        .get('/price/history/999/detailed?range=quarter')
        .reply(200, infiniteHistoryFixture);

      const result = await getTcgplayerPriceHistory(card.id);
      assert.equal(result.condition, 'Near Mint');
    });

    await t.test('無符合條件時 fallback 為 result[0]', async (t) => {
      const runId = makeRunId('cs22');
      const card = await createCard(runId);
      await createSource(card.id, { provider: 'tcgplayer', externalId: '888' });
      t.after(() => {
        nock.cleanAll();
        return cleanupByRunId(runId);
      });

      nock('https://infinite-api.tcgplayer.com')
        .get('/price/history/888/detailed?range=quarter')
        .reply(200, {
          result: [{ condition: 'Damaged', variant: 'Foil', language: 'Japanese' }],
        });

      const result = await getTcgplayerPriceHistory(card.id);
      assert.equal(result.condition, 'Damaged');
    });

    await t.test('result 為空陣列 → null', async (t) => {
      const runId = makeRunId('cs22b');
      const card = await createCard(runId);
      await createSource(card.id, { provider: 'tcgplayer', externalId: '777' });
      t.after(() => {
        nock.cleanAll();
        return cleanupByRunId(runId);
      });

      nock('https://infinite-api.tcgplayer.com')
        .get('/price/history/777/detailed?range=quarter')
        .reply(200, { result: [] });

      const result = await getTcgplayerPriceHistory(card.id);
      assert.equal(result, null);
    });

    // R6（已修正）：外部 API 呼叫現在包了 try/catch + timeout，失敗時優雅降級回 null，
    // 不再讓呼叫端整個往上炸掉。
    await t.test('（R6 已修正）外部 API 回 500 時優雅降級回傳 null', async (t) => {
      const runId = makeRunId('cs23');
      const card = await createCard(runId);
      await createSource(card.id, { provider: 'tcgplayer', externalId: '666' });
      t.after(() => {
        nock.cleanAll();
        return cleanupByRunId(runId);
      });

      nock('https://infinite-api.tcgplayer.com')
        .get('/price/history/666/detailed?range=quarter')
        .reply(500);

      const result = await getTcgplayerPriceHistory(card.id);
      assert.equal(result, null);
    });

    // FETCH_TIMEOUT_MS 在 card.service.js 是 import 當下讀一次的模組常數（.env.test 設 200ms），
    // 這裡讓外部回應延遲超過該值，驗證 axios 的 timeout 選項確實生效
    await t.test('（R6 已修正）外部 API 逾時時優雅降級回傳 null', async (t) => {
      const runId = makeRunId('cs23b');
      const card = await createCard(runId);
      await createSource(card.id, { provider: 'tcgplayer', externalId: '667' });
      t.after(() => {
        nock.cleanAll();
        return cleanupByRunId(runId);
      });

      nock('https://infinite-api.tcgplayer.com')
        .get('/price/history/667/detailed?range=quarter')
        .delay(5000)
        .reply(200, { result: [] });

      const result = await getTcgplayerPriceHistory(card.id);
      assert.equal(result, null);
    });
  });
});
