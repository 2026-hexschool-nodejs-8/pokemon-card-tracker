---
name: writing-conventional-commits
description: 依 Conventional Commits v1.0.0 產生 commit message 或 PR 文案。只要使用者想寫 commit、說「幫我 commit」「產 commit message」「寫個 commit 訊息」，或提供了 commit hash / branch 區間（如 abc123..def456、「從 X 到 Y 的改動」）想整理成 PR title 與 description，都要使用這個 skill。英文情境（"write a commit message"、"generate PR description"、提到 conventional commits）也適用。
---

# Conventional Commit 訊息產生器

依 [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) 產生 commit message 或 PR 文案。
完整 16 條規範細節在 [references/spec-v1.0.0.md](references/spec-v1.0.0.md)，遇到邊界情況（footer 解析規則、大小寫、`BREAKING-CHANGE` 同義詞）再去查。

## 第一步：判斷模式

- 使用者輸入包含**區間**（`A..B`、`A...B`、兩個 hash、「從 A 到 B」、branch 名稱比較）→ 對方很可能是要發 PR。若沒有明講，先用一個問題確認：「要產 PR title 與 description 嗎？還是其他用途？」確認後走 **PR 模式**。
- 只給**單一 hash** → 意圖不明確，先問清楚（是要看那一個 commit，還是從它到 HEAD 的區間？）。
- 其他情況（沒給區間）→ 走 **Commit 模式**，處理 staged 區的改動。

## Commit 模式

1. 先看狀態：`git status --short` 與 `git diff --cached --stat`。
   - **staged 區是空的** → 不要自作主張 `git add`。列出 working tree 的變更，問使用者要 stage 哪些檔案，等確認後再繼續。
2. 讀實際改動：`git diff --cached`。diff 很大時先看 stat 挑出核心檔案，理解「為什麼改」而不只是「改了什麼」——commit message 要傳達意圖，不是逐行流水帳。
3. 判斷 type、scope、是否 breaking change（判斷依據見下方「格式規則」）。
4. **staged 內容混了多個不相干的改動**（例如一個 bug fix 加一個新功能）→ 依規範 FAQ 的建議，提出拆成多次 commit 的方案（哪些檔案一組、各自的訊息），讓使用者選擇拆開或合併成一則。
5. 用 code block 呈現完整訊息，然後問使用者：直接 commit／要修改／只要文字。
   - 執行 commit 用 heredoc 保留換行：

     ```bash
     git commit -m "$(cat <<'EOF'
     feat(api): ...
     EOF
     )"
     ```

## PR 模式

1. 檢視區間：`git log --oneline A..B` 與 `git diff --stat A..B`。
   - 區間是空的或 hash 無效 → 回報實際看到的狀況，跟使用者確認正確的區間，不要猜。
   - 區間內的 merge commit 不用列入變更內容，用 `git log --oneline --no-merges A..B` 聚焦實質改動即可。
2. 讀 `git diff A..B` 理解整段改動的全貌（不是逐個 commit 摘要拼貼，PR 描述要講整體目的）。
3. 產出：
   - **PR title**：同 conventional commit 標題格式，概括整段改動最主要的意圖。語言慣例與 commit 模式相同（type / scope 英文小寫、描述繁體中文），description 內文也用繁體中文。
   - **PR description**：使用這個模板：

     ```markdown
     ## 摘要

     （為什麼做這個改動、解決什麼問題，2-3 句）

     ## 變更內容

     - （條列主要變更）

     ## 測試方式

     - （怎麼驗證這些改動，例如跑哪個指令、看哪個頁面）
     ```

4. 問使用者是否要直接用 `gh pr create` 開 PR（base 需與使用者確定，開之前確認目前 branch 已 push 到 remote）。若只要文字就到此為止。

## 格式規則（速查）

```
<type>[optional scope][!]: <description>

[optional body]

[optional footer(s)]
```

| type | 使用時機 | SemVer |
|------|---------|--------|
| `feat` | 新增功能 | MINOR |
| `fix` | 修 bug | PATCH |
| `docs` | 只改文件 | — |
| `style` | 格式調整，不影響邏輯 | — |
| `refactor` | 重構，非修 bug 也非新功能 | — |
| `perf` | 效能改善 | — |
| `test` | 增修測試 | — |
| `build` | 建置系統或外部依賴 | — |
| `ci` | CI 設定 | — |
| `chore` | 其他雜項（不動 src / test） | — |
| `revert` | 撤銷先前的 commit | — |

- **scope**：描述改動範圍的名詞，放在小括號內。本專案（monorepo）常用 `api`、`web`、`db`、`shared`，對應 workspaces；跨多個 workspace 就省略 scope。其他 repo 從變更路徑推斷。
- **breaking change**：在 type/scope 後加 `!`（如 `feat(api)!:`），或在 footer 加 `BREAKING CHANGE: 說明`（必須全大寫）。兩者擇一即可，影響 SemVer MAJOR。
- **footer**：token 用 `-` 代替空白（如 `Reviewed-by:`、`Refs: #123`），`BREAKING CHANGE` 是唯一例外。
- **語言慣例（本專案）**：type / scope / footer token 用英文小寫；description 與 body 用繁體中文；description 結尾不加句號；標題行盡量不超過 72 字元。

## 範例

**單純的新功能：**

```
feat(web): API base 支援正式環境變數，為 Render 部署鋪路
```

**帶 body 與 footer 的修正：**

```
fix(api): normalizePrice 擋掉 0 與 NaN，避免污染價格快照

- 來源回傳 0 或非數字時直接略過，不寫入 PriceSnapshot
- 失敗紀錄寫進 PriceFetchLog 方便追查

Refs: #42
```

**breaking change：**

```
feat(db)!: PriceSnapshot 改用複合主鍵 (cardId, fetchedAt)

BREAKING CHANGE: 既有查詢需改用複合鍵，舊的 id 欄位已移除
```
