# AGENTS.md — Zen (obsidian-zen-plugin)

高度定制的 Obsidian 个人插件仓库。目标仓库（vault）：`../notes/soul`。

## Git 约定

- 默认只在 `main` 分支修改、提交，并推送到 `origin/main`；不要主动创建功能分支。
- 如已有功能分支上的改动，完成后必须合并到 `main`，不能只推送功能分支就结束。
- 用户明确要求独立分支或 worktree 时除外，完成后仍按用户要求合并回 `main`。

## 工作流（重要）

**每次功能更新完成后，必须执行：**

```bash
npm run deploy
```

该命令会：
1. 用 esbuild 构建 `src/main.ts` → `main.js`
2. 将 `main.js` / `manifest.json` / `styles.css` 复制到 `../notes/soul/.obsidian/plugins/obsidian-zen-plugin/`
3. 插件内置热重载（监听自身 main.js 变化后 disable/enable），**改动自动生效，无需重启 Obsidian**

即：改代码 → `npm run deploy` → 生效。不要跳过 deploy 直接结束任务。

## 结构

- `src/main.ts` — 插件入口（Plugin 子类）：界面定制 + 热重载 + 挂载各 feature
- `src/publish/` — 发布功能模块（移植自 obsidian-publish-everywhere，已改名 ZenPublishFeature）
  - `publish-feature.ts` — 模块入口，通过 shim（app/addCommand/loadData…）挂在 ZenPlugin 上
  - `settings.ts` — 设置页（ZenPublishSettingTab）
  - `confluence/ feishu/ notion/ github/ xiaohongshu/ shared/` — 各平台发布实现
- `styles.css` — 界面定制样式（通过 body class 开关）
- `scripts/install.mjs` — 安装到 vault 并自动启用
- `manifest.json` — 插件清单

## 配置

- 发布功能配置存储在 vault 的 `plugins/obsidian-zen-plugin/data.json` 的 **`publish` 键下**（与 Zen 自身配置隔离）
- 已从旧插件迁移（KMS/飞书/Notion 等），data.json 含密钥，严禁提交

## 约定

- 每个界面定制功能用独立的 body class（如 `zen-hide-left-ribbon`）+ styles.css 规则实现，便于后续做设置开关
- 大功能按 `src/<feature>/` 独立目录组织，入口只负责挂载
- `main.js` 为构建产物，不提交；本地通过 deploy 生成

## 功能清单

- [x] 隐藏左侧 Ribbon（顶部动作图标列 + 左下角 vault/帮助/设置栏 `.workspace-sidedock-vault-profile`）：`zen-hide-left-ribbon`
- [x] 隐藏右下角状态栏 `.status-bar`：`zen-hide-status-bar`
- [x] 发布功能（移植自 obsidian-publish-everywhere）：KMS/Confluence、飞书、Notion、GitHub、小红书，命令 `发布到KMS/飞书/Notion/GitHub/小红书`、`🚀 一键发布到所有平台`、复制富文本
- [x] 正文宽度放宽到视口 2/3：`zen-wide-content`
- [x] 日记（src/diary/）：快捷键 Option+Shift+D 新建/打开今日日记，路径 `个人/日记与回忆/日记/YYYY/YYYY-MM/YYYY-MM-DD 周三 日记.md`（中文星期），自动建年/月文件夹，空白无模板
