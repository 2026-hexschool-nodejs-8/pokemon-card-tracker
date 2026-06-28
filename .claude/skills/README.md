# 團隊共用 Skills

放在這裡的 skill 會隨 repo 一起進版控，全組 clone 下來都能用。

每個 skill 是一個資料夾，內含 `SKILL.md`：

```
.claude/skills/
└── seed-demo-data/
    └── SKILL.md
```

`SKILL.md` 範例：

```markdown
---
name: seed-demo-data
description: 重建 Demo 用的 seed 資料（成果發表前用）
---

執行步驟：
1. `npm run db:reset`
2. `npm run db:seed`
3. `npm run job:once` 跑一次抓價驗證主流程
```

> 個人專屬、不想分享的 skill 請放在自己的 `~/.claude/skills/`，不要放這裡。
