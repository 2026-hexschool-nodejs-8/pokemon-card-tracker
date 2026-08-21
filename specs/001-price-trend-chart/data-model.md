# Phase 1 — Data Model

**Feature**: 卡牌詳情頁多來源台幣價格趨勢圖
**Date**: 2026-08-10

> 本功能**不修改資料庫 schema，不需要 migration**。
> 下列前三個實體為既有的持久化模型（僅列出本功能會讀取的欄位）；
> 其後為本功能新增的**記憶體內視圖模型**，只存在於執行期，不落地。

---

## 既有持久化實體（唯讀）

### PriceSnapshot

系統自行抓取的價格快照。本功能是唯讀消費者。

| 欄位 | 型別 | 本功能用途 |
|---|---|---|
| `provider` | string | 決定屬於哪一條線（FR-003） |
| `price` | number | 原幣金額，僅供對照表格使用，不入圖 |
| `currency` | string | 原幣別，不入圖 |
| `priceTwd` | number \| null | **縱軸的值**。為 `null` 者不得入圖（FR-007） |
| `fetchedAt` | DateTime | 分桶依據（FR-002、FR-009）與同日去重依據（FR-006） |
| `isSuspicious` | boolean | 決定資料點形狀與提示文字（FR-021～023） |

**驗證規則**：
- `priceTwd !== null` 才納入（嚴格等值，依專案慣例）
- 同一 `(本地日期, provider)` 若有多筆，取 `fetchedAt` 最大者（FR-006）

### PriceSource

卡牌的價格來源設定。本功能不直接讀取，`provider` 由快照攜帶。

### Currency

外幣對台幣匯率。**僅後端讀取**，用於把外部市場行情的美金價換算成台幣（FR-014）。
前端無法存取，這是後端需要改動的唯一原因。

| 欄位 | 型別 | 本功能用途 |
|---|---|---|
| `code` | string | 查 `'USD'` |
| `rateToTwd` | number | 換算係數 |

---

## 外部資料（非持久化）

### TcgplayerHistoryBucket

外部平台公布的市場行情，於使用者檢視當下即時取得，不寫入資料庫。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `bucketStartDate` | string `YYYY-MM-DD` | 該筆行情的日期 |
| `marketPrice` | string | 美金金額字串，例如 `'18.11'` |
| `quantitySold` | string | 成交量字串，多數為 `'0'` |
| `marketPriceTwd` | number \| null | **本功能新增**：後端換算後的台幣值 |

**驗證規則**：
- `marketPrice` 為 `'0'` 或無法解析時，`marketPriceTwd` 為 `null`（`convertToTwd` 已擋 `<= 0`）
- 匯率查不到時整批 `marketPriceTwd` 皆為 `null`，且不得 throw（FR-016）
- bucket 粒度可能粗於一天，缺漏的日期不得補值（FR-031）

---

## 視圖模型（記憶體內，本功能新增）

### SeriesDescriptor

描述圖上的一條線。由整形函式產出，驅動 `<Line>` 的渲染。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `key` | string | 資料鍵，對應 `ChartPoint` 中的欄位名 |
| `label` | string | 圖例顯示名稱 |
| `isExternal` | boolean | 是否為外部市場行情（用於 FR-015 的命名區隔） |
| `color` | string | 依索引取自顏色盤（FR-029） |
| `dash` | string | 依索引取自線型盤，對應 `strokeDasharray`（FR-029、FR-030） |

**排序規則**（決定顏色與線型的分配，FR-029）：
我方 provider 依名稱字母序在前，外部市場行情固定排最後。
排序穩定則視覺樣式穩定，重繪不跳色。

**唯一性**：`key` 在單次產出中唯一。外部市場行情使用固定常數為 key，
與我方 provider 名稱不會衝突 — 即使某卡牌本身設有同名的 `tcgplayer` 來源，
兩者仍是不同的 `key`，滿足 FR-015。

### ChartPoint

橫軸上的一格，代表一個本地日期。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `dateKey` | string `YYYY-MM-DD` | 本地日期，排序與比對用 |
| `label` | string | 橫軸顯示文字 |
| `[series.key]` | number \| null | 各 series 當日的台幣值；`null` 代表當日無資料（FR-008） |

**額外附掛欄位**（以 `__` 前綴標示，不繪製成線）：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `__suspicious` | object | `{ [seriesKey]: true }`，標示當日哪些 series 為疑似異常（FR-022、FR-023） |
| `__tcgQuantitySold` | number \| null | 外部市場行情當日成交量，供提示顯示（FR-017） |

**日期骨架規則**（FR-012）：
連續每日不跳號，起點為 `max(今日 - days + 1, 最早有資料的日期)`，終點為今日。
不硬補滿整個區間，避免資料稀少時長區間出現大片空白。

---

## 狀態（元件內）

| 狀態 | 型別 | 說明 |
|---|---|---|
| 觀察區間 | `7 \| 30 \| 90` | 預設 7；窄螢幕不得為 90（FR-024、FR-025） |
| 外部市場行情快取 | `{ month?, quarter? }` | 每種粒度最多取得一次（FR-032），存於 ref 不觸發重繪 |
| 是否窄螢幕 | boolean | 由 `matchMedia` 提供 |

**狀態轉換**：

- 使用者選擇區間 → 更新區間 → 若映射後的外部 range 未快取則非阻塞取得
- 畫面由寬變窄且當前區間為 90 → 自動改為 30（FR-025）
- 外部市場行情到達 → 併入資料 → 重繪（期間不顯示載入指示，FR-033）
