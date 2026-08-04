// 測試共用 DB helper － 用 runId 前綴隔離資料，測試結束後依 runId 清理
// 不用全表 truncate：既有 priceSync.error-cases.test.js 也用同一套慣例，統一寫法方便共用
import { prisma } from '@pct/db';

export function makeRunId(label = 'test') {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function createCard(runId, overrides = {}) {
  return prisma.card.create({
    data: {
      name: `${runId}-card`,
      cardNumber: `${runId}-001`,
      language: 'ja',
      condition: 'raw',
      isActive: true,
      ...overrides,
    },
  });
}

export async function createSource(cardId, overrides = {}) {
  return prisma.priceSource.create({
    data: {
      cardId,
      type: 'crawler',
      provider: 'mockCrawler',
      currency: 'JPY',
      isActive: true,
      ...overrides,
    },
  });
}

export async function createSnapshot(cardId, sourceId, overrides = {}) {
  return prisma.priceSnapshot.create({
    data: {
      cardId,
      sourceId,
      provider: 'mockCrawler',
      price: 1000,
      currency: 'JPY',
      fetchedAt: new Date(),
      isSuspicious: false,
      ...overrides,
    },
  });
}

export async function setCurrencyRate(code, rateToTwd) {
  return prisma.currency.upsert({
    where: { code },
    create: { code, rateToTwd, fetchedAt: new Date(), source: 'test-fixture' },
    update: { rateToTwd, fetchedAt: new Date() },
  });
}

// 依 runId 前綴清掉本次測試建立的資料（card 用 cascade 帶走 source/snapshot/log）
export async function cleanupByRunId(runId) {
  await prisma.card.deleteMany({ where: { name: { startsWith: runId } } });
}

export async function clearRunningJobs() {
  await prisma.priceFetchJob.deleteMany({ where: { status: 'running' } });
}
