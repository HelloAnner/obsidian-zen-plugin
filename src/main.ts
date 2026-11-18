import { Plugin } from 'obsidian';
import { watch, type FSWatcher } from 'fs';
import { join } from 'path';

/**
 * Zen — 高度定制的 Obsidian 界面插件
 *
 * 功能 1：隐藏左侧 Ribbon（含顶部动作区与底部 vault/帮助/设置区）
 * 内置热重载：deploy 覆盖 main.js 后自动重新加载插件，改动即时生效
 */
export default class ZenPlugin extends Plugin {
  private watcher: FSWatcher | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  async onload() {
    this.applyZenStyles();
    this.setupHotReload();
  }

  private applyZenStyles() {
    document.body.addClass('zen-hide-left-ribbon');
    document.body.addClass('zen-hide-status-bar');
    this.register(() => {
      document.body.removeClass('zen-hide-left-ribbon');
      document.body.removeClass('zen-hide-status-bar');
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
