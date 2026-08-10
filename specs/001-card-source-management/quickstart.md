# Quickstart: 後台卡片與來源管理總覽頁

驗證本功能端到端可用的手動情境。所有指令**自 repo 根目錄執行**。

## 前置

```bash
docker compose up -d db      # 起本機 PostgreSQL
npm run db:migrate           # 建表（本功能無新 migration，沿用既有）
npm run db:seed              # 灌 demo 卡片 / 來源 / 價格
npm run db:seed:admin        # 建 admin（預設 admin@pct.local / admin1234）
npm run dev:api              # 後端 http://localhost:3000
npm run dev:web              # 前端 http://localhost:5173
```

登入後台：瀏覽 `http://localhost:5173/admin/login`，以 seed admin 登入。

> 若要驗證無限滾動，seed 卡片數需 > 單批（20）。可多次執行 seed 或以後台既有頁新增卡片，湊到 > 20 張。

參考：資料語意見 [data-model.md](./data-model.md)，端點細節見 [contracts/admin-overview-api.md](./contracts/admin-overview-api.md)。

---

## 情境 A：一目了然檢視（US1）

1. 導覽列點「卡片總覽」進入 `/admin/overview`。
2. **預期**：以 Accordion 列出第一批（≤20）卡片，每列顯示卡名、卡號、系列、語言、狀態別、追蹤開關、來源數量、最新價、最後更新時間；從未抓價者最新價/時間顯示「—」。（FR-002、SC-002 首屏 < 2s）
3. 向下捲動到底：**預期**自動接續載入下一批（無需換頁）；到最後一批顯示「已到底」且不再請求。（FR-003、Edge Case）
4. 點開任一卡片 Accordion：**預期**此時才發出 `GET /admin/cards/:id/sources`（可用瀏覽器 Network 驗證延遲載入），顯示各來源類型/名稱/幣別/使用開關/最後成功時間/最後錯誤。（FR-004/FR-005、SC-003 < 2s）
5. 收合再展開同一卡：**預期**不重複發請求（沿用已載入結果）。（FR-004、Acceptance US1-4）
6. 展開一張無來源的卡：**預期**顯示「尚無來源」空狀態，非錯誤。（Acceptance US1-5）

## 情境 B：兩層開關（US2）

1. 對一張追蹤中的卡切「追蹤」開關為關：**預期**畫面 1s 內反映停用；重新整理後仍停用。（FR-006、SC-004）
2. 展開一張追蹤已關閉的卡：**預期**明確標示「此卡片追蹤已關閉，來源不會被抓取」，即使個別來源仍顯示使用中。（FR-008、SC-007）
3. 對一張有多個啟用來源的卡，關閉其中**非最後一個**來源：**預期**僅該來源變停用、卡片與其他來源不受影響、無 modal；重新整理後持久。（FR-007/FR-017、Acceptance US2-3）
4. 對一張**僅剩一個啟用來源**的卡，關閉該來源：**預期**先跳確認 modal（警告「關閉後這張卡片將沒有任何啟用中來源、價格不再更新」）。（FR-015）
   - 按**取消**：**預期**來源與卡片皆不變。（FR-015）
   - 按**確認**：**預期**該來源停用**且**卡片追蹤同時變為停用；重新整理後兩者一致。（FR-016、SC-008，走 `deactivate-last` 交易端點）
5. 承上，之後重新啟用該來源或新增來源：**預期**卡片追蹤**不**自動回復，仍需手動開卡片追蹤開關。（FR-018）
6. 模擬儲存失敗（例如關掉 API 伺服器後切開關）：**預期**開關還原為切換前狀態並提示失敗，畫面不停在與實際不符狀態。（FR-012、Acceptance US2-5）

## 情境 C：篩選（US3）

1. 卡片關鍵字輸入卡名或卡號片段：**預期**清單重置並自第一批重新載入，只顯示符合者，仍支援無限滾動。（FR-009/FR-011、Acceptance US3-1）
2. 追蹤狀態篩選設「僅停用」：**預期**只顯示追蹤已關閉的卡。（Acceptance US3-2）
3. 同時套用語言 + 追蹤狀態：**預期**只顯示同時符合者。（Acceptance US3-3）
4. 展開一張含 api + crawler 混合來源的卡，來源類型篩選設「crawler」：**預期**該卡內只顯示 crawler 來源（前端過濾，不重新抓取）。（FR-010、Acceptance US3-4）
5. 套用一組無符合結果的卡片條件：**預期**顯示「查無符合條件的卡片」空狀態。（Acceptance US3-5）
6. 連續快速變更篩選：**預期**只呈現最新條件的結果，無過期批次殘留。（Edge Case、stale-response guard）

## 情境 D：存取控制

1. 登出或清除 token 後直接開 `/admin/overview`：**預期**導向 `/admin/login`，不顯示殘缺畫面。（FR-001、Edge Case）

---

## 後端契約測試（node:test）

```bash
npm test -w @pct/api        # 或專案既有測試指令
```

至少涵蓋（見 contracts 契約測試要點）：
- `GET /admin/cards` 分頁：批量、`nextCursor` 接續、最後一批為 null、`isActive` 與 `keyword` 篩選。
- `PATCH /admin/sources/:id/deactivate-last`：成功時來源+卡片同時停用、交易失敗 rollback、單向連動（重新啟用來源不回復卡片）。

## 驗收對應

| Success Criteria | 對應情境 |
|------------------|---------|
| SC-001 同頁檢視+開關 | A + B |
| SC-002 首屏 < 2s | A-2 |
| SC-003 展開來源 < 2s | A-4 |
| SC-004 切換 < 1s 且持久 | B-1 |
| SC-005 篩選只顯示符合 | C |
| SC-006 200 張仍分批 | A-3 |
| SC-007 兩層關係可理解 | B-2 |
| SC-008 最後來源連動一致 | B-4 |
