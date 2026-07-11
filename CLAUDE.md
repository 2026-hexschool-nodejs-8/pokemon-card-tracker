# CLAUDE.md － 寶可夢卡牌價格追蹤器

> 這是全組共用的專案說明，會隨 repo 進版控。Claude Code 與所有組員都以此為準。
> 各子目錄（`apps/api`、`apps/web`）另有專屬 `CLAUDE.md`，請一併參考。

## 專案是什麼

定期透過 API / 爬蟲抓取寶可夢卡牌價格，存成歷史快照，前台可查詢最新價與趨勢。
完整需求見 [initial-prd.md](initial-prd.md)。

## 技術棧

JavaScript（ESM）· Express · Vite + React · shadcn/ui · Zod · PostgreSQL · Prisma · node-cron
Monorepo 用 **npm workspaces**（非 pnpm）。

## Monorepo 結構

```
apps/api       Express 後端（路由 / adapter / 排程 / JWT）
apps/web       Vite + React + shadcn 前台與後台
packages/db    Prisma schema、client、seed（@pct/db）
packages/shared Zod schema、共用常數（@pct/shared，前後端共用）
```

內部套件互相引用用 `@pct/db`、`@pct/shared`。

## 開發守則

- **所有指令從 repo 根目錄執行**（npm scripts 已設定好，`.env` 在根目錄）。
- 新增依賴指定 workspace：`npm i <pkg> -w @pct/api`。
- **驗證邏輯寫在 `packages/shared` 的 Zod schema**，前後端共用同一份，不要各寫一份。
- **抓價來源一律包成 adapter**（見 `apps/api/src/adapters`），controller / scheduler 不碰各來源細節。
- 價格一律經過 `normalizePrice` 清洗，擋掉 0 / NaN / Infinity。
- 單一來源失敗不可中斷整個 job，要寫進 `PriceFetchLog`。
- 機密（`JWT_SECRET`、`DATABASE_URL`）只放 `.env`，**絕不進版控**。

## 常用指令

```bash
npm install              # 安裝全部 workspace（會自動 prisma generate）
docker compose up -d db  # 起本機 PostgreSQL
npm run db:migrate       # 建表
npm run db:seed          # 灌 Demo 卡牌 / 價格 / job（不含 admin）
npm run db:seed:admin    # 建立 / 更新唯一 admin（讀 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD，預設 admin@pct.local / admin1234）
npm run db:seed:clear    # 清掉 demo 資料，但保留 admin
npm run dev:api          # 後端 http://localhost:3000
npm run dev:web          # 前端 http://localhost:5173
npm run job:once         # 手動跑一次抓價，驗證主流程
```

## Git / 協作

- 主分支保護，功能走 feature branch + PR。
- commit message 用中文或英文皆可，但要能看懂改了什麼。
- `.claude/`（共用 skills / commands / settings）會進版控；個人設定放 `.claude/settings.local.json`（已 gitignore）。
