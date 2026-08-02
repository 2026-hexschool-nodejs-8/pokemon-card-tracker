---
name: crawler-integration
description: 將爬蟲/目錄的 TCGPlayer 爬蟲整合進 apps/api，並在前端 CardListPage 與 CardDetailPage 顯示卡牌圖片
metadata:
  type: project
---

# 爬蟲整合設計 — TCGPlayer Crawler + 前端圖片顯示

## 目標

1. 將 `爬蟲/scraper.js` 的 TCGPlayer 抓價邏輯整合進 `apps/api` adapter 架構
2. 新增批次匯入路由，透過 Playwright 從 TCGPlayer 搜尋頁自動發現並建立卡牌
3. 前端 `CardListPage`（縮圖）與 `CardDetailPage`（大圖）顯示 `card.imageUrl`

---

## 第一節：後端 Adapter

### 新增檔案：`apps/api/src/adapters/crawler/tcgplayerCrawler.adapter.js`

- 實作現有 `{ type, name, fetchPrice(source) }` 介面
- `type = 'crawler'`，`name = 'tcgplayer'`
- `source.externalId` 存放 TCGPlayer `productId`（整數字串）
- 用 `axios` 並行呼叫兩支 TCGPlayer 內部 API：
  - `POST mpapi.tcgplayer.com/v2/product/{id}/latestsales?mpfev=5293`
  - `POST data.tcgplayer.com/spotlight/search/{id}`
- 不使用 Playwright（單張模式不需搜尋頁）
- 回傳標準 `PriceResult`：`{ provider, price, rawText, currency, fetchedAt }`
- 副作用：若 `Card.imageUrl` 尚未設定，用 Prisma 更新為 `https://tcgplayer-cdn.tcgplayer.com/product/{id}_in_1000x1000.jpg`

### 修改：`apps/api/src/adapters/registry.js`

- import `tcgplayerCrawlerAdapter`，加入 `adapters` 陣列
- 現有 `mockCrawlerAdapter` 保留

### 共用爬蟲工具：`apps/api/src/adapters/crawler/tcgplayer.scraper.js`

從 `爬蟲/scraper.js` 移植並改為 ESM export：
- `getProductIds(page)` — Playwright 搜尋頁攔截（批次匯入使用）
- `scrapeCard(productId)` — axios 呼叫兩支 TCGPlayer API（adapter 與批次匯入都使用）
- `BASE_HEADERS` / `getHeaders()` — Cookie 注入邏輯

`tcgplayerCrawler.adapter.js` 和 `admin.import.js` 都從此檔 import，避免重複。

### 依賴

- `playwright` 加入 `apps/api/package.json`（僅批次匯入使用）
- `axios` 若尚未在 `@pct/api` 中則新增

---

## 第二節：批次匯入路由

### 新增檔案：`apps/api/src/routes/admin.import.js`

**端點：** `POST /admin/import/tcgplayer`（受 `adminAuth` JWT middleware 保護）

**Request body（選填）：**
```json
{ "page": 1, "limit": 10 }
```

**流程：**
1. 呼叫 `getProductIds(page)` — Playwright headless Chromium 載入 TCGPlayer 搜尋頁，攔截 JSON 回應，提取 productId 列表
2. 取前 `limit` 筆（上限 50），依序執行：
   a. `scrapeCard(productId)` 取得 `name`、`imageUrl`
   b. 查詢 DB：`PriceSource.externalId = productId AND provider = 'tcgplayer'`，若已存在則標記 `skipped`
   c. 若為新卡：建立 `Card`（含 `imageUrl`）+ `PriceSource`（`type=crawler, provider=tcgplayer, externalId=productId`）
   d. 呼叫 `runPriceSync({ triggerType: 'manual', cardId })`
3. 回傳：`{ imported, skipped, failed, results[] }`

### 修改：`apps/api/src/app.js`

- import `adminImportRouter`，掛載於 `/admin/import`（在 `adminAuth` 之後）

---

## 第三節：前端圖片顯示

### 修改：`apps/web/src/pages/CardListPage.jsx`

- 每個卡牌 Card 頂部加入圖片區塊
- 若 `c.imageUrl` 存在：`<img src={c.imageUrl} className="h-40 w-full object-contain" />`
- 若無：`<div className="h-40 bg-muted rounded" />`（佔位，防版面跳動）

### 修改：`apps/web/src/pages/CardDetailPage.jsx`

- 卡牌資訊區改為 md 以上左右兩欄佈局
- 左欄：`<img src={card.imageUrl} className="max-w-xs w-full object-contain" />`（無 imageUrl 時顯示佔位）
- 右欄：名稱、卡號、語言/品相、最新價格、最後更新時間（現有內容）

**不需修改 `lib/api.js`**：`imageUrl` 已包含在現有 `GET /cards` 與 `GET /cards/:id` 回傳的 Card 欄位中。

---

## 資料流

```
管理員觸發 POST /admin/import/tcgplayer
  → Playwright 搜尋頁 → extractProductIds()
  → scrapeCard(id) [axios]
  → DB: Card + PriceSource (upsert by externalId)
  → runPriceSync() → tcgplayerCrawlerAdapter.fetchPrice()
      → axios latestsales + spotlight
      → normalizePrice()
      → PriceSnapshot + Card.imageUrl + Card.latestPrice

前台 GET /cards → Card.imageUrl
  → CardListPage: 縮圖 h-40
  → CardDetailPage: 大圖 max-w-xs，左右兩欄
```

---

## 環境變數

`.env` 需確認有：
```
TCGPLAYER_COOKIE=<從瀏覽器 DevTools 複製>
```
Cookie 注入於每次 axios 請求的 `Cookie` header；若未設定仍嘗試（部分端點不需要）。

---

## 不在此次範圍

- TCGPlayer Cookie 自動更新機制
- 批次匯入進度即時推送（WebSocket / SSE）
- `apps/web` 後台 AdminPage 觸發匯入的 UI（路由已就緒，UI 可後續補）
- 刪除 `爬蟲/` 獨立目錄（保留備用）
