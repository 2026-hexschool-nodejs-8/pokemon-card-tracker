# 備援 seed data 設計

執行：`npm run db:seed`（從 repo 根目錄）。Admin 另用 `npm run db:seed:admin`。

---

## 卡牌組合（6 張）

| # | 名稱 | 語言 | 條件 | setName | 負責情境 |
|---|------|------|------|---------|----------|
| 1 | リザードン VMAX (SSR) | ja | PSA10 | Shiny Star V | 高價 badge、上漲、超過 30 天、多來源（兩條都啟用） |
| 2 | ミライドン ex | zh | raw | SV4a 黑炎的支配者 | 稀有 badge（sv）、下跌、7~29 天、多來源（一條中斷） |
| 3 | ピカチュウ V | en | PSA9 | XY Promo | 持平、7~29 天、停用 USD 來源 |
| 4 | コイキング | ja | raw | Base Set | 不足 7 天（趨勢顯示 —） |
| 5 | ミュウツー GX | ja | raw | Sun & Moon | 尚未抓價、無圖、失敗來源（EUR / fail） |
| 6 | フシギバナ EX | en | raw | EX Series | 關閉追蹤（isActive: false），保留歷史 |

- [x] 3 張一般卡牌 → 卡2、卡3、卡4
- [x] 1 張高價卡牌 → 卡1（latestPrice ≥ 5000）
- [x] 1 張沒有成功更新過價格的卡牌 → 卡5
- [x] 1 張 setName 含有 sv 的卡牌（稀有 badge）→ 卡2
- [x] 1 張關閉追蹤的卡牌 → 卡6
- [x] 不同語言卡牌（ja / en / zh）→ 卡1+4+5 / 卡3+6 / 卡2
- [x] 1 張價格上漲卡牌 → 卡1（近 7 日約 +6%、近 30 日約 +18%）
- [x] 1 張價格下跌卡牌 → 卡2（近 7 日約 -12%）
- [x] 1 張價格持平卡牌 → 卡3（近 7 日剛好 0%）
- [x] 1 張卡牌涵蓋不足 7 天快照 → 卡4（4 天）
- [x] 1 張卡牌涵蓋 7~29 天快照 → 卡2（21 天）、卡3（14 天）
- [x] 1 張卡牌涵蓋超過 30 天快照 → 卡1（35 天）

---

## 來源與幣別（8 個）

| 卡 | provider | type | 幣別 | 啟用 | 備註 |
|----|----------|------|------|------|------|
| 1 | demoShopJp | crawler | JPY | ✅ | 28,000（對齊 mock 雜湊） |
| 1 | demoShopJp2 | crawler | JPY | ✅ | 30,000（對齊 mock 雜湊） |
| 2 | demoApiTw | api | TWD | ✅ | 4,000（對齊 mock 雜湊） |
| 2 | demoShopHk | crawler | HKD | ❌ | 1,150；8 天前停用，線中斷 |
| 3 | demoShopUs | crawler | USD | ❌ | 42；示範停用來源保留歷史 |
| 4 | demoApiJp | api | JPY | ✅ | 4,500（對齊 mock 雜湊） |
| 5 | demoShopEu | crawler | EUR | ✅ | url 含 `fail` → 永遠失敗 |
| 6 | demoApiJp2 | api | JPY | ✅ | 4,500；卡片停用故不會被抓 |

- [x] 1 個 API 來源 → demoApiTw / demoApiJp / demoApiJp2
- [x] 1 個 crawler 來源 → demoShopJp / demoShopJp2 等
- [x] 1 個失敗來源（產生 partial_success）→ demoShopEu（url 含 fail）
- [x] 1 個停用來源 → demoShopHk、demoShopUs
- [x] 5 個不同的幣別來源（TWD / JPY / HKD / USD / EUR）
- [x] 1 張卡牌有多來源，並有多來源趨勢線 → 卡1（兩條都啟用）、卡2（一條中斷）

Live 抓價會撈到 28 個啟用來源：主角 5（卡1×2 + 卡2 TWD + 卡4 + 卡5 fail）+ 批次卡 23 → 27 成功 1 失敗 = partial_success。

---

## 匯率（5 筆）

寫死常數，同一份同時用於快照 `priceTwd`、卡片 `latestPriceTwd`、`Currency` upsert。

| code | rateToTwd |
|------|-----------|
| TWD | 1 |
| JPY | 0.22 |
| USD | 32.0 |
| HKD | 4.1 |
| EUR | 34.5 |

- [x] 5 個匯率資料（TWD / JPY / USD / HKD / EUR）
- upsert 採「只補不覆蓋」（`update: {}`），不降級環境上真實的新鮮匯率

---

## 快照與趨勢

| 卡 | 來源線 | 天數 | 筆數 | 其他 |
|----|--------|------|------|------|
| 1 | demoShopJp | 35 | 35 | 第 12 天插 isSuspicious（44,800 JPY） |
| 1 | demoShopJp2 | 35 | 35 | 與主線共用漲跌係數 |
| 2 | demoApiTw | 21 | 21 | — |
| 2 | demoShopHk | 13（到 8 天前） | 13 | 停用後中斷 |
| 3 | demoShopUs | 14 | 14 | — |
| 4 | demoApiJp | 4 | 4 | — |
| 5 | — | 0 | 0 | — |
| 6 | demoApiJp2 | 6 | 6 | — |

合計約 128 筆。固定序列、不用 `Math.random`；`fetchedAt` 固定當天 02:00；每筆都有 `priceTwd`。

- [x] 所有快照有台幣價格
- [x] 卡牌有趨勢線（卡1 / 2 / 3）
- [x] 快照數量正確

---

## Job 與 Log（4 筆）

| status | trigger | totalSources | success / failed | log 筆數 | 用途 |
|--------|---------|--------------|------------------|----------|------|
| running | manual | 28 | 0 / 0 | 0 | 「清除卡住的任務」按鈕 |
| success | cron | 27 | 27 / 0 | 27 | 那時卡5 尚未加入 |
| partial_success | cron | 28 | 27 / 1 | 28 | 卡5 fail 來源 |
| failed | manual | 28 | 0 / 28 | 28 | 全失敗 + errorMessage |

- [x] 1 筆成功 job
- [x] 1 筆失敗 job
- [x] 1 筆部分失敗 job
- [x] 1 筆 running job
- [x] log 數量正確（等於 totalSources；successCount / failedCount 對齊）

---

## 一致性檢查

- [x] 對齊卡牌 `latestPrice`、`latestCurrency`、`latestPriceTwd`、`lastFetchedAt`（等於該卡最新快照；卡5 全 null）
- [x] `PriceSource.lastSuccessAt`：成功來源 = 今天 02:00；停用來源 = 停用前時間；demoShopEu = null
- [x] `PriceSource.lastError`：只有 demoShopEu 有值

---

## 已知限制

1. **TCGPlayer 市場價格歷史圖**即時打外部 API，不吃資料庫。離線一定顯示「此卡牌無 TCGPlayer 歷史資料」。列表的 TCGPlayer 連結也只在 `cardNumber` 全為數字時出現。
2. **台幣趨勢圖**目前把多來源合併成單一條 Line。多來源趨勢線做好前，卡1 / 卡2 會呈現鋸齒；資料已按「每來源一條完整曲線」準備。demo 若在改版前，主推卡3 或卡4 看趨勢圖。
3. **持平 vs 無資料**：卡3 顯示「近 7 日 — 0%」，卡4 顯示「近 7 日 —」，講解時要點出差別。
4. **啟用來源只用 JPY / TWD**：mock adapter 的價格區間不分幣別，USD / HKD / EUR 只能放在停用或永遠失敗的來源。接上真實 adapter 後可解除。
5. **seed 含 1 筆 running job**：會擋住 `npm run job:once` / 後台手動更新（409）。demo 流程應先按「清除卡住的任務」，再觸發抓價，剛好展示 partial_success。
6. **匯率只補不覆蓋**：若環境已有真實匯率，seed 不會覆寫；快照的 `priceTwd` 仍用腳本內固定匯率換算。乾淨 demo 建議先 `npm run db:reset` 再 seed，讓 Currency 也吃到固定值。
