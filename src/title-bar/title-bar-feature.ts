import { MarkdownView, Plugin } from 'obsidian';

/**
 * Zen 标题栏
 * 在原 tab 区域位置渲染独立的居中标题栏（滚动容器之外，不随正文滚动），
 * 替代 inline title，随文件切换/重命名自动更新。
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
      container.prepend(bar);
    }
    if (bar.textContent !== title) {
      bar.textContent = title;
    }
  }

  private removeBar(container: Element): void {
    container.querySelectorAll(`:scope > .${ZenTitleBarFeature.BAR_CLASS}`).forEach((el) => el.remove());
  }

  private removeAll(): void {
    document.querySelectorAll(`.${ZenTitleBarFeature.BAR_CLASS}`).forEach((el) => el.remove());
  }
}
