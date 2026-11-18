import { Plugin } from 'obsidian';
import { watch, type FSWatcher } from 'fs';
import { join } from 'path';
import { ZenPublishFeature } from './publish/publish-feature';
import { ZenDiaryFeature } from './diary/diary-feature';
import { ZenSingleTabFeature } from './single-tab/single-tab-feature';
import { ZenTitleBarFeature } from './title-bar/title-bar-feature';
import { ZenNoteFeature } from './note/note-feature';
import { ZenImageLightboxFeature } from './image-lightbox/image-lightbox-feature';

/**
 * Zen — 高度定制的 Obsidian 界面插件
 *
 * 功能 1：隐藏左侧 Ribbon（含顶部动作区与底部 vault/帮助/设置区）+ 状态栏
 * 功能 2：发布功能（KMS/飞书/Notion/GitHub/小红书），见 src/publish/
 * 内置热重载：deploy 覆盖 main.js 后自动重新加载插件，改动即时生效
 */
export default class ZenPlugin extends Plugin {
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private publishFeature: ZenPublishFeature | null = null;

  async onload() {
    this.applyZenStyles();
    this.setupHotReload();

    this.publishFeature = new ZenPublishFeature(this);
    await this.publishFeature.load();

    new ZenDiaryFeature(this).load();
    new ZenSingleTabFeature(this).load();
    new ZenTitleBarFeature(this).load();
    new ZenNoteFeature(this).load();
    new ZenImageLightboxFeature(this).load();
  }

  private applyZenStyles() {
    const classes = ['zen-hide-left-ribbon', 'zen-hide-status-bar', 'zen-wide-content', 'zen-single-tab', 'zen-ink', 'zen-hide-side-headers'];
    for (const cls of classes) document.body.addClass(cls);
    this.register(() => {
      for (const cls of classes) document.body.removeClass(cls);
    });
  }

  /**
   * 监听自身 main.js 变化（deploy 脚本覆盖写入时触发），
   * 通过 disable/enable 实现自动重载，无需 Hot Reload 插件。
   */
  private setupHotReload() {
    try {
      const adapter = this.app.vault.adapter as unknown as { basePath: string };
      const mainJsPath = join(adapter.basePath, this.manifest.dir ?? '', 'main.js');
      this.watcher = watch(mainJsPath, () => this.scheduleReload());
      this.register(() => this.watcher?.close());
    } catch (e) {
      console.warn('[zen] hot reload unavailable:', e);
    }
  }

  private scheduleReload() {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(async () => {
      const id = this.manifest.id;
      const plugins = (this.app as unknown as {
        plugins: {
          disablePlugin: (id: string) => Promise<void>;
          enablePlugin: (id: string) => Promise<void>;
        };
      }).plugins;
      console.info('[zen] main.js changed, reloading…');
      await plugins.disablePlugin(id);
      await plugins.enablePlugin(id);
    }, 300);
  }
}
