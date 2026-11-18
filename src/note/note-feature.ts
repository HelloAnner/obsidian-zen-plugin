import { normalizePath, Plugin, TAbstractFile } from 'obsidian';

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
