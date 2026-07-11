# AI 協作紀錄 — Schema Review

- **工具**：Claude Code
- **日期**：2026-06-30
- **負責人**：Ken
- **任務**：review 既有的資料庫 schema（`packages/db/prisma/schema.prisma`）與相關程式碼，
  比對 PRD 與 6/28 會議紀錄，找出設計疑點並提出決策建議。

## 協作方式（我的角色 vs AI 的角色）

- **我（Ken）**：設定 review 範圍、提出設計疑問、做最終判斷與取捨。
- **Claude**：依我的提問去 repo 撈實際程式碼／PRD 當證據、做正反取捨分析、整理成文件與泳道圖。
- 過程強調「以 code/PRD 為憑據」，不接受沒有根據的結論（途中曾因漏查 PRD 而修正過一次結論）。

## 核心技術發現與決策

| # | 發現（含證據） | 我的決策 |
|---|---|---|
| 1 | condition 放 Card 是 PRD 明文需求（PRD 618），seed/前後端已支援 | 保留現狀，不改 |
| 2 | 多來源時 `latestPrice` 為「最後處理來源說了算」（priceSync.service.js:49,108），偏隨機 | 傾向「去雜訊後取最低價」，不採 primary source（避免淪為單站鏡像） |
| 3 | 冗餘摘要欄位有用 `$transaction` 同步（priceSync.service.js:95-126） | 確認合理，保留 |
| 4 | `priceTwd` 為死欄位：schema/PRD 有定義，但無程式寫入、前端未讀 | MVP 先原樣顯示；priceTwd 待討論「移除 or 補實作」 |
| 5 | `isSuspiciousPrice` 僅靠單一 50% 門檻（normalizePrice.js:45），有 7 項漏洞 | 屬加分功能；若做，優先補「首筆無基準／標記後仍顯示／單點比較」 |
| — | FK：經查去除不簡化實作（Prisma 關聯 ≠ DB 約束） | 保留現狀 |

## 關鍵判斷：幣別換算是「拱心石」

- 釐清項目 2/4/5 的根基都在「是否做幣別換算」。
- 查 PRD：換算屬「加分功能」（602），Must 僅要求「保留幣別」（FR-08）。
- **決策**：MVP 不做換算，改採「多個同幣別來源」策略 → 多來源比價照做、免換算，
  多數疑點自動解決；跨幣別/全球來源列為未來加分。

## 產出

- `docs/`（待入庫）：schema review 完整筆記、重點泳道圖。
- 需團隊拍板事項：Keystone（是否換算）、多來源取價規則、priceTwd 去留。
