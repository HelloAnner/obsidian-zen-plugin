import { MarkdownView, Notice, Plugin } from 'obsidian';

/**
 * Zen 马克笔高亮
 * 固化快捷键 Cmd+Shift+H：选中文字 → 包裹 ==高亮==；已高亮则取消。
 * 配色见 styles.css（zen-ink 下的 mark/.cm-highlight 马克笔黄底）。
 */
export class ZenHighlightFeature {
  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    this.plugin.addCommand({
      id: 'toggle-marker-highlight',
      name: '切换马克笔高亮',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'h' }],
      editorCallback: (editor) => {
        if (!(this.app.workspace.getActiveViewOfType(MarkdownView))) return;
        this.toggle(editor);
      },
    });
  }

  private toggle(editor: import('obsidian').Editor): void {
    const selection = editor.getSelection();
    if (!selection) {
      new Notice('请先选中要高亮的文字');
      return;
    }

    const from = editor.getCursor('from');
    const to = editor.getCursor('to');

    // 情况 1：选区本身带 == == 包裹 → 去掉
    if (selection.startsWith('==') && selection.endsWith('==') && selection.length > 4) {
      editor.replaceSelection(selection.slice(2, -2));
      return;
    }

    // 情况 2：选区紧邻两侧各有 ==（即光标划的是已高亮文字内部）→ 去掉两侧标记
    const before = from.ch >= 2 ? editor.getRange({ line: from.line, ch: from.ch - 2 }, from) : '';
    const after = editor.getRange(to, { line: to.line, ch: to.ch + 2 });
    if (before === '==' && after === '==') {
      editor.replaceRange('', { line: from.line, ch: from.ch - 2 }, from);
      editor.replaceRange('', to, { line: to.line, ch: to.ch + 2 });
      return;
    }

    // 情况 3：加上高亮
    editor.replaceSelection(`==${selection}==`);
  }
}
