import { Plugin } from 'obsidian';

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
    // 显示文件标题（幂等，写入 vault 配置；setConfig 是内部 API，公开类型未声明）
    (this.app.vault as unknown as { setConfig: (key: string, value: unknown) => void })
      .setConfig('showInlineTitle', true);

    this.plugin.registerEvent(
      this.app.workspace.on('file-open', () => this.closeOtherRootLeaves())
    );
  }

  private closeOtherRootLeaves(): void {
    if (this.closing) return;
    this.closing = true;
    try {
      const activeLeaf = this.app.workspace.activeLeaf;
      this.app.workspace.iterateRootLeaves((leaf) => {
        if (leaf !== activeLeaf) {
          leaf.detach();
        }
      });
    } finally {
      this.closing = false;
    }
  }
}
