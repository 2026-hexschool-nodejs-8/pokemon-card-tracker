# CLAUDE.md － apps/web（前端）

Vite + React + shadcn/ui 前台與後台。

## 目錄職責

```
src/
  pages/            頁面（CardList / CardDetail / admin/Login / admin/Admin）
  components/       跨頁共用元件（PriceTrendChart…）
  components/ui/     shadcn 元件（button / input / card…）
  lib/api.js         呼叫後端的薄封裝
  lib/auth.js        管理者 token 的 localStorage 存取
  lib/priceSeries.js 趨勢圖的資料整形（純函式，可用 node --test 驗證）
  index.css          Tailwind + shadcn CSS 變數
```

## 測試

前端沒有測試框架，但**純函式模組可用 Node 內建的 `node --test` 驗證**（零額外依賴）：

```bash
npm run test:web    # 跑 apps/web/src/**/*.test.js
```

UI 行為仍以人工／瀏覽器自動化驗證為主。

## 慣例

- 路徑別名 `@/` → `src/`（vite.config.js 與 jsconfig.json 已設定）。
- **所有 API 請求走 `lib/api.js`**，不要在元件裡散落 `fetch`。
- dev 模式打 `/api/...`，由 vite proxy 轉到後端（免處理 CORS）。
- 後台 API 需帶 token：呼叫 `api.js` 時該函式已自動加 `Authorization` header。
- 加 shadcn 元件用官方 CLI：`npx shadcn@latest add <component>`（components.json 已設定為 JS 版）。

## 對應 PRD 畫面

- `CardListPage`：搜尋框 + 卡牌列表（最新價、最後更新時間）
- `CardDetailPage`：基本資料 + 最新價 + **單一多來源台幣趨勢圖**（每個來源一條線，含外部市場行情，
  可切 7 天 / 1 個月 / 3 個月）+ 歷史價格表
- `admin/LoginPage`：JWT 登入（seed 帳號 admin@pct.local / admin1234）
- `admin/AdminPage`：新增卡牌與來源、手動更新、job 狀態與錯誤
