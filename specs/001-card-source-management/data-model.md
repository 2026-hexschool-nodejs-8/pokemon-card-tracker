# Phase 1 Data Model: 後台卡片與來源管理總覽頁

> **重要：本功能不需要 Prisma migration。** 下列實體與欄位皆為既有 schema（`packages/db/prisma/schema.prisma`）已存在者，本頁只是**檢視 + 兩層開關操作**的介面，不改變資料定義。此文件說明本頁「用到哪些既有欄位、代表什麼、以及新增的 query/連動語意」。

## 實體：Card（卡片）

沿用既有 `model Card`。本頁使用的欄位與用途：

| 欄位 | 型別 | 本頁用途 | 對應 FR |
|------|------|---------|---------|
| `id` | String (cuid) | Accordion item 識別、分頁 cursor、來源延遲載入的 key | FR-003/FR-004 |
| `name` | String | 摘要列：卡名 | FR-002 |
| `cardNumber` | String | 摘要列：卡號；卡片關鍵字篩選比對對象之一 | FR-002/FR-009 |
| `setName` | String? | 摘要列：系列 | FR-002 |
| `language` | String | 摘要列：語言；卡片語言篩選 | FR-002/FR-009 |
| `condition` | String | 摘要列：狀態別（condition/grade）；卡片狀態別篩選 | FR-002/FR-009 |
| `isActive` | Boolean | **卡片「追蹤」開關**；追蹤狀態篩選；兩層語意上層 | FR-002/FR-006/FR-008/FR-009 |
| `latestPrice` | Float? | 摘要列：最新價（null → 顯示「—」） | FR-002 |
| `latestCurrency` | String? | 摘要列：最新價幣別 | FR-002 |
| `lastFetchedAt` | DateTime? | 摘要列：最後更新時間（null → 顯示「—」） | FR-002 |
| `updatedAt` | DateTime | 清單預設排序鍵（新→舊） | Assumptions（預設排序） |
| `_count.sources` | （聚合） | 摘要列：來源數量（既有 `include` 提供） | FR-002 |

**衍生/計算值（非欄位）**：
- **來源數量**：`_count.sources`（全部來源，含停用）。
- **卡片追蹤狀態顯示**：`isActive === true` → 「追蹤中」；`false` → 「停用」。

**狀態轉移（本頁可觸發）**：
- 追蹤 ON→OFF：`PATCH /admin/cards/:id { isActive:false }`（FR-006）。
- 追蹤 OFF→ON：`PATCH /admin/cards/:id { isActive:true }`（FR-006，唯一讓卡片回復追蹤的路徑，FR-018）。
- **被動 ON→OFF（連動）**：關閉該卡最後一個啟用來源時，由 `deactivate-last` 交易將 `isActive` 設為 false（FR-016）。此為單向；不存在「來源恢復 → 卡片自動回復追蹤」的轉移（FR-018）。

## 實體：PriceSource（價格來源）

沿用既有 `model PriceSource`。本頁使用的欄位與用途：

| 欄位 | 型別 | 本頁用途 | 對應 FR |
|------|------|---------|---------|
| `id` | String (cuid) | 來源列識別；toggle / deactivate-last 目標 | FR-007 |
| `cardId` | String | 隸屬卡片（一來源只屬一卡） | Assumptions |
| `type` | SourceType(`api`/`crawler`) | 來源明細：類型；來源類型篩選 | FR-005/FR-010 |
| `provider` | String | 來源明細：來源名稱 | FR-005 |
| `currency` | String | 來源明細：幣別 | FR-005 |
| `isActive` | Boolean | **來源「使用」開關**；使用狀態篩選；兩層語意下層 | FR-005/FR-007/FR-010 |
| `lastSuccessAt` | DateTime? | 來源明細：最後成功時間 | FR-005 |
| `lastError` | String? | 來源明細：最後錯誤訊息（若有） | FR-005 |

**狀態轉移（本頁可觸發）**：
- 使用 ON→OFF（非最後啟用來源）：`PATCH /admin/sources/:id { isActive:false }`，**不**影響卡片（FR-017）。
- 使用 ON→OFF（**是**該卡最後一個啟用來源）：先確認 modal → `PATCH /admin/sources/:id/deactivate-last`（交易同時停用來源 + 卡片，FR-015/FR-016）。
- 使用 OFF→ON：`PATCH /admin/sources/:id { isActive:true }`，**不**自動回復卡片追蹤（FR-018）。

## 關聯與兩層追蹤語意（既有，忠實呈現）

```
Card (1) ──< (N) PriceSource        // 一張卡多個來源；一個來源只屬一張卡
```

- **是否會被抓取** = `PriceSource.isActive === true` **且** 其 `Card.isActive === true`（兩者同時成立）。任一為 false 即被排除。此為既有抓價 job 挑選語意，本頁**不修改**（FR-014），僅在 UI 明確標示：當 `Card.isActive === false` 時，其下即使 `PriceSource.isActive === true` 的來源也「不會被抓取」（FR-008）。
- **「最後一個啟用來源」判定**：對某卡當前已載入的來源清單中，`isActive === true` 的數量為 1，且被關閉者即該來源時成立（FR-015；由前端就已呈現清單判定，不新增反查查詢）。

## 新增的查詢/操作語意（非資料結構）

1. **卡片分頁查詢（cursor）**：`GET /admin/cards` 以 `cursor`(card id) + `limit`(預設 20) 分批，回應附 `nextCursor`（無更多為 `null`）。排序 `updatedAt desc`，cursor 以 `id` 定位。
2. **交易連動**：`deactivate-last` 於單一 `prisma.$transaction` 內更新 source 與其 card 的 `isActive`，保證原子（FR-016）。

## 驗證規則（`packages/shared`，Principle II）

- **`adminListCardsQuerySchema`（擴充）**：新增
  - `cursor`: `string` optional（cuid，上一批最後一張卡 id）
  - `limit`: 由字串轉數字、正整數、預設 20、上限 50
  - 既有 `keyword` / `language` / `grade` / `isActive` 不變。
- **來源層篩選**：作用於前端已載入清單，型別為 `{ type?: 'api'|'crawler', usage?: 'all'|'active'|'inactive' }`；可選擇於 `source.schema.js` 定義共用常數/schema 供前端驗證（後端不接此參數）。
- 既有 `updateCardSchema`（含 `isActive?`）與 `updateSourceSchema`（含 `isActive?`）**沿用**，不改動，供兩個 toggle 端點重用。
