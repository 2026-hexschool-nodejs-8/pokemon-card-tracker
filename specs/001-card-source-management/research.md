# Phase 0 Research: 後台卡片與來源管理總覽頁

功能技術棧與資料語意皆為既有專案沿用，spec 已無 `NEEDS CLARIFICATION`（Clarifications Session 2026-07-27 已解決兩層連動特例）。本文件記錄實作前的關鍵設計決策。

## 1. 卡片清單分頁策略（供無限滾動）

- **Decision**：對既有 `GET /admin/cards` 加 **cursor-based 分頁**：query 新增 `cursor`（上一批最後一張卡的 `id`）與 `limit`（預設 20，上限如 50）。回應改為 `{ data: Card[], nextCursor: string | null }`（加法式，保留 `data`）。以 Prisma `take: limit`、`cursor: { id }`、`skip: 1` 實作，排序為 `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`。
- **Rationale**：無限滾動天然是「往後接續」而非「跳頁」，cursor 分頁比 offset 更符合語意；`id` 為 cuid 有唯一性可當游標。
  **排序鍵必須是不可變欄位**：Prisma 的 `cursor: { id }` 是拿該筆的「當前」排序值去定位，所以只要排序鍵事後被改寫，
  游標就會錯位。`createdAt` 建立後不再變動，`id desc` 則處理同毫秒建立的並列。
- **Alternatives considered**：
  - Offset/page 分頁：實作直觀但在即時開關造成排序位移時會漏卡或重複，且不符無限滾動語意。
  - 排序鍵用 `updatedAt`（原始決策，已推翻）：追蹤開關與抓價 job 都會改寫 `updatedAt`，被改的卡跳到排序最前 →
    游標錯位 → 後續批次重複；若被改的是「尚未載入」的卡（例如捲動途中抓價 job 跑過），它會越過游標而**永遠不出現**。
    迴歸測試見 `admin.cards.pagination.test.js`「批次之間有卡片被更新」。
  - Keyset（`updatedAt` + `id` 複合游標）：能凍結游標位置、解決上述「重複」，但**解決不了「遺漏」**——
    任何往前掃描的分頁都會漏掉跳到掃描位置前面的資料，這是可變排序鍵的固有問題，換掉排序鍵才是根治。
- **相容性**：目前前端 `lib/api.js` 無 `adminGetCards`，`GET /admin/cards` 無既有前端消費者；改為預設分頁不破壞現有畫面，且為 spec Assumptions 明列的必要能力。

## 2. 前端無限滾動實作

- **Decision**：用瀏覽器原生 `IntersectionObserver` 監看清單底部 sentinel 元素，進入視窗即載入下一批；以 `nextCursor === null` 判定「已到底」，顯示到底提示且停止觀察。
- **Rationale**：零新依賴、與專案現有「plain fetch + useState」風格一致（見 `CardListPage`）。符合憲章 Principle I 的最小改動與使用者「偏好最簡方案」。
- **Alternatives considered**：`react-infinite-scroll-component` 或 `@tanstack/react-virtual`——需新增依賴；200 張量級不需虛擬化，捨棄。

## 3. 前端資料抓取／狀態管理

- **Decision**：沿用 `apps/web/src/lib/api.js` 薄封裝 + 元件內 `useState`／`useEffect`，不引入 react-query。
- **Rationale**：專案現況即此模式；引入資料庫層級的 caching 庫對本頁效益低、增加學習與維護成本（課程專案）。延遲載入來源的「已載入不重抓」以元件 state 記憶即可（FR-004）。
- **Alternatives considered**：`@tanstack/react-query` 可自動處理 cache/重試/樂觀更新，但與現有程式風格不一致且屬新依賴，暫不採用。

## 4. Accordion 元件

- **Decision**：以官方 CLI 新增 shadcn `accordion`（`npx shadcn@latest add accordion`，底層 Radix `@radix-ui/react-accordion`），落在 `apps/web/src/components/ui/accordion.jsx`。以 `type="multiple"` 允許同時展開多張卡片；`onValueChange` 觸發「首次展開才 fetch 來源」的延遲載入。
- **Rationale**：符合 `apps/web/CLAUDE.md` 既有慣例（shadcn 官方 CLI、JS 版）；Radix 提供無障礙與鍵盤操作。
- **Alternatives considered**：手刻 `<details>`／自製摺疊——可行但需自理無障礙與動畫，shadcn 已標準化。

## 5. 「關閉最後一個啟用來源 → 卡片連動不追蹤」的原子性

- **Decision**：新增交易式端點 `PATCH /admin/sources/:id/deactivate-last`，在 `prisma.$transaction` 內**先計數該卡啟用來源作為防呆守衛**（僅當此來源為該卡唯一啟用來源才續行，否則整筆不變更並回 `409`），續行則同時 `source.isActive=false` 與其所屬 `card.isActive=false`，回傳更新後的 source 與 card。前端在偵測到「這是該卡最後一個啟用來源」時先跳確認 modal，確認後才呼叫此端點；一般（非最後）來源關閉走既有 `PATCH /admin/sources/:id`。
- **Rationale**：FR-016 要求「同一動作內同時停用來源並將卡片設為不追蹤、兩者一併持久化」，必須後端交易保證原子性，前端兩次呼叫無法保證。分成獨立端點可讓既有 `PATCH /admin/sources/:id` 行為完全不變（Principle I）。「是否為最後啟用來源」由該卡已呈現的來源清單於前端判定（Clarifications 明訂，一來源只屬一卡，不新增反查查詢）。
- **Alternatives considered**：
  - 擴充 `PATCH /admin/sources/:id` 吃一個 `cascadeDeactivateCard` 旗標——會改動既有端點語意與 `updateSourceSchema`（共用 schema），牽動較廣，捨棄。
  - 前端連續呼叫兩支 PATCH——無交易保證，任一失敗會產生狀態不一致，違反 FR-016，捨棄。
- **單向連動（FR-018）**：僅「關閉最後啟用來源 → 卡片不追蹤」單向；重新啟用／新增來源**不**自動回復卡片追蹤，端點與前端皆不實作反向連動，卡片追蹤僅由 `PATCH /admin/cards/:id` 手動開啟。

## 6. 開關樂觀更新與失敗還原（FR-012 / FR-016）

- **Decision**：切換開關先在前端即時更新畫面（optimistic），再送 API；失敗時 catch 後還原為切換前狀態並提示。交易連動（deactivate-last）失敗時，來源與卡片一併還原。
- **Rationale**：達成 SC-004「切換後 1s 內反映」；同時滿足 FR-012「失敗不得停留在與實際不符的狀態」。
- **快速連點**：同一開關以「最後一次操作為準」——切換時記錄進行中請求，新操作覆蓋舊的目標狀態，回應到達後只採用與最新目標一致者（或用 disable 進行中開關的輕量作法）。

## 7. 篩選：卡片層（後端）vs 來源層（前端）

- **Decision**：
  - **卡片層篩選**（關鍵字／語言／狀態別 grade／追蹤狀態 isActive）走後端 query——沿用既有 `adminListCardsQuerySchema` 已支援的 `keyword`/`language`/`grade`/`isActive`，條件變更時清單重置並自第一批（無 cursor）重新載入（FR-011）。
  - **來源層篩選**（類型 api/crawler、使用狀態）作用於「已展開卡片內」已載入的來源清單，於**前端**過濾（FR-010、與延遲載入架構一致，不做跨卡反查）。
- **Rationale**：卡片層需配合分頁與資料庫查詢；來源層資料量小且只作用於已載入清單，前端過濾最簡且即時。
- **Stale-response guard**：卡片篩選連續變更時，以請求序號／`AbortController` 捨棄過期批次結果，只採用最新條件的回應（Edge Case）。

## 8. 卡片摘要欄位來源（FR-002）

- **Decision**：`GET /admin/cards` 回傳的每張卡直接提供 `name`／`cardNumber`／`setName`（系列）／`language`／`condition`（狀態別）／`isActive`（追蹤開關）／`latestPrice`＋`latestCurrency`（最新價）／`lastFetchedAt`（最後更新時間），並沿用既有 `include: { _count: { select: { sources: true } } }` 提供**來源數量**。
- **Rationale**：這些欄位皆為 `Card` 既有欄位或既有 `_count`，**無需 schema 變更**。摘要顯示的來源數量**定義為該卡全部來源數（含停用）**（已定調，見 spec Assumptions）；卡片全部來源關閉時其追蹤亦為 off，故不另計「啟用中來源數」。
- **空值處理**：`latestPrice`／`lastFetchedAt` 為 null（從未抓價）時前端顯示「—」（Edge Case）。

## 9. 存取控制

- **Decision**：新頁與所有端點沿用既有 `adminAuth`（JWT）中介層；前端頁面沿用 `isLoggedIn()` 守衛，未登入／token 過期導向 `/admin/login`。
- **Rationale**：FR-001 僅限已登入管理者；Assumptions 明訂沿用既有單一 admin 角色與 JWT，不新增角色。`admin.cards.js` 已 `router.use(adminAuth)`，新端點自動受保護。
