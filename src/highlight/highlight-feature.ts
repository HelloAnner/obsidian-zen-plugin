import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';

/**
 * Zen 文字标注（马克笔/波浪线/删除线）
 *  - Cmd+Shift+H：==高亮==（马克笔黄底）
 *  - Cmd+Shift+U：<u class="zen-wavy">波浪下划线</u>
 *  - Cmd+Shift+D：~~删除线~~
 * 均为切换式：已包裹则取消包裹。
 */
export class ZenHighlightFeature {
  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    this.registerCommand('toggle-marker-highlight', '切换马克笔高亮', 'h', '==', '==');
    this.registerCommand('toggle-wavy-underline', '切换波浪下划线', 'u', '<u class="zen-wavy">', '</u>');
    this.registerCommand('toggle-strikethrough', '切换删除线', 'd', '~~', '~~');
  }

  private registerCommand(id: string, name: string, key: string, open: string, close: string): void {
    this.plugin.addCommand({
      id,
      name,
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key }],
      editorCallback: (editor) => {
        if (!this.app.workspace.getActiveViewOfType(MarkdownView)) return;
        this.toggleWrap(editor, open, close);
      },
    });
  }

  private toggleWrap(editor: Editor, open: string, close: string): void {
    const selection = editor.getSelection();
    if (!selection) {
      new Notice('请先选中文字');
      return;
    }

    // 情况 1：选区本身带包裹 → 去掉
    if (
      selection.startsWith(open) &&
      selection.endsWith(close) &&
      selection.length > open.length + close.length
    ) {
      editor.replaceSelection(selection.slice(open.length, selection.length - close.length));
      return;
    }

    // 情况 2：选区紧邻两侧是包裹标记（划的是已标注文字内部）→ 去掉两侧
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const before =
      from.ch >= open.length ? editor.getRange({ line: from.line, ch: from.ch - open.length }, from) : '';
    const after = editor.getRange(to, { line: to.line, ch: to.ch + close.length });
    if (before === open && after === close) {
      editor.replaceRange('', { line: from.line, ch: from.ch - open.length }, from);
      editor.replaceRange('', to, { line: to.line, ch: to.ch + close.length });
      return;
    }

    // 情况 3：加上标注
    editor.replaceSelection(`${open}${selection}${close}`);
  }
}
