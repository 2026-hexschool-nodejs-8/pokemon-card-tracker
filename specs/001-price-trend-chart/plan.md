# Implementation Plan: 卡牌詳情頁多來源台幣價格趨勢圖

**Branch**: `feature/chart-adjust`（spec 目錄 `001-price-trend-chart`）| **Date**: 2026-08-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-price-trend-chart/spec.md`

**User constraint**: 用現有的工具實作 — 不新增任何 runtime 或 dev 依賴。

## Summary

把卡牌詳情頁現有的兩張圖（TCGPlayer 市場價格歷史、台幣價格趨勢）合併成單一「價格趨勢」圖：
橫軸為日期一天一格、縱軸為台幣、每個價格來源各自一條線，並可在 7／30／90 天三個區間切換。

技術路線是把「資料整形」與「圖表呈現」拆成兩個單元：一個不碰 React 的純函式模組負責日期分桶、
同日去重、缺值處理與外部市場行情併入；一個 React 元件只負責畫圖與管理區間狀態。
後端只動一處 — 讓 TCGPlayer 歷史端點回傳時附上台幣換算值，因為匯率只存在於後端。

全部使用專案既有工具：recharts 2.13 畫圖、Node 內建 `node --test` 測純函式與後端、
Tailwind 既有斷點判斷窄螢幕。**新增依賴數：0**。

## Technical Context

**Language/Version**: JavaScript (ESM)、Node.js v24.11.1

**Primary Dependencies**: React 18.3、Vite 5.4、recharts 2.13、Tailwind 3.4、shadcn/ui（前端）；
Express、Prisma、PostgreSQL（後端）。本功能**不新增任何依賴**。

**Storage**: PostgreSQL via Prisma。本功能不改 schema、不需 migration。

**Testing**: `node --test`（Node 內建 test runner，`apps/api` 既有用法）。
`apps/api` 另有 nock、supertest 可用。
前端 UI 行為以**瀏覽器自動化驗證**為主、人工目視為輔 — 見下方「驗證策略」。

**Target Platform**: 瀏覽器（桌機與行動裝置）+ Node 後端

**Project Type**: npm workspaces monorepo（web 前端 + api 後端 + 共用套件）

**Performance Goals**: 單次瀏覽對外部服務的請求數不超過資料粒度種類數（SC-012，即最多 2 次）。

切換區間的回應速度**不列為可測量指標** — 圖表不發新請求、純在前端切分已載入資料，
預期即時；spec 已將其降級為假設（見 spec.md Assumptions）。

**Constraints**:

- 不新增 runtime／dev 依賴（使用者指定）
- 不新增後端端點（spec「不做」章節）
- 不改動歷史價格表格與 CSV 匯出（SC-008）
- `packages/db` 不得依賴 `apps/api`（反向依賴）

**Scale/Scope**: 共 8 個檔案 — 新增 3 個（`priceSeries.js`、`priceSeries.test.js`、`PriceTrendChart.jsx`）、
修改 5 個（根 `package.json`、`CardDetailPage.jsx`、`card.service.js`、`card.service.test.js`、`seed.js`）。
其中測試檔 2 個。本次不設資料量上限（spec Assumptions 已裁示）。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**狀態：無法正式檢核 — `.specify/memory/constitution.md` 仍是未填寫的樣板**

該檔內容全為 `[PRINCIPLE_1_NAME]`、`[GOVERNANCE_RULES]` 等佔位符，沒有任何實質原則可評估。

**處置**：本次以專案既有的成文規範代替憲章把關 — 根目錄 `CLAUDE.md` 與
`apps/api/CLAUDE.md`、`apps/web/CLAUDE.md` 的開發守則：

| 專案守則 | 符合 | 說明 |
|---|---|---|
| 所有 API 請求走 `lib/api.js`，不在元件散落 fetch | ✅ | 沿用既有 `getCardPrices` / `getPriceHistory`，不新增呼叫點 |
| route 不寫業務邏輯，邏輯放 `services/` | ✅ | 後端唯一改動落在 `card.service.js`，route 不動 |
| 驗證邏輯寫在 `packages/shared` 的 Zod schema | ✅ | 本功能無新增輸入驗證，不涉及 |
| 價格一律經 `normalizePrice` 清洗 | ✅ | 不新增抓價路徑，沿用既有清洗結果 |
| 路徑別名 `@/` → `src/` | ✅ | 新檔案沿用 |
| 機密只放 `.env`，不進版控 | ✅ | 不涉及 |

**Post-Phase 1 re-check**：見本檔末「Phase 1 後複查」。

**建議**：後續可跑 `/speckit-constitution` 把上述守則正式化，讓往後的功能有真正的治理把關。
本次不阻擋，但這是既有的流程缺口，應被記錄。

## 驗證策略

三層，由確定性高到低排列。**不新增任何專案依賴** — 第二層由開發階段的 MCP 工具驅動，
不產生需要維護的測試程式碼。

### 第 1 層：單元測試（`node --test`）

涵蓋 `priceSeries.js` 的整形邏輯與後端的台幣換算。可重複執行、進 CI。
契約見 [contracts/price-series-module.md](./contracts/price-series-module.md)。

### 第 2 層：瀏覽器自動化驗證（MCP）

用 chrome-devtools MCP 或 playwright MCP 驅動實際頁面。
**價值在於把數項「肉眼驗不準」的驗收變成確定性檢查**：

| 驗收項目 | 肉眼的問題 | 自動化怎麼驗 | 對應 |
|---|---|---|---|
| 反覆切換區間，對外部服務請求 ≤ 2 次 | 根本看不到 | 讀取網路請求清單，過濾外部網域後計數 | SC-012、FR-032 |
| 每條線同時以顏色與線型區分 | 兩種相近虛線難以目視分辨 | 讀 SVG path 的 `stroke` 與 `stroke-dasharray` 屬性，斷言兩者皆互異 | FR-029 |
| 圖例 icon 帶有線型 | 圖示很小，不易確認 | 讀圖例 SVG 節點的 `stroke-dasharray`，比對對應線條 | FR-030 |
| 窄螢幕只剩兩個區間鈕 | 需手動拖曳視窗 | 設定 viewport 寬度後計數按鈕 | FR-024 |
| 選 90 天後縮窄自動退回 30 天 | 需手動拖曳並觀察 | 先點 90 天，改 viewport，再讀當前選取狀態 | FR-025 |
| 換算失敗訊息不含維運指令 | 容易漏看 | 取頁面文字，斷言不含 `npm`、`run`、指令樣式字串 | FR-019、SC-013 |
| 圖上數值對得上下方表格 | 需逐筆比對 | 同時讀圖表資料節點與表格列，程式比對 | SC-004 |
| 90 天區間不顯示資料點 | 點很小 | 計算該區間下 dot 節點數應為 0 | FR-013 |
| 頁面無主控台錯誤 | 不會主動去看 | 讀取 console 訊息，斷言無 error | FR-016、FR-020 |

執行時機：實作完成後、`/speckit-implement` 收尾前，以及任何改動圖表後的回歸確認。

### 第 3 層：人工目視

保留給自動化不適合判斷的部分 — 整體可讀性、色彩觀感、
以及灰階／色覺模擬下的實際辨識度。清單見 [quickstart.md](./quickstart.md)。

### 為何不寫 E2E 測試套件

`playwright` **已經是 `apps/api` 的既有依賴**（爬蟲用），所以要建committed E2E 套件，
套件本身不必新裝。但那需要新增設定、fixture、CI 流程與長期維護成本，
屬於獨立的基礎建設議題，不應綁在這次的圖表改動裡。

本次採 MCP 驅動的一次性驗證：拿到同樣的確定性，但不留下需要維護的資產。
若日後要把第 2 層固化成 CI 的一部分，上表的檢查項目可直接轉寫為 Playwright 測試。

## Project Structure

### Documentation (this feature)

```text
specs/001-price-trend-chart/
├── plan.md              # 本檔
├── research.md          # Phase 0 產出
├── data-model.md        # Phase 1 產出
├── quickstart.md        # Phase 1 產出
├── contracts/           # Phase 1 產出
│   ├── price-series-module.md
│   ├── price-trend-chart-component.md
│   └── tcgplayer-history-response.md
├── checklists/
│   └── requirements.md  # /speckit-specify 產出
└── tasks.md             # /speckit-tasks 產出（本指令不建立）
```

### Source Code (repository root)

```text
package.json                    # 修改：新增 test:web script（不新增依賴）

apps/web/src/
├── lib/
│   ├── priceSeries.js          # 新增：純函式資料整形
│   ├── priceSeries.test.js     # 新增：node --test
│   └── api.js                  # 不改動
├── components/
│   └── PriceTrendChart.jsx     # 新增：圖表元件
└── pages/
    └── CardDetailPage.jsx      # 修改：移除兩張舊圖，改用新元件

apps/api/src/
├── services/
│   ├── card.service.js         # 修改：getTcgplayerPriceHistory 補 marketPriceTwd
│   └── card.service.test.js    # 修改：補換算 case
└── lib/
    └── convertToTwd.js         # 不改動（被 card.service 引用）

packages/db/prisma/
└── seed.js                     # 修改：匯率 fallback、全來源、90 天、隨機漫步、priceTwd、tcgplayer 來源
```

**Structure Decision**：沿用既有 monorepo 分層，不新增目錄層級。

資料整形放 `apps/web/src/lib/` 而非 `packages/shared`，因為它是**展示層的整形邏輯**
（日期分桶、視覺用的缺值表示），只有前端會用；放進共用套件會讓後端揹上不需要的概念。

後端改動刻意收斂在 `card.service.js` 單一函式內：匯率換算是後端才有能力做的事
（前端拿不到 `Currency` 表），但它不構成新的業務流程，因此不新增 service 檔案。

## Complexity Tracking

> Constitution Check 因憲章未填寫而無法正式評估，下表記錄本計畫中需要說明理由的設計選擇。

| 選擇 | 為何需要 | 被否決的簡單做法及原因 |
|---|---|---|
| 新增 `priceSeries.js` 而非寫在元件內 | 分桶邏輯含本地時區、同日去重、缺值、外部市場行情併入等多個邊界，且 `CardDetailPage.jsx` 已 376 行 | 全寫在元件內：檔案破 450 行，且純函式無法用 `node --test` 單獨驗證 |
| 新增 `PriceTrendChart.jsx` 元件 | 圖表自帶區間狀態、外部市場行情快取與窄螢幕偵測，是一個完整的狀態單元 | 寫在頁面內：頁面需同時管理三種不相干狀態，難以獨立推理 |
| 後端補 `marketPriceTwd` | 匯率只存在於後端 `Currency` 表，前端無從取得 | 前端自行換算：需新端點或把匯率塞進其他回應，兩者都比改一個既有函式大 |
| seed 自行計算台幣而不共用 `convertToTwd` | `packages/db` 依賴 `apps/api` 是反向依賴 | 把 `convertToTwd` 搬進 `packages/shared`：為共用一行乘法做跨套件重構，代價大於收益 |

## Phase 1 後複查

**Constitution Check（以專案守則代行）**：Phase 1 設計完成後重新比對，上表六項全數維持 ✅。
設計過程未引入任何新的 fetch 呼叫點、未在 route 加入邏輯、未新增依賴。

**與 spec 的一致性**：`contracts/` 三份契約已逐條對應 FR-001～FR-034，無遺漏、無超出。

**Phase 0 消除的兩項風險**（皆經實測，非推測）：

- FR-030（圖例需呈現線型）原本疑慮 recharts 預設圖例只畫顏色。
  實際檢視安裝版原始碼確認 `DefaultLegendContent.js:62` 會傳遞 `strokeDasharray`，
  內建圖例即可滿足，不需自訂 renderer。
- 前端純函式原本預期無法自動化測試。實測確認 `node --test` 可直接執行
  `apps/web` 的 ESM 測試檔，因此核心整形邏輯將有測試覆蓋。

**版本更正**：`apps/web/package.json` 宣告 `recharts: ^2.13.0`，實際安裝解析為 **2.15.4**。
本計畫的 recharts 相關結論以 2.15.4 為準。

**新增依賴數：0** — 符合使用者「用現有的工具實作」的指定。
唯一新增的是根 `package.json` 的一個測試 script（不含任何新套件）。
