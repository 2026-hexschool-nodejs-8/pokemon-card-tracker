# 爬蟲整合實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 `爬蟲/scraper.js` 的 TCGPlayer 爬蟲整合進 `apps/api` adapter 架構，新增批次匯入路由（Playwright 搜尋頁自動建卡），並在前端 CardListPage（縮圖）與 CardDetailPage（大圖）顯示卡牌圖片。

**Architecture:** TCGPlayer 爬蟲邏輯拆成共用工具（`tcgplayer.scraper.js`）和 adapter（`tcgplayerCrawler.adapter.js`）；adapter 透過現有 registry 接入 priceSync 主流程；`priceSync.service.js` 小改以支援 adapter 回傳的 `imageUrl`；批次匯入路由觸發 Playwright 搜尋頁取得 productId 列表後逐一建卡並抓價；前端讀取已有 `Card.imageUrl` 欄位顯示圖片。

**Tech Stack:** Node.js 20 / ESM、axios、Playwright（headless Chromium）、Prisma、Express、React + Tailwind CSS + shadcn/ui

## Global Constraints

- 所有指令從 repo 根目錄執行（`C:\Users\USER\Desktop\寶可夢試做\pokemon-card-tracker`）
- `apps/api` 為 ESM（`"type": "module"`）；所有新檔案使用 `import/export`，禁用 `require`
- 幣別固定 `'USD'`（TCGPlayer 美元）
- `language` 固定 `'en'`（TCGPlayer 英文版）
- `TCGPLAYER_COOKIE` 從 `.env` 讀取（選填；未設定時仍嘗試請求）
- 新增 npm 套件一律指定 workspace：`npm i <pkg> -w @pct/api`
- 不刪除 `爬蟲/` 目錄

---

## 檔案清單

| 動作 | 路徑 | 說明 |
|------|------|------|
| 新增 | `apps/api/src/adapters/crawler/tcgplayer.scraper.js` | ESM 爬蟲工具：`extractProductIds`、`getProductIds`、`scrapeCard` |
| 新增 | `apps/api/src/adapters/crawler/tcgplayer.scraper.test.js` | `extractProductIds` 單元測試 |
| 新增 | `apps/api/src/adapters/crawler/tcgplayerCrawler.adapter.js` | TCGPlayer crawler adapter |
| 修改 | `apps/api/src/adapters/registry.js` | 註冊 tcgplayer adapter |
| 修改 | `apps/api/src/services/priceSync.service.js` | `processOneSource` 支援 `result.imageUrl` |
| 新增 | `apps/api/src/routes/admin.import.js` | `POST /admin/import/tcgplayer` |
| 修改 | `apps/api/src/app.js` | 掛載 import router |
| 修改 | `apps/web/src/pages/CardListPage.jsx` | 格狀卡片加縮圖 |
| 修改 | `apps/web/src/pages/CardDetailPage.jsx` | 左右兩欄大圖佈局 |

---

### Task 1：TCGPlayer 爬蟲共用工具

**Files:**
- Create: `apps/api/src/adapters/crawler/tcgplayer.scraper.js`
- Create: `apps/api/src/adapters/crawler/tcgplayer.scraper.test.js`

**Interfaces:**
- Produces:
  - `extractProductIds(obj: unknown, result?: number[]): number[]` — 遞迴提取 productId，result 預設 `[]`
  - `getProductIds(page?: number): Promise<number[]>` — Playwright 搜尋頁攔截，回傳去重後的 productId 陣列
  - `scrapeCard(productId: number): Promise<{ productId, name, imageUrl, price: number|null }>` — axios 呼叫兩支 TCGPlayer API

- [ ] **Step 1: 安裝依賴**

```bash
npm i axios -w @pct/api
npm i playwright -w @pct/api
npx playwright install chromium
```

驗證：`cat apps/api/package.json` 可見 `"axios"` 與 `"playwright"` 在 `dependencies`。

- [ ] **Step 2: 撰寫 `extractProductIds` 測試**

建立 `apps/api/src/adapters/crawler/tcgplayer.scraper.test.js`：

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractProductIds } from './tcgplayer.scraper.js';

test('flat object with productId', () => {
  assert.deepEqual(extractProductIds({ productId: 123, name: 'Charizard' }), [123]);
});

test('nested array of objects', () => {
  const input = { results: [{ productId: 100 }, { productId: 200 }] };
  assert.deepEqual(extractProductIds(input), [100, 200]);
});

test('ignores zero and negative numbers', () => {
  assert.deepEqual(extractProductIds({ productId: 0, id: -1 }), []);
});

test('ignores string values in id fields', () => {
  assert.deepEqual(extractProductIds({ productId: '123' }), []);
});

test('null input returns empty array', () => {
  assert.deepEqual(extractProductIds(null), []);
});
```

- [ ] **Step 3: 執行測試，確認失敗**

```bash
node --test apps/api/src/adapters/crawler/tcgplayer.scraper.test.js
```

預期：`ERR_MODULE_NOT_FOUND`（檔案尚未建立）

- [ ] **Step 4: 建立 `tcgplayer.scraper.js`**

```js
import { chromium } from 'playwright';
import axios from 'axios';

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Content-Type': 'application/json',
  'Origin': 'https://www.tcgplayer.com',
  'Referer': 'https://www.tcgplayer.com/',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};

function getHeaders() {
  const headers = { ...BASE_HEADERS };
  if (process.env.TCGPLAYER_COOKIE) {
    headers['Cookie'] = process.env.TCGPLAYER_COOKIE;
  }
  return headers;
}

export function extractProductIds(obj, result = []) {
  if (!obj || typeof obj !== 'object') return result;
  if (Array.isArray(obj)) {
    obj.forEach((item) => extractProductIds(item, result));
    return result;
  }
  const idFields = ['productId', 'ProductId', 'product_id', 'id'];
  for (const field of idFields) {
    if (typeof obj[field] === 'number' && obj[field] > 0) {
      result.push(obj[field]);
    }
  }
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object') {
      extractProductIds(obj[key], result);
    }
  }
  return result;
}

export async function getProductIds(page = 1) {
  const searchUrl = `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&view=grid&ProductTypeName=Cards&page=${page}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: BASE_HEADERS['User-Agent'],
    locale: 'zh-TW',
  });
  const tab = await context.newPage();
  const productIds = [];

  tab.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('application/json')) return;
    if (!url.includes('tcgplayer.com') && !url.includes('tcgapi')) return;
    try {
      const body = await response.json();
      extractProductIds(body, productIds);
    } catch {
      // 忽略解析失敗
    }
  });

  await tab.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await tab.waitForTimeout(3000);
  await browser.close();

  if (productIds.length === 0) {
    throw new Error('無法從搜尋頁取得 productId，請確認頁面是否正常載入或設定 TCGPLAYER_COOKIE');
  }

  return [...new Set(productIds)];
}

export async function scrapeCard(productId) {
  const headers = getHeaders();

  const [latestSalesRes, spotlightRes] = await Promise.all([
    axios.post(
      `https://mpapi.tcgplayer.com/v2/product/${productId}/latestsales?mpfev=5293`,
      { conditions: [], languages: [1], variants: [], listingType: 'All', limit: 25 },
      { headers },
    ),
    axios.post(
      `https://data.tcgplayer.com/spotlight/search/${productId}`,
      { context: { shippingCountry: 'TW', cart: { packages: {} } } },
      { headers },
    ),
  ]);

  const salesData = latestSalesRes.data?.data || [];
  const spotlightData = spotlightRes.data?.spotlight || {};
  const name = salesData[0]?.title || `Product ${productId}`;
  const price = spotlightData.price ?? salesData[0]?.purchasePrice ?? null;

  return {
    productId,
    name,
    imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_in_1000x1000.jpg`,
    price,
  };
}
```

- [ ] **Step 5: 執行測試，確認全過**

```bash
node --test apps/api/src/adapters/crawler/tcgplayer.scraper.test.js
```

預期：5 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/adapters/crawler/tcgplayer.scraper.js apps/api/src/adapters/crawler/tcgplayer.scraper.test.js
git commit -m "feat: 新增 TCGPlayer 爬蟲共用工具（scrapeCard / getProductIds / extractProductIds）"
```

---

### Task 2：TCGPlayer Crawler Adapter + priceSync imageUrl 支援

**Files:**
- Create: `apps/api/src/adapters/crawler/tcgplayerCrawler.adapter.js`
- Modify: `apps/api/src/adapters/registry.js`
- Modify: `apps/api/src/services/priceSync.service.js:95-113`

**Interfaces:**
- Consumes: `scrapeCard(productId: number)` from `./tcgplayer.scraper.js`
- Consumes: `assertPriceResult(result)` from `../contract.js`
- Produces: `tcgplayerCrawlerAdapter` — `{ type: 'crawler', name: 'tcgplayer', fetchPrice(source) }`
  - `source.externalId: string` — TCGPlayer productId（整數字串）
  - `source.cardId: string` — Prisma Card id
  - 回傳：`{ provider, price, currency, fetchedAt, imageUrl }`（imageUrl 為額外欄位，assertPriceResult 允許通過）

- [ ] **Step 1: 建立 adapter**

建立 `apps/api/src/adapters/crawler/tcgplayerCrawler.adapter.js`：

```js
import { assertPriceResult } from '../contract.js';
import { scrapeCard } from './tcgplayer.scraper.js';

export const tcgplayerCrawlerAdapter = {
  type: 'crawler',
  name: 'tcgplayer',
  async fetchPrice(source) {
    const productId = parseInt(source.externalId, 10);
    if (!productId || productId <= 0) {
      throw new Error(`tcgplayer adapter: externalId 必須是正整數，收到 "${source.externalId}"`);
    }

    const card = await scrapeCard(productId);

    if (card.price == null) {
      throw new Error(`tcgplayer adapter: productId ${productId} 無法取得價格（spotlight 與 latestsales 皆無資料）`);
    }

    return assertPriceResult({
      provider: 'tcgplayer',
      price: card.price,
      currency: source.currency || 'USD',
      fetchedAt: new Date().toISOString(),
      imageUrl: card.imageUrl,
    });
  },
};
```

- [ ] **Step 2: 更新 registry**

修改 `apps/api/src/adapters/registry.js`，在第 3 行後加入 import，並加入 adapters 陣列：

原始內容：
```js
import { mockApiAdapter } from './api/mockApi.adapter.js';
import { mockCrawlerAdapter } from './crawler/mockCrawler.adapter.js';

const adapters = [mockApiAdapter, mockCrawlerAdapter];
```

改為：
```js
import { mockApiAdapter } from './api/mockApi.adapter.js';
import { mockCrawlerAdapter } from './crawler/mockCrawler.adapter.js';
import { tcgplayerCrawlerAdapter } from './crawler/tcgplayerCrawler.adapter.js';

const adapters = [mockApiAdapter, mockCrawlerAdapter, tcgplayerCrawlerAdapter];
```

- [ ] **Step 3: 更新 priceSync.service.js 支援 imageUrl**

修改 `apps/api/src/services/priceSync.service.js` 的 `processOneSource` 函式中的 `prisma.card.update` 呼叫（約第 108 行），將：

```js
    prisma.card.update({
      where: { id: source.cardId },
      data: { latestPrice: price, latestCurrency: currency, lastFetchedAt: new Date() },
    }),
```

改為：

```js
    prisma.card.update({
      where: { id: source.cardId },
      data: {
        latestPrice: price,
        latestCurrency: currency,
        lastFetchedAt: new Date(),
        ...(result.imageUrl ? { imageUrl: result.imageUrl } : {}),
      },
    }),
```

- [ ] **Step 4: 手動驗證 adapter 可被 registry 載入**

啟動後端，呼叫 health check 確認不報錯（adapter 在 module 初始化時就被 import）：

```bash
npm run dev:api
# 另開 terminal：
curl http://localhost:3000/health
```

預期回應：`{"status":"ok"}`（不報 import 錯誤）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/adapters/crawler/tcgplayerCrawler.adapter.js apps/api/src/adapters/registry.js apps/api/src/services/priceSync.service.js
git commit -m "feat: 新增 tcgplayer crawler adapter，priceSync 支援回寫 imageUrl"
```

---

### Task 3：批次匯入路由

**Files:**
- Create: `apps/api/src/routes/admin.import.js`
- Modify: `apps/api/src/app.js`

**Interfaces:**
- Consumes: `getProductIds(page)` from `../adapters/crawler/tcgplayer.scraper.js`
- Consumes: `scrapeCard(productId)` from `../adapters/crawler/tcgplayer.scraper.js`
- Consumes: `runPriceSync({ triggerType, cardId })` from `../services/priceSync.service.js`
- Endpoint: `POST /admin/import/tcgplayer` — JWT 保護
  - Body: `{ page?: number, limit?: number }`
  - Response: `{ imported: number, skipped: number, failed: number, results: Array<{ productId, status, cardId?, name?, error? }> }`

- [ ] **Step 1: 建立 `admin.import.js`**

```js
import { Router } from 'express';
import { prisma } from '@pct/db';
import { adminAuth } from '../middleware/adminAuth.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getProductIds, scrapeCard } from '../adapters/crawler/tcgplayer.scraper.js';
import { runPriceSync } from '../services/priceSync.service.js';

const router = Router();
router.use(adminAuth);

router.post(
  '/tcgplayer',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.body.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.body.limit, 10) || 10));

    const productIds = await getProductIds(page);
    const targets = productIds.slice(0, limit);

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    const results = [];

    for (const productId of targets) {
      try {
        const existing = await prisma.priceSource.findFirst({
          where: { externalId: String(productId), provider: 'tcgplayer' },
        });

        if (existing) {
          skipped++;
          results.push({ productId, status: 'skipped' });
          continue;
        }

        const cardData = await scrapeCard(productId);

        const card = await prisma.card.create({
          data: {
            name: cardData.name,
            cardNumber: String(productId),
            imageUrl: cardData.imageUrl,
            language: 'en',
            condition: 'raw',
            sources: {
              create: {
                type: 'crawler',
                provider: 'tcgplayer',
                externalId: String(productId),
                currency: 'USD',
              },
            },
          },
        });

        await runPriceSync({ triggerType: 'manual', cardId: card.id });

        imported++;
        results.push({ productId, status: 'imported', cardId: card.id, name: cardData.name });
      } catch (err) {
        failed++;
        results.push({ productId, status: 'failed', error: err.message });
      }
    }

    res.json({ imported, skipped, failed, results });
  }),
);

export default router;
```

- [ ] **Step 2: 掛載路由至 `app.js`**

修改 `apps/api/src/app.js`，加入 import 與掛載。

在第 8 行 `import adminJobsRouter` 後加入：
```js
import adminImportRouter from './routes/admin.import.js';
```

在 `app.use('/admin', adminJobsRouter);` 後加入：
```js
app.use('/admin/import', adminImportRouter);
```

完整 `/admin` 路由區段如下：
```js
  // 後台（auth 先掛，避免被 /admin 攔截）
  app.use('/admin/auth', authRouter);
  app.use('/admin', adminCardsRouter);
  app.use('/admin', adminJobsRouter);
  app.use('/admin/import', adminImportRouter);
```

- [ ] **Step 3: 手動驗證路由存在**

先取得 JWT token：
```bash
curl -s -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pct.local","password":"admin1234"}' | jq .data.token
```
（將輸出的 token 存為 `$TOKEN`）

確認路由回應（不含 token 時應回 401，不是 404）：
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/admin/import/tcgplayer
```

預期：`401`（表示路由存在且受 adminAuth 保護）

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/admin.import.js apps/api/src/app.js
git commit -m "feat: 新增 POST /admin/import/tcgplayer 批次匯入路由"
```

---

### Task 4：前端 CardListPage 縮圖

**Files:**
- Modify: `apps/web/src/pages/CardListPage.jsx`

**Interfaces:**
- Consumes: `c.imageUrl: string | null` from `GET /cards` response
- 若無圖片：顯示灰色佔位區塊，保持版面高度一致

- [ ] **Step 1: 修改 CardListPage**

將 `apps/web/src/pages/CardListPage.jsx` 中 map 內的 Card 區塊（約第 59-77 行）改為：

```jsx
        {cards.map((c) => (
          <Link key={c.id} to={`/cards/${c.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              {c.imageUrl ? (
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  className="h-40 w-full rounded-t-lg object-contain bg-muted"
                />
              ) : (
                <div className="h-40 w-full rounded-t-lg bg-muted" />
              )}
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {c.cardNumber}　{c.setName}
                </p>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  <span className="text-muted-foreground">語言 / 品相：</span>
                  {c.language} / {c.condition}
                </p>
                <p className="text-lg font-semibold">{fmtPrice(c.latestPrice, c.latestCurrency)}</p>
                <p className="text-xs text-muted-foreground">更新：{fmtTime(c.lastFetchedAt)}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
```

- [ ] **Step 2: 確認前端不報錯**

```bash
npm run dev:web
```

瀏覽器開啟 `http://localhost:5173`，確認：
- 有 imageUrl 的卡牌顯示圖片（高度 h-40）
- 無 imageUrl 的卡牌顯示灰色佔位（相同高度）
- 格狀佈局不因圖片有無而跑版

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CardListPage.jsx
git commit -m "feat: CardListPage 卡片加入縮圖顯示"
```

---

### Task 5：前端 CardDetailPage 大圖

**Files:**
- Modify: `apps/web/src/pages/CardDetailPage.jsx`

**Interfaces:**
- Consumes: `card.imageUrl: string | null` from `GET /cards/:id` response
- 佈局：md 以上左右兩欄（`md:flex-row`），小螢幕垂直堆疊（`flex-col`）
- 左欄：圖片最大寬度 `max-w-xs`
- 右欄：名稱、卡號/系列、語言/品相、最新價格、最後更新時間

- [ ] **Step 1: 修改 CardDetailPage**

將 `apps/web/src/pages/CardDetailPage.jsx` 的第一個 `<Card>` 區塊（約第 49-65 行）：

```jsx
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{card.name}</CardTitle>
          <p className="text-muted-foreground">
            {card.cardNumber}　{card.setName}　{card.language} / {card.condition}
          </p>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-3xl font-bold">
            {card.latestPrice == null
              ? '尚未更新價格'
              : `${card.latestCurrency} ${card.latestPrice.toLocaleString()}`}
          </p>
          <p className="text-sm text-muted-foreground">最後更新：{fmtTime(card.lastFetchedAt)}</p>
        </CardContent>
      </Card>
```

改為：

```jsx
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex-shrink-0">
              {card.imageUrl ? (
                <img
                  src={card.imageUrl}
                  alt={card.name}
                  className="max-w-xs w-full rounded-lg object-contain"
                />
              ) : (
                <div className="max-w-xs w-full h-80 rounded-lg bg-muted" />
              )}
            </div>
            <div className="space-y-3">
              <div>
                <h2 className="text-2xl font-bold">{card.name}</h2>
                <p className="text-muted-foreground">
                  {card.cardNumber}　{card.setName}　{card.language} / {card.condition}
                </p>
              </div>
              <p className="text-3xl font-bold">
                {card.latestPrice == null
                  ? '尚未更新價格'
                  : `${card.latestCurrency} ${card.latestPrice.toLocaleString()}`}
              </p>
              <p className="text-sm text-muted-foreground">最後更新：{fmtTime(card.lastFetchedAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
```

- [ ] **Step 2: 確認前端不報錯**

```bash
npm run dev:web
```

瀏覽器點入任一卡牌詳情頁，確認：
- 有 imageUrl：左欄顯示卡牌圖片，右欄顯示資訊
- 無 imageUrl：左欄顯示灰色佔位（`h-80`），右欄正常
- 小螢幕（縮小視窗）：圖片在上，資訊在下（`flex-col`）
- 「價格趨勢」和「歷史價格」區塊仍正常顯示於下方

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/CardDetailPage.jsx
git commit -m "feat: CardDetailPage 改為左右兩欄大圖佈局"
```

---

## 整合測試（全部 Task 完成後）

完整流程驗證：

```bash
# 1. 啟動後端
npm run dev:api

# 2. 取得 admin token
TOKEN=$(curl -s -X POST http://localhost:3000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pct.local","password":"admin1234"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).data.token))")

# 3. 呼叫批次匯入（第 1 頁，抓 3 張）
curl -s -X POST http://localhost:3000/admin/import/tcgplayer \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"page":1,"limit":3}' | jq .

# 預期：{ imported: N, skipped: 0, failed: 0, results: [...] }

# 4. 確認卡牌已有圖片 URL
curl -s http://localhost:3000/cards | jq '.data[0].imageUrl'
# 預期：一個 tcgplayer-cdn.tcgplayer.com 網址

# 5. 啟動前端，瀏覽卡牌列表與詳情頁
npm run dev:web
# 開啟 http://localhost:5173，確認圖片顯示正確
```
