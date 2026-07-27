# API Contract: 後台卡片與來源管理總覽頁

所有端點掛在 `/admin` 之下，整個 router 已 `router.use(adminAuth)`，**皆需 JWT**（`Authorization: Bearer <token>`）；未授權回 `401`（前端據此清 token 並導向 `/admin/login`，FR-001）。回應統一以 `{ data: ... }` 包裝；錯誤經 `errorHandler` 統一格式（`{ error: string }`）。

圖例：🆕 新增　♻️ 重用既有（不改動）　✏️ 既有端點擴充（加法式）

---

## ✏️ GET /admin/cards — 卡片清單（分頁，供無限滾動）

既有端點，**擴充 cursor 分頁**（回應加法式新增 `nextCursor`）。

### Query 參數（`adminListCardsQuerySchema`，於 `@pct/shared`）

| 參數 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `keyword` | string | 否 | 比對 `name` / `cardNumber`（insensitive） FR-009 |
| `language` | `ja`\|`en`\|`zh` | 否 | 語言篩選 FR-009 |
| `grade` | string | 否 | 狀態別（對應 `condition`）FR-009 |
| `isActive` | `true`\|`false` | 否 | 追蹤狀態：不帶=全部、`true`=僅追蹤中、`false`=僅停用 FR-009 |
| `cursor` | string(cuid) | 否 | 🆕 上一批最後一張卡的 `id`；不帶=從第一批 |
| `limit` | int | 否 | 🆕 單批數量，預設 `20`，上限 `50` |

### 200 回應

```json
{
  "data": [
    {
      "id": "clx...",
      "name": "皮卡丘",
      "cardNumber": "208/XY-P",
      "setName": "XY Promo",
      "language": "ja",
      "condition": "raw",
      "isActive": true,
      "latestPrice": 1200,
      "latestCurrency": "JPY",
      "lastFetchedAt": "2026-07-26T10:00:00.000Z",
      "_count": { "sources": 3 }
    }
  ],
  "nextCursor": "clx..."   // 無更多資料時為 null（前端據此顯示「已到底」並停止載入）
}
```

- 排序：`updatedAt desc`（預設檢視順序）。
- `latestPrice` / `lastFetchedAt` 可能為 `null`（從未抓價）→ 前端顯示「—」。
- 篩選條件變更時，前端不帶 `cursor` 重新請求（自第一批重載，FR-011）。

### 契約測試要點
- 帶 `limit=20` 且資料 > 20 時，`data.length === 20` 且 `nextCursor` 非 null。
- 以回傳的 `nextCursor` 再請求，接續下一批且不重複、不遺漏。
- 最後一批 `nextCursor === null`。
- `isActive=false` 只回傳停用卡；`keyword` 同時比對卡名與卡號。

---

## ♻️ GET /admin/cards/:id/sources — 某卡全部來源（延遲載入）

既有端點，**重用不改動**。前端僅在展開該卡 Accordion 時呼叫一次（FR-004）。

### 200 回應

```json
{
  "data": [
    {
      "id": "cls...",
      "cardId": "clx...",
      "type": "crawler",
      "provider": "yuyutei",
      "currency": "JPY",
      "isActive": true,
      "lastSuccessAt": "2026-07-26T10:00:00.000Z",
      "lastError": null
    }
  ]
}
```

- 含停用來源（`orderBy: createdAt asc`）。
- 卡片不存在 → `404`。
- 空來源 → `data: []`（前端顯示「尚無來源」空狀態，FR-005 / Acceptance US1-5）。

---

## ♻️ PATCH /admin/cards/:id — 切換卡片「追蹤」開關

既有端點，**重用**（`updateCardSchema`，本頁只送 `isActive`）。

### Request body
```json
{ "isActive": false }
```

### 200 回應
```json
{ "data": { "id": "clx...", "isActive": false, "...": "更新後完整 card" } }
```

- FR-006：切換即持久化。
- FR-018：`isActive:true` 是卡片回復追蹤的唯一路徑（不由來源連動）。
- 失敗（非 2xx）→ 前端還原開關（FR-012）。

---

## ♻️ PATCH /admin/sources/:id — 切換來源「使用」開關（非最後啟用來源）

既有端點，**重用**（`updateSourceSchema`，本頁只送 `isActive`）。**僅用於「非最後一個啟用來源」的關閉，或來源重新啟用。**

### Request body
```json
{ "isActive": false }
```

### 200 回應
```json
{ "data": { "id": "cls...", "isActive": false, "...": "更新後完整 source" } }
```

- FR-017：不跳 modal、不改變所屬卡片追蹤狀態。
- FR-018：`isActive:true` **不**自動回復卡片追蹤。
- 失敗 → 前端還原（FR-012）。

---

## 🆕 PATCH /admin/sources/:id/deactivate-last — 關閉「最後一個啟用來源」（交易連動）

新增端點。**僅在前端確認 modal 通過後呼叫**，於單一 `prisma.$transaction` 內同時停用來源並將所屬卡片設為不追蹤（FR-015 / FR-016）。

### Request
- 無 body（或空物件）。`:id` 為欲關閉的來源。
- 前置條件由**前端**依該卡已呈現的來源清單判定「這是最後一個啟用來源」；後端專注於原子執行連動。

### 行為
在交易內：
1. `PriceSource.update({ where:{id}, data:{ isActive:false } })`
2. `Card.update({ where:{ id: source.cardId }, data:{ isActive:false } })`

### 200 回應
```json
{
  "data": {
    "source": { "id": "cls...", "isActive": false, "cardId": "clx..." },
    "card":   { "id": "clx...", "isActive": false }
  }
}
```

### 錯誤
- 來源不存在 → `404`。
- 交易任一步失敗 → 整筆 rollback（來源與卡片皆不變），回 5xx；前端一併還原來源與卡片開關並提示（FR-016 / FR-012）。

### 契約測試要點
- 對「僅剩一個啟用來源」的卡呼叫後：該來源 `isActive=false` 且其卡 `isActive=false`，重新查詢兩者一致（SC-008）。
- 交易失敗情境（模擬 card.update 拋錯）：來源 `isActive` 維持原值（rollback 驗證）。
- 單向性：之後對同卡任一來源 `PATCH { isActive:true }`，卡片 `isActive` 仍為 false（FR-018）。

---

## 前端不涉及後端的行為（記錄於此以對齊契約）

- **來源層篩選**（類型 api/crawler、使用狀態 all/active/inactive）：於前端對「已載入來源清單」過濾，**不**發 API（FR-010）。
- **確認 modal 判定**：於前端以已呈現來源清單判定是否為最後啟用來源（FR-015）；後端不提供「依來源反查卡片」查詢（Assumptions）。
- **樂觀更新 / stale-response 捨棄 / 快速連點以最後一次為準**：純前端狀態管理（FR-012 / Edge Cases）。
