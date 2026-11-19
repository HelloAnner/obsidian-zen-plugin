import { MarkdownView, Plugin } from 'obsidian';

/**
 * Zen 标题自动编号（写入源文）
 * 约定：H2(##) 是顶层章节 → `## 1. xxx`；H3 → `### 1.1 xxx`；H4 → `### 1.1.1 xxx` …（H1 不编号）
 *
 * 触发：打开笔记 / 编辑停顿（防抖 800ms）时扫描当前笔记，
 * 只替换编号前缀区（最小化改动），用单个 CM 事务提交（一次 undo 可全部撤销，
 * 光标位置自动重映射，正在编辑的行也能安全更新）。
 */
export class ZenHeadingNumbersFeature {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', () => this.scheduleScan(300))
    );
    this.plugin.registerEvent(
      this.app.workspace.on('editor-change', () => this.scheduleScan(800))
    );
    this.app.workspace.onLayoutReady(() => this.scheduleScan(500));
  }

  private scheduleScan(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.scanActiveNote(), delay);
  }

  private scanActiveNote(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    const editor = view.editor;

    const counters = [0, 0, 0, 0, 0, 0, 0]; // 下标 = 标题级别
    // 最小化改动：只替换「## 」之后到正文之前的编号前缀区，正文不动，光标自动重映射
    const edits: { line: number; prefixFromCh: number; prefixToCh: number; insert: string }[] = [];
    let inFrontmatter = false;
    let inCodeBlock = false;

    for (let i = 0; i < editor.lineCount(); i++) {
      const text = editor.getLine(i);
      const trimmed = text.trim();

      // 跳过 frontmatter 与代码块
      if (i === 0 && trimmed === '---') { inFrontmatter = true; continue; }
      if (inFrontmatter) {
        if (trimmed === '---' || trimmed === '...') inFrontmatter = false;
        continue;
      }
      if (trimmed.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) continue;

      const m = /^(#{1,6})\s+(.*)$/.exec(text);
      if (!m) continue;
      const level = m[1].length;
      if (level === 1) continue; // H1 不编号

      counters[level]++;
      for (let l = level + 1; l <= 6; l++) counters[l] = 0;

      const desiredPrefix =
        level === 2
          ? `${counters[2]}. `
          : `${Array.from({ length: level - 1 }, (_, k) => counters[k + 2]).join('.')} `;

      // 已有数字前缀（必须带点，避免误伤「## 2026 年计划」这类纯数字开头）
      const prefixMatch = /^\d+(?:\.\d+)+\.?\s+|^\d+\.\s+/.exec(m[2]);
      const oldPrefix = prefixMatch ? prefixMatch[0] : '';

      if (oldPrefix !== desiredPrefix) {
        const prefixFromCh = m[1].length + 1; // 「## 」之后
        edits.push({
          line: i,
          prefixFromCh,
          prefixToCh: prefixFromCh + oldPrefix.length,
          insert: desiredPrefix,
        });
      }
    }

    if (edits.length === 0) return;

    // 单个 CM 事务应用全部改动：光标自动重映射，一次 undo 撤销
    const cm = (editor as unknown as { cm?: any }).cm;
    if (cm?.dispatch && cm.state?.doc) {
      const changes = edits.map((e) => {
        const line = cm.state.doc.line(e.line + 1);
        return { from: line.from + e.prefixFromCh, to: line.from + e.prefixToCh, insert: e.insert };
      });
      cm.dispatch({ changes });
    } else {
      for (const e of edits) {
        editor.replaceRange(e.insert, { line: e.line, ch: e.prefixFromCh }, { line: e.line, ch: e.prefixToCh });
      }
    }
  }
}
