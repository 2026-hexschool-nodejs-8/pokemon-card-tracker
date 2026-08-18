---
description: "Task list for 後台卡片與來源管理總覽頁"
---

# Tasks: 後台卡片與來源管理總覽頁

**Input**: Design documents from `/specs/001-card-source-management/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/admin-overview-api.md, quickstart.md

**Tests**: 本 feature 不產生自動化測試任務，前後端一律以 `quickstart.md` 的手動情境驗收。
（原訂納入後端 `node:test` 契約測試，實作後評估投入產出不成比例，已移除相關任務與測試檔。）

**Organization**: 依 User Story 分組，每個 story 可獨立實作與驗收。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行（不同檔案、無未完成相依）
- **[Story]**: US1 / US2 / US3，對應 spec.md 的 User Story
- 每個任務都標明確切檔案路徑

## Path Conventions（本專案 monorepo）

- 後端：`apps/api/src/`
- 前端：`apps/web/src/`
- 共用 schema：`packages/shared/schemas/`
- 所有指令自 **repo 根目錄**執行；新增依賴指定 workspace（`-w @pct/web`）

---

## Phase 1: Setup（共用基礎）

**Purpose**: 引入本頁唯一的新前端依賴（Accordion 元件）

- [X] T001 [P] 以 shadcn CLI 新增 Accordion 元件：自 repo 根目錄執行 `npx shadcn@latest add accordion`（作用於 `apps/web`），產生 `apps/web/src/components/ui/accordion.jsx` 並確認 `@radix-ui/react-accordion` 已加入 `apps/web` 依賴（research §4）

---

## Phase 2: Foundational（阻擋所有 User Story 的前置）

**Purpose**: 建立本頁的頁面外殼、路由與存取守衛；US1/US2/US3 都掛在這頁上

**⚠️ CRITICAL**: 本階段完成前，任何 User Story 都無法在頁面上呈現

- [X] T002 建立總覽頁外殼元件（頁面標題 + 篩選列 / 清單 / 狀態區的佔位版面，暫不接資料）於 `apps/web/src/pages/admin/AdminOverviewPage.jsx`
- [X] T003 於 `apps/web/src/App.jsx` 註冊受保護路由 `/admin/overview`（沿用 `lib/auth.js` 的 `isLoggedIn()` 守衛，未登入 / token 過期導向 `/admin/login`）並於後台導覽加入「卡片總覽」連結（FR-001、research §9）（相依 T002）

**Checkpoint**: 已登入管理者可進入 `/admin/overview` 空白頁，未登入被導向登入頁

---

## Phase 3: User Story 1 - 一目了然檢視所有卡片與其來源（Priority: P1）🎯 MVP

**Goal**: 以 Accordion + 無限滾動列出所有卡片摘要，點開卡片才延遲載入其來源明細

**Independent Test**: 登入後開啟總覽頁看到第一批卡片摘要；向下捲動接續載入；點開任一卡片才發出來源請求並顯示明細；收合再展開不重複請求

### Backend

- [X] T004 [P] [US1] 擴充 `adminListCardsQuerySchema`：新增 `cursor`（string cuid, optional）與 `limit`（字串轉正整數、預設 20、上限 50），既有 `keyword`/`language`/`grade`/`isActive` 不變，於 `packages/shared/schemas/card.schema.js`（data-model 驗證規則、contract Query 參數）
- [X] T005 [US1] 為 `GET /admin/cards` 加 cursor 分頁於 `apps/api/src/routes/admin.cards.js`：解析新 query，Prisma `take: limit` + `cursor: { id: cursor }` + `skip: 1`（有帶 cursor 時）、`orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`、沿用 `include: { _count: { select: { sources: true } } }`，回應改為加法式 `{ data, nextCursor }`（最後一批 `nextCursor: null`）（research §1、contract）（相依 T004）

### Frontend

- [X] T006 [P] [US1] 在 `apps/web/src/lib/api.js` 新增 `adminGetCards({ cursor, limit, keyword, language, grade, isActive })` 與 `adminGetCardSources(cardId)`（回傳 `{ data, nextCursor }` / `{ data }`，帶 JWT header）
- [X] T007 [P] [US1] 卡片摘要列元件於 `apps/web/src/pages/admin/components/CardRow.jsx`：顯示卡名、卡號、系列（`setName`）、語言、狀態別（`condition`）、追蹤狀態徽章（`isActive`）、來源數量（`_count.sources`，全部來源含停用）、最新價（`latestPrice`+`latestCurrency`）、最後更新時間（`lastFetchedAt`）；`latestPrice`/`lastFetchedAt` 為 null 顯示「—」（FR-002、research §8）
- [X] T008 [P] [US1] 來源明細元件於 `apps/web/src/pages/admin/components/SourceList.jsx`：顯示每個來源的類型（api/crawler）、名稱（`provider`）、幣別、使用狀態（`isActive`）、最後成功時間（`lastSuccessAt`）、最後錯誤（`lastError`）；空來源顯示「尚無來源」空狀態（FR-005、Acceptance US1-5）
- [X] T009 [US1] 在 `apps/web/src/pages/admin/AdminOverviewPage.jsx` 實作清單主體：shadcn Accordion（`type="multiple"`）渲染 `CardRow`；`IntersectionObserver` 監看底部 sentinel 觸發下一批（依 `nextCursor`，`null` 顯示「已到底」並停止觀察）；Accordion 首次展開才 `adminGetCardSources` 並以元件 state 記憶（重複展開不重抓，FR-004）；提供「載入中 / 載入更多中 / 已到底 / 查無資料 / 來源載入失敗可重試」視覺狀態（FR-003/FR-013、research §2）（相依 T005/T006/T007/T008）

**Checkpoint**: US1 可獨立驗收——首屏卡片、無限滾動、延遲載入來源皆運作

---

## Phase 4: User Story 2 - 精準開關卡片追蹤與來源使用（Priority: P1）

**Goal**: 同頁切換卡片「追蹤」與來源「使用」開關（樂觀更新 + 失敗還原）；關閉最後一個啟用來源時走確認 modal 與交易連動；明確標示兩層開關關係

**Independent Test**: 切換卡片追蹤 / 來源使用開關重整後仍持久；關閉非最後來源不跳 modal 且不動卡片；關閉最後啟用來源跳 modal，確認後來源與卡片同時停用；卡片追蹤關閉時來源區明確標示「不會被抓取」

### Backend

- [X] T010 [US2] 新增交易端點 `PATCH /admin/sources/:id/deactivate-last` 於 `apps/api/src/routes/admin.cards.js`：於單一 `prisma.$transaction` 內**先防呆守衛**——查該來源（不存在回 `404`）並計數所屬卡 `isActive=true` 的來源數，僅當「該來源當前啟用且該卡啟用來源數為 1」才續行，否則整筆不變更、回 `409`；續行則 `priceSource.update({ isActive:false })` 再 `card.update({ where:{ id: source.cardId }, data:{ isActive:false } })`，回應 `{ data: { source, card } }`（FR-015/FR-016、research §5、contract）

### Frontend

- [X] T011 [P] [US2] 在 `apps/web/src/lib/api.js` 新增 `adminToggleCard(id, isActive)`（`PATCH /admin/cards/:id`）、`adminToggleSource(id, isActive)`（`PATCH /admin/sources/:id`）、`adminDeactivateLastSource(id)`（`PATCH /admin/sources/:id/deactivate-last`）
- [X] T012 [P] [US2] 確認 modal 元件於 `apps/web/src/pages/admin/components/ConfirmModal.jsx`：警告「關閉後這張卡片將沒有任何啟用中來源、價格不再更新」，提供「確認 / 取消」（FR-015）
- [X] T013 [US2] 卡片追蹤開關：於 `AdminOverviewPage.jsx` 實作樂觀更新 + 失敗還原 handler（呼叫 `adminToggleCard`）並將開關 prop 接入 `CardRow.jsx`；快速連點以最後一次為準（FR-006/FR-012、research §6）
- [X] T014 [US2] 來源使用開關：於 `AdminOverviewPage.jsx` 依該卡已載入來源清單判定是否為「最後一個啟用來源」——是則開 `ConfirmModal`→確認後 `adminDeactivateLastSource`（同步更新該卡 `isActive=false`），否則 `adminToggleSource`；一律樂觀更新 + 失敗還原（連動失敗時來源與卡片一併還原）；在 `SourceList.jsx` 當該卡 `isActive===false` 時顯示「此卡片追蹤已關閉，來源不會被抓取」標示（FR-007/FR-008/FR-012/FR-015/FR-016/FR-017、research §5/§6）（相依 T010/T011/T012）

**Checkpoint**: US1 + US2 皆可獨立運作；兩層開關與最後來源連動符合 SC-004/SC-008

---

## Phase 5: User Story 3 - 篩選卡片與來源資訊（Priority: P2）

**Goal**: 卡片層篩選（後端既有參數）條件變更即重載第一批；來源層篩選於已載入清單前端過濾

**Independent Test**: 套用卡片篩選後清單自第一批重載只顯示符合者；展開卡片內套用來源類型 / 使用狀態篩選只顯示符合來源；無符合時顯示空狀態

- [X] T015 [US3] 卡片層篩選控制項於 `apps/web/src/pages/admin/AdminOverviewPage.jsx`：關鍵字、語言、狀態別（`grade`→`condition`）、追蹤狀態（全部 / 僅追蹤中 / 僅停用）；任一條件變更時清單重置並不帶 `cursor` 自第一批重載（重用 `adminGetCards` 既有參數，後端無需改動）；以 `AbortController` / 請求序號捨棄過期批次結果（stale-response guard）；無符合顯示「查無符合條件的卡片」空狀態；實作時於狀態別控制項加一行註解點出 `grade` 參數對應 DB `condition` 欄位（I1）（FR-009/FR-011、research §7、Edge Case）
- [X] T016 [P] [US3] 來源層前端篩選於 `apps/web/src/pages/admin/components/SourceList.jsx`：對已載入來源清單依類型（api/crawler）與使用狀態（全部 / 僅使用中 / 僅停用）過濾，不重新抓取；（可選）於 `packages/shared/schemas/source.schema.js` 定義來源篩選共用常數供前端使用（FR-010、data-model 驗證規則）

**Checkpoint**: 三個 User Story 皆可獨立驗收

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T017 依 `specs/001-card-source-management/quickstart.md` 逐項手動驗收情境 A（檢視）/ B（兩層開關）/ C（篩選）/ D（存取控制），對照 SC-001～SC-008
- [X] T018 [P] Constitution 符合性複查：確認 `GET /admin/cards` 為加法式擴充未破壞既有消費者、無 Prisma migration、`adapters/` 與 `normalizePrice` 未更動、抓價 job 挑選邏輯未改（FR-014、plan Constitution Check）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**: 無相依，可立即開始
- **Foundational（Phase 2）**: 依賴 Setup；阻擋所有 User Story
- **User Stories（Phase 3-5）**: 皆依賴 Foundational 完成後才可開始
  - 可平行（若人力足夠）或依優先序 P1（US1）→ P1（US2）→ P2（US3）
- **Polish（Phase 6）**: 依賴目標 User Story 完成

### User Story Dependencies

- **US1（P1）**: Foundational 後即可開始，無跨 story 相依 → MVP
- **US2（P1）**: 需 US1 產出的 `CardRow.jsx` / `SourceList.jsx` / `AdminOverviewPage.jsx` 清單與 `lib/api.js` 作為接掛點（開關掛在已呈現的卡片與來源上）
- **US3（P2）**: 需 US1 的清單與 `SourceList.jsx`；篩選作用於既有清單，不阻擋 US2

### Within Each User Story

- 共用 schema → 後端 route
- `lib/api.js` 封裝 → UI 子元件 → `AdminOverviewPage` 組裝
- 同一檔案的任務不可平行

### Parallel Opportunities

- **Phase 1**: T001 可獨立進行
- **US1 後端**: T004（schema）完成後 T005（route）
- **US1 前端**: T006（api.js）/ T007（CardRow）/ T008（SourceList）三個不同檔案可平行，之後 T009 組裝
- **US2**: T011（api.js）/ T012（ConfirmModal）為不同檔案可平行；T013、T014 皆改 `AdminOverviewPage.jsx`，需序列
- **US3**: T015（AdminOverviewPage）與 T016（SourceList）為不同檔案可平行
- **跨 story 注意**: US1 與 US2 都會改 `apps/web/src/lib/api.js`、`CardRow.jsx`、`SourceList.jsx`、`AdminOverviewPage.jsx`，若不同人平行需協調合併

---

## Parallel Example: User Story 1

```bash
# US1 後端 schema 完成後，前端三個獨立檔案可平行：
Task: "adminGetCards / adminGetCardSources in apps/web/src/lib/api.js"          # T006
Task: "CardRow 摘要列 in apps/web/src/pages/admin/components/CardRow.jsx"        # T007
Task: "SourceList 來源明細 in apps/web/src/pages/admin/components/SourceList.jsx" # T008

# 後端 route 可與上述前端檔案並行推進：
Task: "GET /admin/cards cursor 分頁 in apps/api/src/routes/admin.cards.js"       # T005
```

---

## Implementation Strategy

### MVP First（僅 User Story 1）

1. Phase 1 Setup（Accordion）
2. Phase 2 Foundational（頁面外殼 + 路由 + 守衛）
3. Phase 3 User Story 1（檢視 + 無限滾動 + 延遲載入來源）
4. **STOP & VALIDATE**：以 quickstart 情境 A 獨立驗收
5. 可先行 demo「集中檢視」價值

### Incremental Delivery

1. Setup + Foundational → 基礎就緒
2. US1 → 情境 A 驗收 → Demo（MVP）
3. US2 → 情境 B 驗收 → Demo（兩層開關 + 連動）
4. US3 → 情境 C 驗收 → Demo（篩選）
5. 每個 story 疊加價值且不破壞前一個

### Parallel Team Strategy

Foundational 完成後：US1 先行（其他 story 的接掛點）；US1 清單骨架成形後，開關（US2）與篩選（US3）可由不同人接手，但須協調 `AdminOverviewPage.jsx` / `SourceList.jsx` / `lib/api.js` 的共同修改。

---

## Notes

- 本功能**不需 Prisma migration**（所需欄位皆已存在，data-model 開宗明義）。
- `GET /admin/cards` 回應為**加法式**擴充（新增 `nextCursor`，保留 `data`），且目前前端無既有消費者。
- 抓價 job 挑選邏輯（來源啟用且卡片啟用才抓）**不修改**（FR-014）；本頁只做檢視 + 兩層開關 + 篩選。
- 來源→卡片連動僅單向（關閉最後啟用來源 → 卡片不追蹤）；重新啟用 / 新增來源不自動回復（FR-018）。
- Commit 建議每個任務或邏輯群組後進行；可於任一 Checkpoint 停下獨立驗收。
