# CLAUDE.md － apps/web（前端）

Vite + React + shadcn/ui 前台與後台。

## 目錄職責

```
src/
  pages/            頁面（CardList / CardDetail / admin/Login / admin/Admin）
  components/ui/     shadcn 元件（button / input / card…）
  lib/api.js         呼叫後端的薄封裝
  lib/auth.js        管理者 token 的 localStorage 存取
  index.css          Tailwind + shadcn CSS 變數
```

## 慣例

- 路徑別名 `@/` → `src/`（vite.config.js 與 jsconfig.json 已設定）。
- **所有 API 請求走 `lib/api.js`**，不要在元件裡散落 `fetch`。
- dev 模式打 `/api/...`，由 vite proxy 轉到後端（免處理 CORS）。
- 後台 API 需帶 token：呼叫 `api.js` 時該函式已自動加 `Authorization` header。
- 加 shadcn 元件用官方 CLI：`npx shadcn@latest add <component>`（components.json 已設定為 JS 版）。

## 對應 PRD 畫面

- `CardListPage`：搜尋框 + 卡牌列表（最新價、最後更新時間）
- `CardDetailPage`：基本資料 + 最新價 + recharts 趨勢圖 + 歷史價格表
- `admin/LoginPage`：JWT 登入（seed 帳號 admin@pct.local / admin1234）
- `admin/AdminPage`：新增卡牌與來源、手動更新、job 狀態與錯誤
