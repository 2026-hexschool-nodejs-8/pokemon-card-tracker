---
description: "Task list for 卡牌詳情頁多來源台幣價格趨勢圖"
---

# Tasks: 卡牌詳情頁多來源台幣價格趨勢圖

**Input**: Design documents from `/specs/001-price-trend-chart/`

**Prerequisites**: [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/](./contracts/)

**Tests**: 包含。plan.md 的「驗證策略」已明確採三層驗證，contracts 亦逐項定義測試案例。
單元測試用 `node --test`（既有工具，零新依賴）。

**Organization**: 依 user story 分階段，每個 story 可獨立實作、獨立驗證、獨立展示。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行執行（不同檔案、無未完成的相依）
- **[Story]**: 對應 spec.md 的 user story
- **🤖**: 以 chrome-devtools MCP 或 playwright MCP 驗證，非目視

## Path Conventions

Monorepo（npm workspaces）：`apps/web/src/`、`apps/api/src/`、`packages/db/prisma/`。
**所有指令從 repo 根目錄執行**（專案守則）。

---

## Phase 1: Setup

**Purpose**: 讓既有工具能跑前端測試。無需專案初始化 — repo 與依賴皆已就緒。

- [X] T001 在根目錄 `package.json` 的 scripts 新增 `test:web`，內容為 `node --test "apps/web/src/**/*.test.js"`（僅新增 script，不新增任何依賴）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 產生可用的示範資料。**目前資料庫 100% 的快照 `priceTwd` 為 `null`，沒有這一階段任何 story 都畫不出東西。**

**⚠️ CRITICAL**: 本階段未完成前，任何 user story 都無法驗證

- [X] T002 在 `packages/db/prisma/seed.js` 開頭加入匯率備援：檢查 `Currency` 表，為空則寫入涵蓋 USD／JPY／HKD／EUR 加 `TWD = 1` 的匯率，`source` 標為 `'seed-fallback'`，並印出提示執行 `npm run currency:once` 的警告（FR-027）
- [X] T003 改寫 `packages/db/prisma/seed.js` 的歷史快照迴圈：跑完每張卡的所有來源（不再只取 `sources[0]`）、第 n 個來源基準價乘 `1 + n * 0.18`、歷史拉長至 90 天、價格改隨機漫步 `prev * (1 + (rand - 0.5) * 0.06)` 並夾在 base 的 ±40% 內、以 `createMany` 一次寫入、依匯率一併計算 `priceTwd`（`Math.round(price * rate)`，**不 import `convertToTwd`**，見 research.md R8）（FR-026、FR-027、FR-028）
- [X] T004 執行 `npm run db:reset && npm run db:seed && npm run db:seed:admin && npm run job:once`，以 `npm run db:studio` 確認：`priceTwd` 不再大量為 `null`、皮卡丘 V 有兩個以上 provider 各涵蓋約 90 天

**Checkpoint**: 資料就緒，user story 可開始

---

## Phase 3: User Story 1 - 看懂一張卡的台幣價格走勢 (Priority: P1) 🎯 MVP

**Goal**: 卡牌詳情頁出現一張以日期為橫軸、台幣為縱軸、一天一格的趨勢圖，取代原本顯示不正確的「台幣價格趨勢」。

**Independent Test**: 開啟只有單一來源、具連續多日紀錄的卡牌（リザードン V），能看出該卡這幾天是漲是跌。

### Tests for User Story 1

> 先寫測試，確認失敗後再實作

- [X] T005 [US1] 建立 `apps/web/src/lib/priceSeries.test.js`，涵蓋：本地時區分桶不得跨日錯置（FR-009）、同日同來源取 `fetchedAt` 最大者（FR-006）、`priceTwd !== null` 嚴格過濾（FR-007）、日期骨架連續且起點為 `max(今日 - days + 1, 最早有資料日)`（FR-002、FR-012）、空輸入回 `{ series: [], points: [] }`、單日資料正常回傳（FR-020）（契約見 contracts/price-series-module.md C1～C5）

### Implementation for User Story 1

- [X] T006 [US1] 建立 `apps/web/src/lib/priceSeries.js`，實作 `buildDailySeries({ snapshots, tcgBuckets, days, now })` 的骨架產生（FR-002、FR-012）、本地日期分桶（FR-009）、同日去重（FR-006）、排除無台幣值的快照（FR-007）、缺值為 `null`（FR-008）、疑似異常寫入 `point.__suspicious[seriesKey]`（FR-021），並匯出 `RANGE_DAYS`、`TCG_MARKET_SERIES_KEY`、`TCG_MARKET_SERIES_LABEL` 常數（`tcgBuckets` 此階段可先忽略，US4 再接）
- [X] T007 [US1] 建立 `apps/web/src/components/PriceTrendChart.jsx`，props 為 `{ cardId, prices }`，以 recharts `LineChart` 繪製：日期橫軸、台幣縱軸含千分位、`connectNulls` 開啟、缺值日不標資料點（FR-001、FR-002、FR-008）
- [X] T008 [US1] 在 `apps/web/src/components/PriceTrendChart.jsx` 加入疑似異常呈現：`dot` 傳入函式依 `__suspicious` 回傳不同形狀，提示中標明該筆為疑似異常（FR-021、FR-022、FR-023）
- [X] T009 [US1] 在 `apps/web/src/components/PriceTrendChart.jsx` 加入空狀態：無快照顯示「尚無價格紀錄」；有快照但 `series` 為空時顯示使用者導向訊息，**不得含 `npm`、指令、檔案路徑或系統內部細節**（FR-018、FR-019、FR-020、SC-013）
- [X] T010 [US1] 修改 `apps/web/src/pages/CardDetailPage.jsx`：移除「台幣價格趨勢」`<Card>` 與 `twdChartData` / `hasTwd` 整形邏輯、移除 debug 用的 `console.log(cardRes, priceRes, summaryRes)`、改為渲染 `<PriceTrendChart cardId={id} prices={prices} />`。**此階段保留 TCGPlayer 那張圖不動**（US4 才移除，避免檢查點失去既有能力）
- [X] T011 [US1] 執行 `npm run test:web` 確認全數通過
- [X] T012 [US1] 🤖 瀏覽器驗證：リザードン V（單一來源）只畫一條線、ミュウツー GX（單日一筆）正常渲染、兩頁主控台皆無 error 等級訊息

**Checkpoint**: US1 可獨立展示 — 台幣趨勢圖已可用，且未失去任何原有能力

---

## Phase 4: User Story 2 - 比較不同來源的報價差異 (Priority: P2)

**Goal**: 同一張圖上每個來源各自一條線，能看出哪個來源開價較高、差距是否隨時間變化。

**Independent Test**: 開啟具兩個以上來源的卡牌（皮卡丘 V），線數與圖例名稱正確，且每條線的顏色與線型皆互異。

### Tests for User Story 2

- [X] T013 [US2] 在 `apps/web/src/lib/priceSeries.test.js` 補充：多來源時 `series` 排序為我方 provider 字母序在前、外部市場行情固定最後；`series` 僅含區間內實際有資料的來源；各來源缺值互不影響（契約 C7、C8）

### Implementation for User Story 2

- [X] T014 [US2] 在 `apps/web/src/lib/priceSeries.js` 實作 `series` 排序規則與 `SeriesDescriptor` 的 `key` / `label` / `isExternal` 欄位（FR-003、FR-029）
- [X] T015 [US2] 在 `apps/web/src/components/PriceTrendChart.jsx` 定義顏色盤與線型盤（至少 4 種可辨識樣式），依 `series` 索引分配，對每個 series 產生 `<Line>` 並同時設定 `stroke` 與 `strokeDasharray`（FR-003、FR-029）
- [X] T016 [US2] 在 `apps/web/src/components/PriceTrendChart.jsx` 加入內建 `<Legend />`；已於 research.md R2 驗證預設圖例會帶出 `strokeDasharray`，無須自訂 renderer（FR-004、FR-030）
- [X] T017 [US2] 在 `apps/web/src/components/PriceTrendChart.jsx` 完成多來源提示：列出該日各來源台幣價，`null` 者不列出（FR-005）
- [X] T018 [US2] 執行 `npm run test:web` 確認全數通過
- [X] T019 [US2] 🤖 瀏覽器驗證：讀取所有 `path.recharts-line-curve` 的 `stroke` 與 `stroke-dasharray`，斷言兩組值皆互異；讀圖例節點的 `stroke-dasharray` 並與對應線條比對（FR-029、FR-030）

**Checkpoint**: US1 與 US2 皆可獨立運作

---

## Phase 5: User Story 3 - 切換觀察區間 (Priority: P3)

**Goal**: 使用者可在 7 天／1 個月／3 個月之間切換，並在窄螢幕上得到合理的降級。

**Independent Test**: 依序切換三個區間，橫軸涵蓋範圍確實不同；視窗縮至 767px 以下時區間選項減為兩個。

### Tests for User Story 3

- [X] T020 [US3] 在 `apps/web/src/lib/priceSeries.test.js` 補充：`days` 為 7／30／90 時骨架長度正確；資料量少於區間時起點裁切至最早有資料日（契約 C4、FR-012）

### Implementation for User Story 3

- [X] T021 [US3] 在 `apps/web/src/components/PriceTrendChart.jsx` 加入 `days` 狀態（預設 7）與三顆區間鈕，標示「7 天／1 個月／3 個月」、實際長度 7／30／90 天，切換不重新載入頁面（FR-010、FR-011）
- [X] T022 [US3] 在 `apps/web/src/components/PriceTrendChart.jsx` 依區間調整呈現：`days <= 30` 顯示資料點、`days === 90` 關閉；橫軸設 `interval="preserveStartEnd"` 使長區間刻度不重疊（FR-013）
- [X] T023 [US3] 在 `apps/web/src/components/PriceTrendChart.jsx` 加入窄螢幕處理：以 `window.matchMedia('(max-width: 767px)')` 監聽（斷點沿用 Tailwind `md`），窄螢幕時只渲染 7 天與 30 天兩顆鈕；當前為 90 天而畫面轉窄時自動退回 30 天（FR-024、FR-025）
- [X] T024 [US3] 執行 `npm run test:web` 確認全數通過
- [X] T025 [US3] 🤖 瀏覽器驗證：（FR-025 的自動退回改列人工驗證，見 quickstart 說明）viewport 設 767px 後區間鈕為兩顆且不含「3 個月」；先在寬螢幕選 3 個月再改 viewport，確認退回「1 個月」且畫面不空白不報錯；90 天區間下 `.recharts-dot` 節點數為 0（FR-013、FR-024、FR-025）

**Checkpoint**: US1～US3 皆可獨立運作

---

## Phase 6: User Story 4 - 對照外部平台的市場行情價 (Priority: P4)

**Goal**: 把外部平台公布的市場行情換算成台幣，作為額外一條線與其他來源並列；同時完成兩張圖的合併。

**Independent Test**: 開啟已設定外部來源的卡牌（皮卡丘 V），圖上出現「TCGPlayer 市場價」線，與我方 `tcgplayer` 來源分列兩條。

### Tests for User Story 4

- [X] T026 [P] [US4] 在 `apps/api/src/services/card.service.test.js` 補充 `getTcgplayerPriceHistory` 的換算案例：匯率存在時 `marketPriceTwd` 為正確台幣整數、匯率不存在時整批為 `null` 且不 throw、`marketPrice` 為 `'0'` 時該筆為 `null`、外部請求失敗時維持既有回傳 `null` 的行為。外部 HTTP 以既有 `nock` 攔截（契約見 contracts/tcgplayer-history-response.md）
- [X] T027 [P] [US4] 在 `apps/web/src/lib/priceSeries.test.js` 補充：外部 bucket 依 `bucketStartDate` 對進骨架；粒度粗於一天時缺漏日期維持 `null` 且**不補值不插值**；`marketPriceTwd` 為 `null` 的 bucket 等同無資料；落在骨架範圍外的 bucket 被忽略（契約 C6、FR-031）

### Implementation for User Story 4

> **順序說明**：seed 與重建資料排在實作之前，讓 T030 起的每一步都有真實的外部市場行情資料可對照，
> 而不是等全部寫完才發現對不上。

- [X] T028 [US4] 在 `packages/db/prisma/seed.js` 為皮卡丘 V 新增 `{ type: 'crawler', provider: 'tcgplayer', externalId: '610969', currency: 'USD' }` 來源；**歷史快照迴圈需跳過 `provider === 'tcgplayer'`**，該來源的資料交由 `job:once` 實際抓取（research.md R8）（FR-028）
- [X] T029 [US4] 執行 `npm run db:reset && npm run db:seed && npm run db:seed:admin && npm run job:once` 重建含 tcgplayer 來源的資料，確認皮卡丘 V 出現 `provider: 'tcgplayer'` 的快照
- [X] T030 [US4] 在 `apps/api/src/services/card.service.js` 的 `getTcgplayerPriceHistory` 回傳前，讀取 `Currency` 中 `code: 'USD'` 的 `rateToTwd`，以既有的 `../lib/convertToTwd.js` 為每個 bucket 補上 `marketPriceTwd`；匯率缺漏或換算失敗一律為 `null` 且不 throw；診斷訊息寫入既有 logger，不回傳前台（FR-014、FR-016、FR-034）
- [X] T031 [US4] 在 `apps/web/src/lib/priceSeries.js` 併入 `tcgBuckets`：以 `TCG_MARKET_SERIES_KEY` 為 series key、值取 `marketPriceTwd`，並將 `quantitySold` 寫入 `point.__tcgQuantitySold`（FR-014、FR-017、FR-031）
- [X] T032 [US4] 在 `apps/web/src/components/PriceTrendChart.jsx` 取得外部市場行情：range 映射 `days <= 30` → `month`、`days === 90` → `quarter`；以 `useRef` 依 range 快取，命中則不發請求；`useEffect` 的 deps 用**映射後的 range** 而非 `days`（FR-032、SC-012）
- [X] T033 [US4] 在 `apps/web/src/components/PriceTrendChart.jsx` 確保非阻塞呈現：等待外部市場行情期間立即以已有來源繪製，**不得顯示載入指示**，資料到達後直接補入；取得失敗時照常呈現其餘來源（FR-016、FR-033）
- [X] T034 [US4] 在 `apps/web/src/components/PriceTrendChart.jsx` 的提示中加入外部市場行情成交量（有值時才顯示）（FR-017）
- [X] T035 [US4] 修改 `apps/web/src/pages/CardDetailPage.jsx`：移除「市場價格歷史」`<Card>`、`historyChartData` / `pctChange` / `history` / `historyLoading` 相關邏輯、`RANGES` 常數，以及 `ComposedChart` / `Bar` / `LineChart` 等不再使用的 recharts import（FR-014、SC-008）
- [X] T036 [US4] 執行 `npm run test:api` 與 `npm run test:web`，確認全數通過
- [X] T037 [US4] 🤖 瀏覽器驗證：反覆切換三個區間後，讀取網路請求清單並過濾外部網域，確認請求數 ≤ 2（SC-012）；確認「TCGPlayer 市場價」與我方 `tcgplayer` 為圖例上分列的兩條（FR-015）

**Checkpoint**: 四個 story 全數完成，兩張舊圖已合併為一張

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T038 [P] 更新 `apps/web/CLAUDE.md` 的「對應 PRD 畫面」段落，把 `CardDetailPage` 的描述改為單一多來源趨勢圖
- [X] T039 [P] 🤖 瀏覽器驗證 SC-004：同時讀取圖表資料節點與下方歷史價格表格列，程式比對圖上每個資料點的台幣數字都能在表格找到同日同來源的紀錄
- [X] T040 [P] 🤖 瀏覽器驗證 SC-013：清空 `Currency` 表並重跑 `npm run job:once` 後，取頁面文字斷言不含 `npm`、`run `、`.js`、`prisma` 等維運字串；驗畢以 `npm run currency:once && npm run job:once` 還原
- [X] T041 確認「歷史價格」表格與「匯出 CSV」行為與改動前完全相同（SC-008）
- [ ] T042 **（目視）** 將瀏覽器切換為灰階或開啟色覺模擬，確認每條線仍可區分 — 屬性互異不等於視覺可辨，此項必須人眼確認（SC-011）
- [ ] T043 依 [quickstart.md](./quickstart.md) 走完全部 8 個驗證情境，包含離線降級路徑

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 無相依，可立即開始
- **Phase 2 Foundational**: 相依 Phase 1；**阻擋所有 user story**（沒有 `priceTwd` 就沒有任何線可畫）
- **Phase 3～6 User Stories**: 皆相依 Phase 2
- **Phase 7 Polish**: 相依所有 story 完成

### User Story Dependencies

| Story | 可否獨立 | 說明 |
|---|---|---|
| US1 (P1) | ✅ 完全獨立 | Phase 2 完成後即可開始，不依賴其他 story |
| US2 (P2) | ⚠️ 建議接在 US1 之後 | 共用同一個元件與模組檔案；US1 的 `<Line>` 是 US2 擴充的基礎 |
| US3 (P3) | ⚠️ 建議接在 US1 之後 | 同上，需要 US1 的圖表骨架才有東西可切區間 |
| US4 (P4) | ⚠️ 建議接在 US2 之後 | 外部市場行情是「多來源」的一個特例，需要 US2 的 series 排序與線型分配 |

**注意**：本功能的四個 story 集中在同兩個檔案（`priceSeries.js`、`PriceTrendChart.jsx`），
因此**不建議多人平行開發不同 story** — 會產生大量衝突。
獨立性體現在「每個 story 完成後都能單獨展示與驗證」，而非「可同時施工」。

### Within Each User Story

- 測試先寫並確認失敗，再進實作
- 資料整形模組（`priceSeries.js`）先於圖表元件（`PriceTrendChart.jsx`）
- 元件完成後才接進頁面（`CardDetailPage.jsx`）
- 🤖 瀏覽器驗證放在該 story 的最後

### Parallel Opportunities

真正可平行的任務有限，因為多數任務落在同一個檔案：

- **T026 與 T027**：分屬 `apps/api` 與 `apps/web` 的不同測試檔，可平行
- **T038、T039、T040**：Polish 階段的文件與驗證，互不相干，可平行
- Phase 2 的 T002 與 T003 雖同檔但為前後段落，**建議依序**避免衝突

---

## Parallel Example: User Story 4

```bash
# 兩個測試檔分屬不同 workspace，可同時進行：
Task: "在 apps/api/src/services/card.service.test.js 補充 marketPriceTwd 換算案例"
Task: "在 apps/web/src/lib/priceSeries.test.js 補充外部 bucket 併入與不補值案例"
```

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + US1)

1. Phase 1 Setup（1 個任務）
2. Phase 2 Foundational（3 個任務）— **不可略過**，否則什麼都畫不出來
3. Phase 3 US1（8 個任務）
4. **停下來驗證**：リザードン V 與 ミュウツー GX 兩張卡，確認趨勢圖可讀且無主控台錯誤
5. 此時已可展示

**MVP 的重要性質**：US1 只移除了原本就顯示不正確的「台幣價格趨勢」圖，
**TCGPlayer 那張圖保留到 US4 才移除**。因此任何一個檢查點都不會失去既有能力，
合併是在 US4 一次完成的。

### Incremental Delivery

1. Setup + Foundational → 資料就緒
2. + US1 → 台幣趨勢可讀（MVP，可展示）
3. + US2 → 多來源比較可用（含無障礙編碼）
4. + US3 → 區間切換與窄螢幕降級
5. + US4 → 外部市場行情併入，兩圖合一，功能完整
6. + Polish → 文件、跨切驗證、目視確認

每一步都能單獨展示，且不破壞前一步。

### 團隊分工建議

**不建議依 story 拆給不同人平行做** — 四個 story 集中在同兩個檔案，會嚴重衝突。

較合理的切法：

- 一人負責前端主線（Phase 1、3、4、5 與 US4 的前端部分）
- 另一人可平行處理 Phase 2 的 seed 改寫與 US4 的後端換算（T030）與其測試（T026）

---

## Notes

- `[P]` = 不同檔案、無相依
- 每完成一個任務或一組邏輯相關的任務即可 commit
- 🤖 標記的任務需啟動 `npm run dev:api` 與 `npm run dev:web` 後才能執行
- 任一 checkpoint 都可停下來單獨驗證該 story
- **新增依賴數必須維持 0** — 使用者已指定「用現有的工具實作」
