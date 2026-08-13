# 卡牌詳情頁：多來源台幣價格趨勢圖

- 日期：2026-08-10
- 範圍：`apps/web`（主要）、`apps/api`（一處）、`packages/db/prisma/seed.js`
- 對應 PRD：FR-15（趨勢圖）、US-08（歷史價格）、US-11（比較不同來源價格）、二十三章（來源定義不同不硬算平均）

## 一、問題

[CardDetailPage.jsx](../../../apps/web/src/pages/CardDetailPage.jsx) 目前有兩張圖，「台幣價格趨勢」那張顯示不正確，實測資料確認四個成因：

1. **多來源混成一條線** — `prices.map()` 逐筆快照直接變成一個點，沒依 provider 分組。同一天 `mockApi` NT$1,065 與 `mockCrawler` NT$5,698 會直接相連，線暴衝。
2. **大部分的點畫不出來** — `priceTwd` 為 `null` 的快照被 `connectNulls` 跳過。`db:reset` 後 `Currency` 表是空的，導致 29 筆快照 100% 換算失敗，圖幾乎全空。
3. **X 軸不是時間軸** — `dataKey="date"` 是 category 字串。同一天多筆產生重複刻度，且日期間隔不等寬時比例失真。
4. **沒有天數上限** — `getCardPrices(id)` 撈全部快照。

此外，TCGPlayer 那張圖畫的其實也是「某個來源的價格歷史」，跟台幣圖分開呈現，使用者得自己在兩張圖之間換算比對。

## 二、目標

把兩張圖合併成**一張**「價格趨勢」圖：

- X 軸：日期，一天一格
- Y 軸：台幣
- 每個價格來源一條線，含 TCGPlayer 官方市場價
- 區間可切換：7 天 / 1 個月 / 3 個月

## 三、設計

### 3.1 資料整形：`apps/web/src/lib/priceSeries.js`

純函式模組，不碰 React。

```js
buildDailySeries({ snapshots, tcgBuckets, days })
// → { providers: string[], points: Array<{...}> }
```

**輸入**

- `snapshots` — `GET /cards/:id/prices` 回傳的 flat 陣列（頁面已抓，不另外請求）
- `tcgBuckets` — TCGPlayer 歷史的 `buckets`，可為 `null`
- `days` — `7 | 30 | 90`

**步驟**

1. **日期骨架**：產生連續的每日 key，起點取 `max(今天 - days + 1, 最早有資料的日期)`。
   不硬補滿整個區間，避免資料只有 8 天時 3M 出現 82 格空白。
2. **本地時區分桶**：`fetchedAt` 是 UTC ISO 字串，一律轉成**本地日期**取 `YYYY-MM-DD` 當 key。
   直接用 `toISOString().slice(0,10)` 會讓 `2026-08-09T16:30Z`（台灣 8/10 00:30）歸錯天。
3. **只收 `priceTwd !== null` 的快照**（依專案慣例用嚴格等值）。
4. **同日同來源取最後一筆**：按 `fetchedAt` 升冪掃過，後者覆蓋前者。
   對應 PRD 十八章「重複跑同一天價格可以允許多筆快照，但要保留時間戳」。
5. **併入 TCGPlayer**：每個 bucket 依 `bucketStartDate` 對進骨架，series 名稱固定為常數
   `TCG_MARKET_SERIES = 'TCGPlayer 市場價'`，值取後端補的 `marketPriceTwd`。
   同時把 `quantitySold` 掛在 `__tcgQuantitySold` 供 tooltip 使用（`__` 前綴表示不畫成線）。
6. **輸出**：
   - `providers` — 此區間內實際有資料的 series 名稱。我方 provider 依字母排序在前，
     `TCG_MARKET_SERIES` 固定排最後，讓顏色分配穩定。
   - `points` — recharts 用的 flat 物件陣列，例如
     `{ dateKey: '2026-08-09', label: '8/9', mockApi: 2419, 'TCGPlayer 市場價': 5001, __tcgQuantitySold: 4 }`
     某 series 當天沒資料就是 `null`。

`providers` 與 `points` 由同一次計算產出，避免「畫幾條線」和「線的資料」來自兩處而不一致。

### 3.2 圖表元件：`apps/web/src/components/PriceTrendChart.jsx`

Props 只吃 `prices`（flat 快照陣列）與 `cardId`，內部自管 `days` state。

抽成獨立元件的理由：`CardDetailPage.jsx` 已 376 行，這張圖約 90 行；且合併前頁面同時存在兩個不相干的 range state，擠在一起容易混淆。

**區間切換**

```js
const TREND_RANGES = [['7 天', 7], ['1 個月', 30], ['3 個月', 90]];
```

用中文標籤。原本的 TCGPlayer 圖用 `1M / 3M / 1Y`，合併後雖然只剩一組按鈕，中文標籤仍較不易與外部平台慣例混淆。

**TCGPlayer 歷史的 range 映射**

實測 `infinite-api.tcgplayer.com` 三個 range 的 bucket 粒度：

| range | bucket 數 | 粒度 |
|---|---|---|
| `month` | 30 | 每天一格 |
| `quarter` | 30 | 每 3 天一格 |
| `annual` | 52 | 每 7 天一格 |

只有 `month` 對得上「一天一格」，所以：

- `days <= 30` → `range=month`
- `days === 90` → `range=quarter`

7 天不需要特別 slice：日期骨架 join 時自然只取到 7 天內的 bucket。

3M 時 TCGPlayer 的點落在每 3 天，其餘為 `null`；90 天本來就不顯示 dot，`connectNulls` 接起來的線看不出疏密。**不做插值** — 那等於捏造資料。

`useEffect` 的 deps 用**映射後的 range**而非 `days`，這樣 7↔30 切換不會重打外部 API。

**圖表設定**

- 對 `providers` 逐一產生 `<Line dataKey={provider}>`，線數由資料決定，不寫死。
- `connectNulls` 開啟。
- `dot` 依區間決定：`days <= 30` 顯示，`days === 90` 關閉（90 個點 × 多條線會糊成一片）。
- X 軸 `interval="preserveStartEnd"`，讓 recharts 在長區間自動抽稀刻度。
- Y 軸台幣，`tickFormatter` 加千分位。
- **必須有 `<Legend />`** — 現行圖沒有，使用者無法分辨哪條線是哪個來源。
- Tooltip 顯示日期 + 當天各 series 的台幣價（`null` 的不列），另附 TCGPlayer 成交量（若有）。

**成交量處理**

原本 TCGPlayer 圖有 `quantitySold` 的 Bar。合併後單一台幣 Y 軸，再加第二 Y 軸的 Bar 會過擠；且實測 `quantitySold` 多數為 `0`，Bar 大半時間是空的。改為**移進 tooltip**，資訊不丟。

**Y 軸尺度的已知限制**

不同來源價差可達數倍（實測 mockApi 763 / mockCrawler 5024），共用線性 Y 軸時低價線會被壓平。這是真實價差，不是缺陷 — PRD 二十三章明言「價格來源定義不同 → 價格不可直接比較，必要時不要硬算平均」，因此畫多條線而非取平均。本次不做對數軸。

**空狀態**

- 完全沒有快照 → 「尚無價格紀錄」
- 有快照但 `priceTwd` 全為 `null` → 明確指出換算失敗，提示執行 `npm run currency:once`，
  取代現行含糊的「重跑抓價後產生」

### 3.3 頁面調整：`CardDetailPage.jsx`

- 移除「市場價格歷史」與「台幣價格趨勢」兩個 `<Card>`，換成單一 `<PriceTrendChart>`。
- 移除綁在 TCGPlayer 圖上的 header：`Near Mint $xx.xx` 與 `pctChange`。
  漲跌幅由頁面上方既有的 `ChangeBadge`（近 7 日 / 近 30 日）負責，重複顯示只會混淆。
- 移除 `historyChartData`、`pctChange`、`twdChartData`、`hasTwd` 等就地整形邏輯，以及 `ComposedChart` / `Bar` import。
- 移除 debug 用的 `console.log(cardRes, priceRes, summaryRes)`。
- 保留「歷史價格」表格與「匯出 CSV」不動。

**不新增 API 呼叫**：頁面已為表格抓回全部快照，圖表直接複用同一份 `prices`，切換區間在前端切。因此 `lib/api.js` 不需改動、無額外 loading state、切換即時。資料量增長的隱憂是既有行為，本次未使其惡化。

### 3.4 後端：`getTcgplayerPriceHistory` 補台幣

**這是本次唯一的後端改動。**

`marketPrice` 是美金字串（如 `'18.11'`），要與台幣線共用 Y 軸就必須換算，而匯率在 `Currency` 表 —
前端無從取得。

在 [card.service.js](../../../apps/api/src/services/card.service.js) 的 `getTcgplayerPriceHistory` 回傳前：

1. 讀 `Currency` 中 `code: 'USD'` 的 `rateToTwd`
2. 用同 app 內既有的 `lib/convertToTwd.js` 換算（依賴方向正確），每個 bucket 補上 `marketPriceTwd`
3. 匯率查不到或換算失敗 → 該 bucket `marketPriceTwd: null`，不 throw

`convertToTwd` 已擋掉 `<= 0` 與非有限值，`marketPrice` 為 `'0'` 的 bucket 自然得到 `null`。

於 `card.service.test.js` 補一個 case：驗證 bucket 帶有正確的 `marketPriceTwd`，且匯率缺漏時為 `null`。

### 3.5 Seed 資料：`packages/db/prisma/seed.js`

現行 seed 產不出這張圖需要的資料，七處要改。

**1. 匯率 fallback**

`db:reset` 清空 `Currency`，而 `db:seed` 與 `job:once` 都只讀不寫 → `priceTwd` 全 `null`。

seed 開頭檢查 `Currency`，為空則寫入一組涵蓋 `FOREIGN_CURRENCIES`（USD／JPY／HKD／EUR）
加 `TWD = 1` 的 fallback 匯率，`source` 標為 `'seed-fallback'`，
並印出明顯警告提示執行 `npm run currency:once` 換真匯率。

如此 `db:reset && db:seed && job:once` 一路下來資料即完整，且不依賴外部匯率 API —
對應 PRD 二十三章「Demo 當天來源失敗 → 準備 seed data 與 mock source 備援」。

**2. 歷史迴圈跑全部來源**

現行 `seedSnapshots` 每張卡只取 `sources[0]`，導致沒有任何一張卡有兩條完整來源線。
改為 `for (const source of card.sources)`，第 n 個來源（0-based）的基準價乘上 `1 + n * 0.18`
製造來源間價差 — 否則線會疊在一起，也不符合真實市場。

**但跳過 `provider === 'tcgplayer'` 的來源**：它的價值在於展示真實外部來源，
由 `job:once` 實際抓取即可。灌假的 USD 歷史進去，會與同一張圖上真實的
「TCGPlayer 市場價」線互相矛盾。該來源在圖上只會有 `job:once` 抓到的當日單點，這是預期行為。

**3. 8 天 → 90 天**

3M 區間要有內容就得灌到 90 天。

**4. `createMany` 取代逐筆 `create`**

90 天 × 4 條 mock 來源線 = 360 筆，逐筆 `await create` 會有 360 次來回。

**5. 價格改隨機漫步**

現行 `base * (1 + (random - 0.5) * 0.15)` 每天獨立取亂數，90 天會是純雜訊。
改為 `price = prev * (1 + (random - 0.5) * 0.06)`，並夾在 `base` 的 ±40% 內防止漂移。
PRD 成功指標含「趨勢可理解」，雜訊圖無法達成。

**6. 補算 `priceTwd`**

用 fallback／Currency 表的匯率，寫快照時一併算 `Math.round(price * rate)`。

**不 import `convertToTwd`** — 它在 `apps/api/src/lib`，`packages/db` 依賴 `apps/api` 是反向依賴。
為共用一行乘法把它搬進 `packages/shared` 的代價大於收益，本次不做。

**7. 新增 tcgplayer 來源**

現行 demo 卡無任何 `tcgplayer` 來源，合併圖上「TCGPlayer 市場價」永遠不會出現，等於無法驗證。

為皮卡丘 V 增加 `{ type: 'crawler', provider: 'tcgplayer', externalId: '610969', currency: 'USD' }`。
`610969` 已實測確有 90 天歷史；`currency` 用 `'USD'` 與 `tcgplayerCrawler.adapter.js` 的預設一致。

這同時能展示命名區隔：圖上會並存我方抓取的 `tcgplayer` 快照點（`job:once` 抓到的當日單點）
與官方的「TCGPlayer 市場價」90 天線。

代價是引入外部依賴（`job:once` 會真的打 TCGPlayer，可能慢或失敗）。
`getTcgplayerPriceHistory` 既有 try/catch 回 `null`，抓不到就少一條線，不影響頁面。

`ミュウツー GX`（未成功抓價）與停用卡維持不變，PRD 二十九章要求保留。

## 四、不做

- 不新增後端端點。既有 `GET /cards/:id/prices` 已足夠，為畫圖新增端點是把展示層責任推給 API。
- 不對 TCGPlayer 的 3 天 bucket 做插值。
- 不做對數 Y 軸。
- 不把 `convertToTwd` 搬進 `packages/shared`。
- 不動「歷史價格」表格與 CSV 匯出。
- 不為 `priceSeries.js` 建測試 — 見下節。

## 五、已知取捨

`apps/web` 沒有測試框架（`package.json` 只有 vite，無 vitest），因此 `priceSeries.js`
這個純函式短期內沒有自動化測試，僅靠下節的手動驗證。

為單一模組引入前端測試框架超出本次範圍；但這個函式的邊界（本地時區分桶、同日多筆、
跨來源缺值）正是值得測的，建議列為後續獨立工作。

## 六、驗證

```bash
npm run db:reset && npm run db:seed && npm run db:seed:admin && npm run job:once
npm run test:api
npm run dev:api   # 另一個終端機
npm run dev:web
```

開啟皮卡丘 V 詳情頁，確認：

1. 7 天 / 1 個月 / 3 個月三個區間都畫得出線，且互有差異
2. 線的條數等於該卡實際有台幣資料的來源數，Legend 名稱正確
3. 「TCGPlayer 市場價」線存在，且與我方 `tcgplayer` 快照線分列兩條
4. tooltip 的台幣數字對得上下方「歷史價格」表格同日同來源的值
5. 90 天區間不顯示 dot，X 軸刻度不重疊
6. 挑一張只有單一來源的卡（リザードン V），確認只畫一條線且不報錯
7. 挑 `ミュウツー GX`（seed 不給歷史，只有 `job:once` 抓到的單日一筆），
   確認單點資料下圖表正常渲染而非崩潰
8. 暫時把 `Currency` 表清空並重跑 `job:once`，確認出現的是「提示跑 `currency:once`」
   的空狀態訊息，而非空白圖表
