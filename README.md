# 🃏 寶可夢卡牌價格追蹤器（Pokémon Card Tracker）

定期透過 API / 爬蟲抓取寶可夢卡牌價格，存成歷史快照，前台可查詢最新價與趨勢，後台可管理卡牌、手動更新、監控排程任務。

需求文件見 [initial-prd.md](initial-prd.md)。

## 技術棧

| 範圍     | 技術                                |
| -------- | ----------------------------------- |
| Monorepo | npm workspaces                      |
| 後端     | Express · Zod · node-cron · JWT     |
| 前端     | Vite · React · shadcn/ui · Recharts |
| 資料層   | PostgreSQL · Prisma                 |
| 語言     | JavaScript（ESM）                   |

## 專案結構

```
pokemon-card-tracker/
├── apps/
│   ├── api/        # Express 後端
│   └── web/        # Vite + React 前台與後台
├── packages/
│   ├── db/         # Prisma schema / client / seed（@pct/db）
│   └── shared/     # Zod schema + 常數，前後端共用（@pct/shared）
├── .claude/        # 團隊共用 Claude 設定 / skills
└── CLAUDE.md       # 全組共用開發說明
```

## 環境需求

- Node.js >= 20（建議 20 或以上；後端 API 用 `dotenv` 載入根目錄 `.env`）
- Docker（用來起 PostgreSQL；若已有本機 / 雲端 DB 可略過）

## 快速開始

```bash
# 1. 安裝依賴（會自動 prisma generate）
npm install

# 2. 設定環境變數
cp .env.example .env
cp apps/web/.env.example apps/web/.env
#   ⚠ 記得把 .env 裡的 JWT_SECRET 改成隨機字串

**取得 TCGPLAYER_COOKIE：**
-- 使用爬蟲工具前置作業

1. 瀏覽器開啟 [tcgplayer.com](https://www.tcgplayer.com)
2. 開 DevTools → Network → 任意請求 → Headers → 複製 `Cookie` 欄位值
3. 貼入 `.env`
4. TCGPLAYER_COOKIE=你複製的Cookie

> Cookie 過期會收到 403，需重新複製。

# 3. 啟動 PostgreSQL（用本專案附的 docker-compose）
docker compose up -d db

# 4. 建立資料表
npm run db:migrate

# 5. 灌入 Demo 資料
npm run db:seed
#   → 建立管理者帳號：admin@pct.local / admin1234

# 6. 啟動後端（另開終端機）
npm run dev:api      # http://localhost:3000

# 7. 啟動前端（再開一個終端機）
npm run dev:web      # http://localhost:5173
```

開啟 http://localhost:5173 即可看到前台。後台登入頁在 `/admin/login`。

## 驗證主流程（抓價管線）

```bash
npm run job:once     # 手動跑一次抓價，會新增價格快照並更新卡牌最新價
```

預期輸出類似：

```
Job xxx 開始，共 N 個來源（trigger=manual）
Job xxx 結束：success（成功 N / 失敗 0）
```

之後重新整理前台，卡牌的「最後更新時間」與歷史價格會更新。

## 常用指令（皆從根目錄執行）

| 指令                 | 說明                    |
| -------------------- | ----------------------- |
| `npm run dev:api`    | 啟動後端（含每日排程）  |
| `npm run dev:web`    | 啟動前端                |
| `npm run db:migrate` | 建立 / 更新資料表       |
| `npm run db:seed`    | 重新灌 Demo 資料        |
| `npm run db:reset`   | 清庫並重跑 migration    |
| `npm run db:studio`  | 開 Prisma Studio 看資料 |
| `npm run job:once`   | 手動跑一次抓價          |

## API 一覽

| Method | Path                          | 權限   | 說明                                     |
| ------ | ----------------------------- | ------ | ---------------------------------------- |
| GET    | `/health`                     | 公開   | 服務狀態                                 |
| GET    | `/cards`                      | 公開   | 卡牌列表（`keyword`/`language`/`grade`） |
| GET    | `/cards/:id`                  | 公開   | 卡牌詳情                                 |
| GET    | `/cards/:id/prices`           | 公開   | 歷史價格                                 |
| POST   | `/admin/auth/login`           | 公開   | 管理者登入取得 JWT                       |
| POST   | `/admin/cards`                | 管理者 | 新增卡牌                                 |
| PATCH  | `/admin/cards/:id`            | 管理者 | 編輯卡牌                                 |
| DELETE | `/admin/cards/:id`            | 管理者 | 停用卡牌                                 |
| POST   | `/admin/cards/:id/sources`    | 管理者 | 新增來源                                 |
| PATCH  | `/admin/sources/:id`          | 管理者 | 編輯來源                                 |
| POST   | `/admin/jobs/price-sync`      | 管理者 | 手動更新全部                             |
| POST   | `/admin/cards/:id/price-sync` | 管理者 | 手動更新單張                             |
| GET    | `/admin/jobs`                 | 管理者 | job 列表                                 |
| GET    | `/admin/jobs/:id`             | 管理者 | job 詳情與 log                           |

## 資料來源說明

目前內建 **mock adapters**（`apps/api/src/adapters`），回傳模擬價格，讓主流程可端到端運作。
要接真實來源時，把 mock adapter 內的 `simulateXxx` 換成實際的 `fetch` + 解析（API 用 JSON、crawler 用 cheerio），輸出格式 `PriceResult` 維持不變即可。

> 爬蟲請遵守 PRD 第十九章原則：優先用公開 API、不繞過登入 / 付費牆 / 驗證碼、設定合理頻率。

## 小組分工建議

見 [initial-prd.md](initial-prd.md) 第二十章。
