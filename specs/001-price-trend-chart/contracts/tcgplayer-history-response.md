# Contract — `GET /cards/:id/tcgplayer-history`

**這是本功能唯一的後端契約變更。**

## 變更摘要

回應中每個 bucket **新增 `marketPriceTwd` 欄位**。既有欄位不變、不移除、不改名。
路由、查詢參數、驗證 schema 皆不變。

**相容性**：純新增欄位，既有消費者不受影響。

## 為何必須由後端提供

`marketPrice` 是美金字串。要與台幣線共用同一條縱軸就必須換算，
而匯率存放在 `Currency` 資料表 — 前端沒有取得管道。

替代方案（新增匯率端點、把匯率塞進其他回應）都比在既有函式回傳前多算一個欄位來得大，
因此選擇最小改動（FR-014）。

## 回應結構

```jsonc
{
  "data": {
    "condition": "Near Mint",
    "variant": "Normal",
    "language": "English",
    "buckets": [
      {
        "bucketStartDate": "2026-08-09",
        "marketPrice": "18.11",        // 既有：美金字串
        "quantitySold": "0",           // 既有
        "marketPriceTwd": 543,         // 新增：台幣整數，或 null
        // …其餘既有欄位不變
      }
    ]
  }
}
```

`data` 為 `null` 的既有語意不變（來源未設定、或外部取得失敗）。

## 換算契約

| # | 規則 | 對應 FR |
|---|---|---|
| A1 | 讀 `Currency` 表中 `code: 'USD'` 的 `rateToTwd` | FR-014 |
| A2 | 使用同 app 內既有的 `lib/convertToTwd.js`（依賴方向正確，非跨套件） | — |
| A3 | 匯率查不到 → 整批 bucket 的 `marketPriceTwd` 為 `null`，**不得 throw** | FR-016 |
| A4 | 單一 bucket 換算失敗（`marketPrice` 為 `'0'`、非數字、非有限值）→ 該筆為 `null` | FR-016 |
| A5 | 台幣值為整數（`convertToTwd` 內部已四捨五入） | — |
| A6 | 定位失敗原因的診斷資訊寫入後端紀錄，不得回傳到前台顯示 | FR-034、SC-013 |

`convertToTwd` 既有行為已擋掉 `<= 0` 與非有限值，A4 因此自然成立，無需額外判斷。

## 測試契約

於 `apps/api/src/services/card.service.test.js` 補充：

| 案例 | 預期 |
|---|---|
| 匯率存在、`marketPrice` 正常 | `marketPriceTwd` 為正確的台幣整數 |
| 匯率不存在 | 每個 bucket 的 `marketPriceTwd` 為 `null`，函式不 throw |
| `marketPrice` 為 `'0'` | 該 bucket 的 `marketPriceTwd` 為 `null` |
| 外部請求失敗 | 維持既有行為，回傳 `null`，不 throw |

外部 HTTP 以既有的 `nock` 攔截，不對真實服務發送請求。
