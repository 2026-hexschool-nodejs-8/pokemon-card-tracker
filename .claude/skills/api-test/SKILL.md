---
name: api-test
description: 手動驗證 apps/api 主要流程的 smoke test（health、公開卡牌 API、後台登入、卡牌/來源 CRUD、抓價 job 成功/失敗情境、軟刪除與復原）
---

前置條件（腳本本身不會幫你啟動）：

1. `docker compose up -d db`
2. `npm run db:migrate`（第一次或 schema 有變動時）
3. `npm run db:seed`（需要 admin@pct.local / admin1234 這組帳密）
4. `npm run dev:api`（另開一個 terminal 或背景執行，預設 http://localhost:3000）

執行步驟：

```bash
bash apps/api/src/scripts/api-test.sh
```

驗證涵蓋範圍：

- `GET /health`、`GET /cards` 基本 200
- `POST /admin/auth/login`：密碼錯誤 401、正確登入拿 token
- `GET /admin/cards` 無 token 應 401
- `POST /admin/cards`：成功建立、缺必填欄位回 400
- `POST /admin/cards/:id/sources` 建立來源
- `POST /admin/cards/:id/price-sync`：正常來源 → `status:success`；`externalId` 帶 `fail` 字串的 mock 來源 → `status:failed`
- `DELETE /admin/cards/:id`（軟刪除）後，公開 API 應回 404；`PATCH {isActive:true}` 復原後應回 200
- 清乾淨：呼叫 `DELETE /admin/cards/:id?hard=true` 硬刪除腳本建立的測試卡

輸出每一步 ✅/❌，最後印 `PASS: n  FAIL: n`，有任何一步失敗會以非 0 狀態碼結束（可接 CI）。
