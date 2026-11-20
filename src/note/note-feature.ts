import { normalizePath, Notice, Plugin, TAbstractFile, TFile } from 'obsidian';
import { join } from 'path';

/**
 * Zen 笔记创建与重命名体验
 *  - 屏蔽 Obsidian 的「重命名」弹窗（promptForFileRename）
 *  - 新建笔记直接叫「未命名」，并自动在左侧文件树进入行内改名（焦点在文件名上）
 *  - 右键重命名也改为文件树行内改名（由 promptForFileRename 转发）
 *  - Cmd+Shift+C：复制当前笔记的系统绝对路径
 *  - 标题栏双击改名仍然可用（见 title-bar-feature）
 */
export class ZenNoteFeature {
  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    this.suppressRenamePrompt();
    this.registerCreateCommand();
    this.registerCopyPathCommand();

    // 其他入口（文件树「新建笔记」按钮/Cmd+N 等）创建的未命名笔记，同样进入行内改名
    this.plugin.registerEvent(
      this.app.vault.on('create', (file) => {
        if (!(file instanceof TFile)) return;
        if (!/^(未命名|Untitled)( \d+)?\.md$/.test(file.name)) return;
        this.startTreeInlineRename(file);
      })
    );
  }

  /** Cmd+Shift+C：复制当前笔记的系统绝对路径 */
  private registerCopyPathCommand(): void {
    this.plugin.addCommand({
      id: 'copy-note-absolute-path',
      name: '复制当前笔记绝对路径',
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'c' }],
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
          new Notice('❌ 没有打开的笔记');
          return;
        }
        const basePath = (this.app.vault.adapter as unknown as { basePath: string }).basePath;
        const absolutePath = join(basePath, file.path);
        await navigator.clipboard.writeText(absolutePath);
        new Notice(`📋 已复制：${absolutePath}`);
      },
    });
  }

  /** 屏蔽重命名弹窗，改为文件树行内改名；卸载插件时恢复 */
  private suppressRenamePrompt(): void {
    const fm = this.app.fileManager as unknown as {
      promptForFileRename?: (file: TAbstractFile) => Promise<void>;
    };
    if (typeof fm.promptForFileRename !== 'function') return;
    const original = fm.promptForFileRename.bind(this.app.fileManager);
    fm.promptForFileRename = async (file: TAbstractFile) => {
      if (file instanceof TFile) this.startTreeInlineRename(file);
    };
    this.plugin.register(() => {
      fm.promptForFileRename = original;
    });
  }

  private registerCreateCommand(): void {
    this.plugin.addCommand({
      id: 'create-untitled-note',
      name: '新建未命名笔记（文件树行内改名）',
      callback: async () => {
        const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
        const parent = this.app.fileManager.getNewFileParent(sourcePath);
        const dir = parent.isRoot() ? '' : parent.path;

        let path = '';
        for (let i = 0; ; i++) {
          const name = i === 0 ? '未命名' : `未命名 ${i}`;
          path = normalizePath(dir ? `${dir}/${name}.md` : `${name}.md`);
          if (!this.app.vault.getAbstractFileByPath(path)) break;
        }

        const file = await this.app.vault.create(path, '');
        await this.app.workspace.getLeaf(false).openFile(file);
        // vault create 事件里已挂钩行内改名，这里无需重复
      },
    });
  }

  /** 在左侧文件树中对指定文件进入行内改名（等待树渲染出该条目） */
  private startTreeInlineRename(file: TFile, attempt = 0): void {
    const el = document.querySelector<HTMLElement>(`.nav-file-title[data-path="${CSS.escape(file.path)}"]`);
    if (!el) {
      if (attempt < 20) {
        setTimeout(() => this.startTreeInlineRename(file, attempt + 1), 100);
      }
      return;
    }
    if (el.querySelector('.zen-tree-rename-input')) return;

    const contentEl = el.querySelector<HTMLElement>('.nav-file-title-content');
    if (contentEl) contentEl.style.display = 'none';
    el.classList.add('zen-renaming');

    const input = document.createElement('input');
    input.className = 'zen-tree-rename-input';
    input.value = file.basename;
    el.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const settle = (commit: boolean) => {
      if (settled) return;
      settled = true;
      const newName = input.value.trim();
      input.remove();
      el.classList.remove('zen-renaming');
      if (contentEl) contentEl.style.display = '';

      if (!commit || !newName || newName === file.basename) return;
      if (/[/\\:*?"<>|]/.test(newName)) {
        new Notice('❌ 文件名不能包含 / \\ : * ? " < > |');
        return;
      }
      void this.renameFile(file, newName);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') settle(true);
      else if (e.key === 'Escape') settle(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => settle(true));
  }

  private async renameFile(file: TFile, newName: string): Promise<void> {
    const dir = file.parent && !file.parent.isRoot() ? file.parent.path : '';
    const newPath = dir ? `${dir}/${newName}.md` : `${newName}.md`;
    if (this.app.vault.getAbstractFileByPath(newPath)) {
      new Notice(`❌ 已存在同名笔记：${newName}`);
      return;
    }
    try {
      await this.app.fileManager.renameFile(file, newPath);
    } catch (e) {
      new Notice(`❌ 重命名失败：${(e as Error).message}`);
    }
  }
}
