# Contract — `apps/web/src/lib/priceSeries.js`

純函式模組，不 import React、不觸發 I/O。可由 `node --test` 直接測試。

## 匯出

```js
export const TCG_MARKET_SERIES_KEY   // 外部市場行情的 series key（常數）
export const TCG_MARKET_SERIES_LABEL // 圖例顯示名稱：可與我方 tcgplayer 來源區分（FR-015）
export const RANGE_DAYS              // 三個觀察區間的天數：7 / 30 / 90（FR-010）
export function buildDailySeries(input) → output
```

## `buildDailySeries` 輸入

| 參數 | 型別 | 必要 | 說明 |
|---|---|---|---|
| `snapshots` | `PriceSnapshot[]` | 是 | 頁面既有的完整快照陣列；空陣列合法 |
| `tcgBuckets` | `TcgplayerHistoryBucket[] \| null` | 是 | 外部市場行情；`null` 代表尚未取得或取得失敗 |
| `days` | `7 \| 30 \| 90` | 是 | 觀察區間長度（FR-010，固定天數） |
| `now` | `Date` | 否 | 「今日」的基準，預設為當下。**存在的唯一目的是讓測試可決定性地驗證日期邏輯** |

## `buildDailySeries` 輸出

```js
{
  series: SeriesDescriptor[],  // 見 data-model.md
  points: ChartPoint[],        // 見 data-model.md，依 dateKey 升冪
}
```

## 行為契約

| # | 規則 | 對應 FR |
|---|---|---|
| C1 | 日期分桶一律以**本地時區**取 `YYYY-MM-DD`，不得使用 `toISOString().slice(0,10)` | FR-009 |
| C2 | 僅納入 `priceTwd !== null` 的快照（嚴格等值） | FR-007 |
| C3 | 同一 `(本地日期, provider)` 有多筆時，取 `fetchedAt` 最大者 | FR-006 |
| C4 | `points` 為連續每日、不跳號；起點 `max(今日 - days + 1, 最早有資料日)`，終點今日 | FR-002、FR-012 |
| C5 | 某 series 當日無資料 → 該欄位為 `null`（由圖表層決定連線行為） | FR-008 |
| C6 | 外部市場行情依 `bucketStartDate` 對進骨架；缺漏日期維持 `null`，**不補值、不插值** | FR-031 |
| C7 | `series` 排序：我方 provider 字母序在前，外部市場行情固定最後 | FR-029 |
| C8 | `series` 只包含該區間內**實際有資料**的來源 | FR-003 |
| C9 | 疑似異常標記寫入 `point.__suspicious[seriesKey]` | FR-022、FR-023 |
| C10 | 外部市場行情成交量寫入 `point.__tcgQuantitySold` | FR-017 |

## 邊界情境

| 輸入 | 預期輸出 |
|---|---|
| `snapshots` 為空且 `tcgBuckets` 為 `null` | `{ series: [], points: [] }`，不 throw |
| 所有 `priceTwd` 皆為 `null` | `series` 為空（呼叫端據此顯示換算失敗訊息，FR-019） |
| 僅單一天有資料 | `points` 長度 1，正常回傳（FR-020） |
| `tcgBuckets` 的日期落在骨架範圍外 | 忽略該 bucket，不擴張骨架 |
| `marketPriceTwd` 為 `null` 的 bucket | 該日外部市場行情欄位為 `null`，等同無資料 |
| 快照的 `fetchedAt` 接近本地午夜 | 依本地日期歸屬，不得跨日錯置（FR-009） |

## 不屬於本模組的職責

- 顏色與線型的**實際色值**由圖表層提供；本模組只負責決定**順序與索引**
- 連線與否（`connectNulls`）由圖表層決定
- 任何網路請求
