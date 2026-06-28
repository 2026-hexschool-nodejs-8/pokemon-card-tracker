# CLAUDE.md － apps/api（後端）

Express 後端，負責 Card / Price / Job API、抓價排程與 JWT 後台驗證。

## 目錄職責

```
src/
  routes/       Express router（薄層，只做驗證與呼叫 service）
  services/     業務邏輯（priceSync 主流程、card 查詢）
  adapters/     各價格來源，統一輸出 PriceResult（見 contract.js）
  scheduler/    node-cron 排程
  middleware/   adminAuth（JWT）、errorHandler
  lib/          jwt / password / normalizePrice / timeout / logger 等工具
  scripts/      runJobOnce（不啟動 server 跑一次抓價）
```

## 慣例

- **route 不寫業務邏輯**，驗證用 `@pct/shared` 的 Zod schema，邏輯丟給 `services/`。
- async route 一律用 `asyncHandler` 包裝，錯誤丟給 `errorHandler` 統一處理。
- 主動丟錯用 `lib/httpError.js`（`notFound()` / `badRequest()` …）。
- 新增價格來源：在 `adapters/` 寫一個實作 `{ type, name, fetchPrice(source) }` 的物件，
  到 `adapters/registry.js` 註冊。**不要把 HTML / API 解析細節漏到 service**。
- 真實來源接法：把 mock adapter 內的 `simulateXxx` 換成 `fetch(source.url)` + 解析即可，輸出格式不變。

## 抓價主流程

入口是 `services/priceSync.service.js` 的 `runPriceSync({ triggerType, cardId })`：
建立 job → 撈啟用來源 → 逐一抓（含 timeout）→ 清洗 → 寫 snapshot → 更新 card 摘要 → 寫 log → 結算 job 狀態。

## Demo 小技巧

來源的 `url` 或 `externalId` 含 `fail` 字串時，mock adapter 會故意丟錯，
方便展示「單一來源失敗、job 變 partial_success、log 記錄錯誤」的流程。
