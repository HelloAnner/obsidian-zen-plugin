import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';

/**
 * Zen 标题栏
 * 在原 tab 区域位置渲染独立的居中标题栏（滚动容器之外，不随正文滚动），
 * 替代 inline title，随文件切换/重命名自动更新。
 * 双击标题栏进入行内改名（Enter/失焦提交，Esc 取消）。
 */
export class ZenTitleBarFeature {
  private static BAR_CLASS = 'zen-title-bar';

  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    const refresh = () => this.refreshAll();
    this.plugin.registerEvent(this.app.workspace.on('file-open', refresh));
    this.plugin.registerEvent(this.app.workspace.on('active-leaf-change', refresh));
    this.plugin.registerEvent(this.app.vault.on('rename', refresh));
    this.app.workspace.onLayoutReady(refresh);
    this.plugin.register(() => this.removeAll());
  }

  private refreshAll(): void {
    this.app.workspace.iterateRootLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file) {
        this.ensureBar(view, view.file.basename);
      } else {
        this.removeBar(view.containerEl);
      }
    });
  }

  private ensureBar(view: MarkdownView, title: string): void {
    const container = view.containerEl;
    let bar = container.querySelector<HTMLElement>(`:scope > .${ZenTitleBarFeature.BAR_CLASS}`);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = ZenTitleBarFeature.BAR_CLASS;
      bar.addEventListener('dblclick', () => this.beginRename(view, bar));
      container.prepend(bar);
    }
    if (!bar.classList.contains('is-editing') && bar.textContent !== title) {
      bar.textContent = title;
    }
  }

  /** 双击行内改名 */
  private beginRename(view: MarkdownView, bar: HTMLElement): void {
    const file = view.file;
    if (!file || bar.classList.contains('is-editing')) return;

    bar.classList.add('is-editing');
    bar.textContent = '';
    const input = document.createElement('input');
    input.className = 'zen-title-rename-input';
    input.value = file.basename;
    bar.appendChild(input);
    input.focus();
    input.select();

    let settled = false;
    const settle = (commit: boolean) => {
      if (settled) return;
      settled = true;
      const newName = input.value.trim();
      input.remove();
      bar.classList.remove('is-editing');
      bar.textContent = file.basename;

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

  private removeBar(container: Element): void {
    container.querySelectorAll(`:scope > .${ZenTitleBarFeature.BAR_CLASS}`).forEach((el) => el.remove());
  }

  private removeAll(): void {
    document.querySelectorAll(`.${ZenTitleBarFeature.BAR_CLASS}`).forEach((el) => el.remove());
  }
}

