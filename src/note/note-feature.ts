import { normalizePath, Notice, Plugin, TAbstractFile } from 'obsidian';
import { join } from 'path';

/**
 * Zen 笔记创建与重命名体验
 *  - 屏蔽 Obsidian 的「重命名」弹窗（promptForFileRename）：新建笔记直接叫「未命名」，不再弹窗
 *    （改名入口改为标题栏双击，见 title-bar-feature）
 *  - 提供命令「新建未命名笔记」，遵循 Obsidian 的新建文件位置设置
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
  }

  /** Ctrl+Shift+C：复制当前笔记的系统绝对路径 */
  private registerCopyPathCommand(): void {
    this.plugin.addCommand({
      id: 'copy-note-absolute-path',
      name: '复制当前笔记绝对路径',
      hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'c' }],
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

  /** 新建后/右键重命名时不再弹窗；卸载插件时恢复 */
  private suppressRenamePrompt(): void {
    const fm = this.app.fileManager as unknown as {
      promptForFileRename?: (file: TAbstractFile) => Promise<void>;
    };
    if (typeof fm.promptForFileRename !== 'function') return;
    const original = fm.promptForFileRename.bind(this.app.fileManager);
    fm.promptForFileRename = async () => Promise.resolve();
    this.plugin.register(() => {
      fm.promptForFileRename = original;
    });
  }

  private registerCreateCommand(): void {
    this.plugin.addCommand({
      id: 'create-untitled-note',
      name: '新建未命名笔记（无重命名弹窗）',
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
      },
    });
  }
}
