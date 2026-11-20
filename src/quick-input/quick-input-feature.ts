import { Plugin } from 'obsidian';

export function formatLocalDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Editing shortcuts use literal Ctrl/Alt, not Command on macOS. */
export class ZenQuickInputFeature {
  constructor(private plugin: Plugin) {}

  load(): void {
    this.plugin.addCommand({
      id: 'quick-todo',
      name: '快速输入待办事项',
      hotkeys: [{ modifiers: ['Ctrl'], key: 'Enter' }],
      editorCallback: (editor) => {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        if (!line.trim()) {
          const prefix = `${line}- [ ] `;
          editor.replaceRange(prefix, { line: cursor.line, ch: 0 }, { line: cursor.line, ch: line.length });
          editor.setCursor({ line: cursor.line, ch: prefix.length });
          return;
        }
        const commands = (this.plugin.app as unknown as {
          commands: { executeCommandById(id: string): boolean };
        }).commands;
        commands.executeCommandById('editor:toggle-checklist-status');
      },
    });
    this.plugin.addCommand({
      id: 'insert-current-datetime',
      name: '插入当前日期时间',
      hotkeys: [{ modifiers: ['Alt', 'Shift'], key: 'c' }],
      editorCallback: (editor) => {
        editor.replaceSelection(formatLocalDateTime(new Date()));
      },
    });
  }
}
