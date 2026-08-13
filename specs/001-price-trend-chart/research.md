# Phase 0 — Research

**Feature**: 卡牌詳情頁多來源台幣價格趨勢圖
**Date**: 2026-08-10
**Constraint**: 用現有的工具實作，不新增任何依賴

---

## R1 — 純函式的自動化測試工具

**Decision**：使用 Node 內建的 `node --test`，於 `apps/web/src/lib/priceSeries.test.js`。

**Rationale**：
spec 的 Assumptions 寫「專案沒有前端自動化測試機制，本功能以人工驗證為主」。
這個假設在「不引入新框架」的前提下其實有解 —

- `apps/api` 的 `test` script 用的就是 `node --test`（不是 vitest），該工具已在專案中實際使用
- `apps/web/package.json` 已設 `"type": "module"`，`.js` 檔即為 ESM
- `priceSeries.js` 是純函式模組，不含 JSX、不 import React，`node --test` 可直接載入

**已實測驗證**：在 `apps/web/src/lib/` 放入探測用測試檔並執行 `node --test`，
結果 `pass 1 / fail 0`，確認可行。探測檔已刪除。

因此本功能的核心整形邏輯**可以有自動化測試**，不牴觸 spec 的假設（沒有引入新框架），
且直接滿足使用者「用現有的工具」的指定。UI 層行為仍以人工驗證。

**Alternatives considered**：
- 引入 vitest：需新增 dev 依賴，違反使用者指定
- 完全不測：spec 已指出這個函式的邊界（本地時區分桶、同日多筆、跨來源缺值）正是最該測的

**待辦**：需在根 `package.json` 增加一個執行前端測試的 script（僅新增 script，不新增依賴）。

---

## R2 — 圖例呈現線型（FR-030）

**Decision**：必須自訂 `<Legend content={...}>`，內建圖例做不到。

> **本節結論在實作階段被推翻，已更正。** 原先的判斷是：讀 recharts 原始碼看到
> `DefaultLegendContent.js:62` 有 `strokeDasharray: data.payload.strokeDasharray`，
> 因而認定內建圖例會帶出線型、無須自訂 renderer。
>
> **實際在瀏覽器驗證後不成立。** 內建圖例 icon 渲染出來是一個固定的「線+圓」glyph `<path>`，
> 只帶 `stroke` 與 `stroke-width`，**沒有 `stroke-dasharray`**。原始碼裡那行存在，
> 但預設 icon 的渲染路徑不會用到它。
>
> 教訓：讀原始碼能證明「程式碼裡有這個欄位」，不能證明「渲染結果會呈現它」。
> 這類 UI 契約要在真實 DOM 上驗。

**Rationale**：
FR-029 要求線條以顏色 + 線型雙重編碼，FR-030 進一步要求圖例也呈現線型 —
否則只靠線型分辨的使用者無法把圖例對應回圖上的線，等於沒有圖例。

自訂 renderer 從 `entry.payload.strokeDasharray` 取值，畫一段帶有相同顏色與線型的短線。
已於瀏覽器驗證：圖例每一項的 `stroke` 與 `stroke-dasharray` 都與對應線條完全一致。

**版本注意**：`apps/web/package.json` 宣告 `recharts: ^2.13.0`，
但實際安裝解析為 **2.15.4**。本結論以實際安裝版本為準。

**Alternatives considered**：內建 `<Legend />`（實測無法滿足 FR-030）

---

## R3 — 窄螢幕偵測（FR-024、FR-025）

**Decision**：以 `window.matchMedia` 監聽，斷點沿用 Tailwind 的 `md`（768px），
即窄螢幕條件為 `(max-width: 767px)`。

**Rationale**：
FR-024／FR-025 要求的不只是視覺變化，而是**改變可選的區間集合**並在縮窄時自動退回，
這屬於元件狀態邏輯，純 CSS 做不到，必須有 JS 判斷。

`matchMedia` 是瀏覽器原生 API，零依賴。斷點沿用 Tailwind 既有的 `md`，
與頁面其他響應式行為（`CardDetailPage` 已用 `md:flex-row`）保持一致，
符合 spec Assumptions「窄螢幕判定沿用專案既有的響應式斷點慣例」。

**Alternatives considered**：
- 監聽 `resize` 事件自行比對寬度：需自行節流，`matchMedia` 的 change 事件更精準且成本低
- 用 CSS 隱藏 90 天按鈕：無法滿足 FR-025 的「自動退回 30 天」，且被隱藏的狀態仍可能生效

---

## R4 — 疑似異常資料點的形狀標示（FR-022）

**Decision**：對 `<Line>` 的 `dot` 傳入函式，依該點 payload 的異常旗標回傳不同的 SVG 形狀。

**Rationale**：
FR-022 明確要求「以形狀區分，MUST NOT 僅依賴顏色」。recharts 的 `dot` 屬性接受
函式或 React element，函式會收到含 `payload` 的 props，可據此決定形狀。

這需要 `points` 中每個資料點帶有該來源當日是否為疑似異常的資訊 —
已反映在 `contracts/price-series-module.md` 的輸出結構中。

**Alternatives considered**：
- 額外疊一層 `<Scatter>` 只畫異常點：需要多一個圖層與資料集，且在 `LineChart` 中混用 Scatter 會使
  tooltip 與圖例出現多餘項目

---

## R5 — 外部市場行情的取得與快取（FR-032、FR-033）

**Decision**：以元件內的 `useRef` 物件做快取，key 為映射後的外部 range
（`month` / `quarter`），值為該次取得的結果。切換區間時先查快取，命中則不發請求。

**Rationale**：
FR-032 要求「每種資料粒度最多取得一次」。7 天與 30 天都映射到 `month`，
所以 7↔30 切換本來就不該重打；90 天映射到 `quarter`。整個瀏覽期間上限為 2 次請求。

用 `useRef` 而非 `useState` 是因為快取寫入不應觸發重繪。

FR-033 要求不顯示載入指示、已有資料先畫 — 因此外部市場行情以獨立的非阻塞流程取得，
到達後併入既有的資料流，圖表在等待期間照常呈現我方來源。

**Alternatives considered**：
- 後端加快取層：spec 的 Q3 已裁示採前端層級處理，避免擴大本次範圍
- 每次切換都重取：牴觸 FR-032 與 PRD 十九章「不要高頻打爆來源網站」

---

## R6 — 外部市場行情的 range 映射

**Decision**：`days <= 30` → `month`；`days === 90` → `quarter`。

**Rationale**：先前對 `infinite-api.tcgplayer.com` 三個 range 的實測結果：

| range | bucket 數 | 粒度 |
|---|---|---|
| `month` | 30 | 每天一格 |
| `quarter` | 30 | 每 3 天一格 |
| `annual` | 52 | 每 7 天一格 |

只有 `month` 對得上 FR-002 的「一天一格」。90 天只能用 `quarter`，
其每 3 天一筆的特性由 FR-031 規範（只標實際有資料的日期、不補值）。

7 天不需特別裁切：日期骨架 join 時自然只取到 7 天內的 bucket。

**Alternatives considered**：90 天改用 `annual`（粒度更粗，7 天一格，失真更嚴重）

---

## R7 — 顏色與線型的穩定分配（FR-029）

**Decision**：series 先排序（我方 provider 依字母序在前、外部市場行情固定最後），
再依索引取用固定的顏色盤與線型盤。

**Rationale**：
排序確保同一張卡的顏色與線型在重繪之間穩定，不會因為 series 陣列順序變動而跳色。
外部市場行情固定排最後，讓它在任何卡牌上都拿到同一組視覺樣式，便於使用者跨卡牌辨識。

線型盤需至少 4 種可辨識的樣式（實線、長虛線、短虛線、點線），
對應本功能最多同時出現的 series 數。

**Alternatives considered**：以 provider 名稱雜湊決定顏色（同一張卡穩定，但跨卡不一致且可能撞色）

---

## R8 — 示範資料的產生（FR-026、FR-027、FR-028）

**Decision**：`seed.js` 自行計算 `Math.round(price * rate)`，不 import `convertToTwd`；
歷史涵蓋 90 天、跑完每張卡的所有 mock 來源、價格採隨機漫步。

**Rationale**：
`convertToTwd` 位於 `apps/api/src/lib/`。`packages/db` 去依賴 `apps/api` 是反向依賴，
會讓資料層綁死在應用層上。換算規則本身只有一行乘法加四捨五入，複製的成本遠低於跨套件重構。

FR-027 要求 seed 不得依賴外部匯率服務，因此 seed 先讀 `Currency` 表，
若為空則寫入標記為 `seed-fallback` 的備援匯率並印出警告，
確保 `db:reset && db:seed` 之後資料即完整。

**示範資料的具體要求**：

| 現行 seed 的問題 | 調整 | 對應 FR |
|---|---|---|
| 歷史只灌 8 天 → 三個區間看起來一樣 | 灌 90 天，讓 7／30／90 各有差異 | FR-026 |
| 歷史迴圈只取 `sources[0]` → 沒有任何卡有兩條完整來源線 | 跑完每張卡的所有來源，第 n 個來源基準價乘 `1 + n * 0.18` 製造價差 | FR-028 |
| 無任何 `tcgplayer` 來源 → 外部市場行情線永遠不出現，無法驗證 | 為皮卡丘 V 加入 `provider: 'tcgplayer'`、`externalId: '610969'`（已實測確有 90 天歷史） | FR-028 |
| 逐筆 `await create`，90 天 × 4 線 = 360 次來回 | 改用 `createMany` | — |
| 每日獨立取亂數 → 90 天是純雜訊，看不出趨勢 | 改隨機漫步 `price = prev * (1 + (rand - 0.5) * 0.06)`，夾在 base 的 ±40% 內 | FR-026 |
| 完全不算 `priceTwd` | 依匯率一併寫入 | FR-027 |

**tcgplayer 來源不灌假歷史**：該來源的價值在於展示真實外部來源，由 `job:once` 實際抓取即可。
灌假的美金歷史會與同一張圖上真實的「TCGPlayer 市場價」線互相矛盾。
它在圖上只會有當日單點，這是預期行為。

**Alternatives considered**：
- 把 `convertToTwd` 移到 `packages/shared`：跨套件重構，超出本功能範圍（spec「不做」章節已明列）
- seed 呼叫匯率 API：牴觸 FR-027
- 維持 8 天歷史：FR-026 無法滿足，3 個月區間在 Demo 時是空的

---

## 未解決項目

無。Technical Context 中沒有 NEEDS CLARIFICATION 項目。

spec 中兩項 Outstanding（縱軸線性刻度的限制、資料量界線）皆為使用者明確裁示接受的取捨，
非未決事項，已記錄於 spec 的 Assumptions。
