<!--
Sync Impact Report
- Version change: (未版本化 template placeholders) → 1.0.0
- Rationale: 首次批准（initial ratification）。原檔僅含 template placeholder，本次填入專案實際治理原則。
- Modified principles: 無（初次定義）。新增以下 5 條原則：
    I. Brownfield 增量修改（NON-NEGOTIABLE）
    II. 共用 Schema 為單一事實來源
    III. 抓價來源一律 Adapter 化並清洗價格
    IV. 單一來源失敗不得中斷 Job，且可觀測
    V. 機密與設定紀律
- Added sections: Core Principles、技術棧與架構限制、開發流程與品質關卡、Governance
- Removed sections: 無
- Templates requiring updates:
    ✅ .specify/templates/plan-template.md（Constitution Check gate 以「依 constitution 決定」動態引用，無硬編碼原則，免改）
    ✅ .specify/templates/spec-template.md（無原則相依內容，已對齊）
    ✅ .specify/templates/tasks-template.md（無原則相依內容，已對齊）
    ✅ .claude/skills/speckit-*/SKILL.md（以通用方式引用 constitution，無過時 agent 專屬命名需修正）
- Deferred TODOs: 無
-->

# 寶可夢卡牌價格追蹤器 Constitution

## Core Principles

### I. Brownfield 增量修改（NON-NEGOTIABLE）

這是一個既有（brownfield）專案。所有變更 MUST 是最小、聚焦、且限定在被明確要求範圍內的增量修改。

- 只 MUST 修改當前 spec / 任務明確指定的檔案與程式段落；未被要求的既有程式碼一律
  MUST NOT 更動——包含格式化、重排、重新命名、順手清理。
- 除非該 spec 的目標本身就是重構（在 spec 中明確寫出 refactor / 重構範圍），否則
  MUST NOT 重寫、重建或大規模改寫既有模組、函式或架構。
- 需要改動既有公開行為或介面時，MUST 先在 spec / plan 標示並取得確認，才動手；
  MUST NOT 在實作任務中夾帶未經協議的行為變更。
- 不確定某項改動是否在範圍內時，MUST 先詢問，而非自行擴大範圍。

理由：本專案由多人協作、程式已在運作。未經協議的擴大改動會破壞他人的工作、
製造無法解釋的 diff，並直接危及維護者的信任。保守、可預期的 diff 永遠優先於
「更漂亮但更大」的 diff。

### II. 共用 Schema 為單一事實來源

驗證邏輯與跨前後端共用型別 MUST 定義在 `packages/shared` 的 Zod schema，前後端共用同一份。

- MUST NOT 在 `apps/api` 與 `apps/web` 各自重寫一份驗證規則。
- 共用常數同樣放 `@pct/shared`。

理由：兩份驗證遲早不同步，會產生「前端過得了、後端擋下來」（或相反）的隱性 bug。

### III. 抓價來源一律 Adapter 化並清洗價格

每個外部價格來源 MUST 包成 `apps/api/src/adapters` 下的 adapter，輸出統一的 `PriceResult` 格式。

- controller 與 scheduler MUST NOT 直接碰觸各來源的 HTTP / HTML 細節。
- 所有價格寫入前 MUST 經過 `normalizePrice` 清洗，擋掉 0 / NaN / Infinity；
  異常但非零的價格 SHOULD 標記 `isSuspicious`，而非直接落庫為正常快照。

理由：來源會改版、變慢、被限流；把差異隔離在 adapter，主流程才穩定且可測。

### IV. 單一來源失敗不得中斷 Job，且可觀測

抓價 job 中，單一卡牌 / 來源失敗 MUST NOT 中斷整個 job。

- 每次來源結果（成功或失敗）MUST 寫進 `PriceFetchLog`；job 整體狀態 MUST 如實反映
  `success` / `partial_success` / `failed`。
- 錯誤 MUST 留下可 debug 的訊息（來源、原因），MUST NOT 被靜默吞掉。

理由：這是本專案評分核心——外部來源失敗時服務不崩，且留得下可追查的軌跡。

### V. 機密與設定紀律

機密（`JWT_SECRET`、`DATABASE_URL` 等）MUST 只放根目錄 `.env`，MUST NOT 進版控。

- 所有 npm script MUST 從 repo 根目錄執行。
- 新增依賴 MUST 指定 workspace（例如 `npm i <pkg> -w @pct/api`）。

理由：機密外洩不可逆；workspace 錯位會裝到錯的地方、污染其他 app。

## 技術棧與架構限制

技術棧固定為：JavaScript（ESM）· Express · Vite + React · shadcn/ui · Zod · PostgreSQL ·
Prisma · node-cron；Monorepo 使用 **npm workspaces（非 pnpm）**。

- 目錄結構：`apps/api`（後端）、`apps/web`（前台 + 後台）、`packages/db`
  （`@pct/db`：Prisma schema / client / seed）、`packages/shared`
  （`@pct/shared`：Zod / 共用常數）。內部套件互引一律用 `@pct/db`、`@pct/shared`。
- 更換上述任一核心技術或套件管理器，MUST 走本憲章的修訂程序，MUST NOT 在功能 PR 中夾帶。
- 爬蟲 MUST 遵守 PRD 第十九節：不繞過登入 / 付費牆 / 驗證碼 / 反爬機制，並設定合理頻率與 timeout。

## 開發流程與品質關卡

- 主分支受保護；功能一律走 feature branch + PR，MUST NOT 直接推 `main`。
- commit message 中英文皆可，但 MUST 能看懂改了什麼。
- `.claude/`（共用 skills / commands / settings）進版控；個人設定放
  `.claude/settings.local.json`（已 gitignore）。
- 每份 spec / plan / tasks MUST 通過 Constitution Check，尤其 Principle I（範圍限定）與
  III / IV（adapter、錯誤處理）。任何違反 MUST 在 plan 的 Complexity Tracking 明確記錄理由，
  否則不得進入實作。

## Governance

本憲章優先於其他慣例；與既有文件衝突時以本憲章為準。`CLAUDE.md`（根目錄與各 app 子目錄）
為本憲章的實作細則，兩者 SHOULD 保持一致。

- 修訂程序：任何原則的新增 / 移除 / 重定義 MUST 以 PR 提出，說明理由與影響，經維護者同意後合併。
- 版本政策（語意化版本）：MAJOR＝移除或不相容地重定義既有原則；MINOR＝新增原則或實質擴充指引；
  PATCH＝措辭、錯字、非語意澄清。
- 合規審查：所有 PR / review MUST 檢查是否符合本憲章，尤其 Principle I 的「不擴大範圍」。
- 執行期開發指引以 `CLAUDE.md` 為準。

**Version**: 1.0.0 | **Ratified**: 2026-07-25 | **Last Amended**: 2026-07-25
