import { MarkdownView, Plugin } from 'obsidian';

/**
 * Zen 单文档模式
 *  - CSS 隐藏主编辑区顶部 tab 栏（zen-single-tab）
 *  - 打开新文章时自动关闭主区域其他标签页：一次只开一篇
 *  - 开启 inline title，文章标题直接显示在正文顶部
 */
export class ZenSingleTabFeature {
  private closing = false;

  constructor(private plugin: Plugin) {}

  private get app() {
    return this.plugin.app;
  }

  load(): void {
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', () => this.closeOtherRootLeaves())
    );
  }

  private closeOtherRootLeaves(): void {
    if (this.closing) return;
    const activeLeaf = this.app.workspace.activeLeaf;
    // Focusing a sidebar (or opening a non-Markdown/custom view) must never
    // close documents. Native ItemViews can also be docked in the root split.
    if (!activeLeaf || !(activeLeaf.view instanceof MarkdownView)
      || activeLeaf.getRoot() !== this.app.workspace.rootSplit) return;
    this.closing = true;
    try {
      this.app.workspace.iterateRootLeaves((leaf) => {
        if (leaf !== activeLeaf && leaf.view instanceof MarkdownView) {
          leaf.detach();
        }
      });
    } finally {
      this.closing = false;
    }
  }
}
