# Implementation Plan: 後台卡片與來源管理總覽頁

**Branch**: `feature/admin` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-card-source-management/spec.md`

## Summary

在既有後台之外「多一個」獨立總覽頁，讓管理者用 **Accordion + 無限滾動**一目了然檢視所有卡片與其來源，並在同頁進行「卡片追蹤」與「來源使用」兩層開關切換與篩選。技術上以既有兩層 `isActive` 語意為基礎，**不改抓價 job 的挑選邏輯**（FR-014）：

- 後端最小增修：為既有 `GET /admin/cards` 加上 **cursor 分頁**（供無限滾動），並新增一支 **交易式端點**處理「關閉最後一個啟用來源 → 同時停用來源與卡片」的原子連動（FR-015～FR-018）。其餘操作直接重用既有 `GET /admin/cards/:id/sources`、`PATCH /admin/cards/:id`、`PATCH /admin/sources/:id`。
- 前端新增一頁 `AdminOverviewPage`（路由 `/admin/overview`），沿用專案既有的 `lib/api.js` + `useState` + `IntersectionObserver` 模式（**不引入 react-query 等新狀態庫**），來源明細延遲載入，開關採樂觀更新並在失敗時還原。
- 資料層**無需 migration**：摘要欄位（`latestPrice`／`latestCurrency`／`lastFetchedAt`／`_count.sources`）與兩層 `isActive` 皆已存在。

## Technical Context

**Language/Version**: JavaScript（ESM）· Node.js 20+ · React 18

**Primary Dependencies**: Express · Prisma · Vite + React · shadcn/ui（新增 Radix `Accordion`）· Zod（`@pct/shared`）· react-router-dom v6 · lucide-react

**Storage**: PostgreSQL via Prisma；**本功能不需 schema 變更**（所需欄位皆已存在）

**Testing**: 後端 `node:test`（既有 `*.test.js` 慣例）驗證分頁與交易連動端點；前端以 `quickstart.md` 手動情境驗收

**Target Platform**: 瀏覽器前端（`apps/web`）+ Node 伺服器（`apps/api`），npm workspaces monorepo

**Project Type**: Web application（monorepo：`apps/api` + `apps/web` + `packages/*`）

**Performance Goals**: 首屏第一批卡片 < 2s（SC-002）、展開載入來源 < 2s（SC-003）、開關切換畫面反映 < 1s（SC-004）；單批預設 20 張

**Constraints**: 忠實呈現既有兩層 `isActive` 語意、**不修改抓價挑選邏輯**（FR-014）；開關樂觀更新且失敗還原（FR-012）；篩選變更時捨棄過期請求結果（stale-response guard）

**Scale/Scope**: 卡片量級以 200 張為設計目標（SC-006），分批載入不一次抓全部；來源層級篩選作用於「已展開卡片內」的清單（client-side）

## Constitution Check

*GATE: 依 `.specify/memory/constitution.md` v1.0.0 評估。*

| 原則 | 是否通過 | 說明 |
|------|---------|------|
| I. Brownfield 增量修改（NON-NEGOTIABLE） | ✅ | 只新增一頁 + 一條路由 + 一個導覽連結；後端僅「加分頁參數」與「新增一支交易端點」，重用既有 toggle 端點，不重寫既有模組。`GET /admin/cards` 回應為**加法式**擴充（新增 `nextCursor`，保留 `data`）；改為預設分頁屬 spec Assumptions 明列的必要能力（分批載入），且目前前端無既有消費者，範圍受控。 |
| II. 共用 Schema 為單一事實來源 | ✅ | 分頁參數與來源篩選一律擴充 `packages/shared` 的 Zod schema，前後端共用；不在 app 內各寫一份。 |
| III. 抓價來源 Adapter 化並清洗價格 | ✅（不適用） | 本功能為唯讀檢視 + 兩層開關，不觸發抓價、不新增來源解析、不寫 snapshot，`adapters` / `normalizePrice` 皆不動。 |
| IV. 單一來源失敗不中斷 Job 且可觀測 | ✅（不適用） | 不修改 job 主流程與 `PriceFetchLog`。 |
| V. 機密與設定紀律 | ✅ | 無新機密；新增 shadcn accordion 以 `npm ... -w @pct/web` 指定 workspace，指令自 repo 根目錄執行。 |

**結論**：無違反，Complexity Tracking 留空。

## Project Structure

### Documentation (this feature)

```text
specs/001-card-source-management/
├── plan.md              # 本檔（/speckit-plan 輸出）
├── spec.md              # 功能規格（已存在）
├── research.md          # Phase 0 輸出
├── data-model.md        # Phase 1 輸出
├── quickstart.md        # Phase 1 輸出
├── contracts/           # Phase 1 輸出
│   └── admin-overview-api.md
└── tasks.md             # /speckit-tasks 產生（本指令不建立）
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/
│   └── admin.cards.js          # 修改：GET /cards 加 cursor 分頁；新增 PATCH /sources/:id/deactivate-last（交易連動）
└── services/
    └── card.service.js         # 可選：抽出 adminListCards 分頁查詢（若 route 過胖）

apps/web/src/
├── App.jsx                     # 修改：加 /admin/overview 路由與導覽連結
├── lib/
│   └── api.js                  # 新增：adminGetCards(分頁)/adminGetCardSources/adminToggleCard/adminToggleSource/adminDeactivateLastSource
├── components/ui/
│   └── accordion.jsx           # 新增：shadcn accordion（npx shadcn add accordion）
└── pages/admin/
    ├── AdminOverviewPage.jsx   # 新增：總覽頁（Accordion + 無限滾動 + 兩層開關 + 篩選 + 確認 modal）
    └── components/             # 新增（本頁專屬子元件，視需要）
        ├── CardRow.jsx         # 卡片摘要列 + 追蹤開關
        ├── SourceList.jsx      # 展開後的來源明細 + 使用開關 + 來源篩選
        └── ConfirmModal.jsx    # 關閉最後啟用來源的確認 modal

packages/shared/schemas/
├── card.schema.js              # 修改：adminListCardsQuerySchema 加 cursor / limit
└── source.schema.js            # 可選：新增來源層級篩選 schema（若採前端共用驗證）
```

**Structure Decision**: 沿用既有 monorepo 結構，不新增 app 或 package。後端改動集中在 `apps/api/src/routes/admin.cards.js`（route 薄層）；前端新頁與其專屬子元件放 `apps/web/src/pages/admin/`，API 呼叫一律經 `apps/web/src/lib/api.js`；驗證 schema 一律落在 `packages/shared`。

## Complexity Tracking

> 無 Constitution 違反，本節不需填寫。
