# Specification Quality Checklist: 卡牌詳情頁多來源台幣價格趨勢圖

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-10
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### 第 1 輪驗證 — 1 項未通過

**No [NEEDS CLARIFICATION] markers remain** 未通過，保留 2 個標記：

- **異常價格標示** — 資料模型已有「疑似異常」標記，PRD 亦列有異常價格偵測，
  但來源設計文件未定義圖表要如何處理。照常呈現、視覺標示、排除三種做法都合理，
  且會影響使用者對趨勢的解讀，無法逕自預設。
- **行動裝置呈現** — 來源設計文件完全未涵蓋窄螢幕。多條線搭配最長區間
  在手機上的可讀性有實質疑慮，降級方式有多種合理選擇。

撰寫時已主動移除來源設計文件中的實作細節（檔案路徑、函式簽章、套件名稱、
外部 API 端點與參數），改以使用者可觀察的行為描述，因此 Content Quality 四項均通過。

### 第 2 輪驗證 — 全數通過

使用者裁示後補齊兩處：

- **異常價格** → 照常呈現且不排除（FR-021），視覺上可區分（FR-022），
  檢視該日時能得知其為疑似異常（FR-023）。連帶新增 US1 驗收情境 5、SC-009，
  以及「異常值拉歪縱軸尺度」的邊界情境。
- **窄螢幕** → 僅提供 7 天與 1 個月，3 個月不可選（FR-024）；
  已選 3 個月後畫面縮窄時自動退回 1 個月（FR-025）。連帶新增 US3 驗收情境 4、5、
  SC-010，以及視窗縮放與窄螢幕多線可讀性的邊界情境。

**一併修正的內部矛盾**：FR-010（三個區間皆可切換）與 FR-024（窄螢幕僅兩個）
語意衝突，已在 FR-010 加註例外指向 FR-024。

編號經檢查連續且無重複：FR-001～FR-028、SC-001～SC-010。

### 尚未解決的外部前提

`.specify/memory/constitution.md` 仍是未填寫的空白樣板，本次無專案原則可供檢核。
若要在後續階段做治理層級的把關，需先執行 `/speckit-constitution`。
