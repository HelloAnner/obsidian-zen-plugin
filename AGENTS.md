# AGENTS.md — Zen (obsidian-zen-plugin)

高度定制的 Obsidian 个人插件仓库。目标仓库（vault）：`../notes/soul`。

## Git 约定

- 默认只在 `main` 分支修改、提交，并推送到 `origin/main`；不要主动创建功能分支。
- 如已有功能分支上的改动，完成后必须合并到 `main`，不能只推送功能分支就结束。
- 用户明确要求独立分支或 worktree 时除外，完成后仍按用户要求合并回 `main`。

## 工作流（重要）

**每次修改插件功能、样式或修复问题后，都必须主动完成部署，无需用户再次提醒或确认。仅修改文档时也按本项目约定执行一次部署检查。**

结束任务前必须执行：

```bash
npm run deploy
```

该命令会：
1. 用 esbuild 构建 `src/main.ts` → `main.js`
2. 将 `main.js` / `manifest.json` / `styles.css` 复制到 `../notes/soul/.obsidian/plugins/obsidian-zen-plugin/`
3. 插件内置热重载（监听自身 main.js 变化后 disable/enable），**改动自动生效，无需重启 Obsidian**

固定流程：修改 → `npm run deploy` → 等待热重载 → 验证实际生效 → 提交并推送 `main`。

- 不得仅完成源码修改、构建或 push 就结束；必须部署到目标 vault。
- 部署后确认目标文件与源码/构建产物一致；涉及界面时，在实际 Obsidian 中验证，不能只以命令退出码判断生效。
- 热重载有延迟，验证时须等其完成；若自动重载未生效，主动检查并重新加载插件。
- 部署或验证失败时继续排查；如确实受阻，明确说明失败原因与未完成步骤，不得声称已生效。
- 最终回复说明部署及验证结果，并告知 `main` 的提交和推送状态。

## 结构

- `src/main.ts` — 插件入口（Plugin 子类）：界面定制 + 热重载 + 挂载各 feature
- `src/file-reveal/` — 切换笔记时展开左侧文件树祖先目录并居中当前行；使用原生虚拟树定位，不抢编辑器焦点，不使用平滑滚动。接近滚动首尾时以实际可滚动范围为准。
- `src/note-switcher/` — 会话内固定顺序笔记列表：独立状态模型、原生 ItemView、事件与快捷键控制；页签布局复用 Obsidian 原生拖拽分栏，不自行实现停靠布局。
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

## 笔记切换列表约定

- 列表仅存内存；新打开的 Markdown 笔记追加末尾，已存在的笔记只更新当前指针，不改变用户顺序。
- 列表使用紧凑纯标题样式，不显示编号、工具栏或说明文字；长按拖动排序使用 SortableJS，悬停或键盘聚焦时才显示移除按钮。
- 列表中的移除操作仅移除条目，严禁删除笔记文件；排序与当前选择分别维护。
- `Option + ↑ / ↓` 按固定列表顺序切换，首尾不循环；保留命令入口供用户自定义快捷键。每篇笔记分别保存内存中的原生视图状态和临时状态，切回时恢复模式、滚动位置与光标选区。
- 快捷输入：`Ctrl + Enter` 在空行插入 `- [ ] `，非空行复用原生待办切换；`Option + Shift + C` 在光标处插入本地时间 `YYYY-MM-DD HH:mm:ss`。
- 使用 Obsidian 原生视图页签，允许拖动到侧栏下半区或其他分栏；不能因单文档模式而误关闭该视图，也不能在切换笔记时重置用户停靠布局。

## 功能清单

- [x] 隐藏左侧 Ribbon（顶部动作图标列 + 左下角 vault/帮助/设置栏 `.workspace-sidedock-vault-profile`）：`zen-hide-left-ribbon`
- [x] 隐藏右下角状态栏 `.status-bar`：`zen-hide-status-bar`
- [x] 发布功能（移植自 obsidian-publish-everywhere）：KMS/Confluence、飞书、Notion、GitHub、小红书，命令 `发布到KMS/飞书/Notion/GitHub/小红书`、`🚀 一键发布到所有平台`、复制富文本
- [x] 正文宽度放宽到视口 2/3：`zen-wide-content`
- [x] 日记（src/diary/）：快捷键 Option+Shift+D 新建/打开今日日记，路径 `个人/日记与回忆/日记/YYYY/YYYY-MM/YYYY-MM-DD 周三 日记.md`（中文星期），自动建年/月文件夹，空白无模板
