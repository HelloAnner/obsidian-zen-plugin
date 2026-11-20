import { Notice, Plugin } from 'obsidian';

/** Restore the outline after an app upgrade or a missing/collapsed saved layout. */
export class ZenOutlineFeature {
  constructor(private plugin: Plugin) {}

  load(): void {
    this.plugin.addCommand({
      id: 'restore-right-outline',
      name: '恢复右侧大纲',
      callback: () => { void this.restore(); },
    });
    this.plugin.app.workspace.onLayoutReady(() => { void this.restore(); });
  }

  private async restore(): Promise<void> {
    const { workspace } = this.plugin.app;
    try {
      // Only reuse an outline in the right sidebar; leave other panes alone.
      let leaf = workspace.getLeavesOfType('outline')
        .find((candidate) => candidate.getRoot() === workspace.rightSplit);
      if (!leaf) {
        const rightLeaf = workspace.getRightLeaf(false);
        if (!rightLeaf) return;
        await rightLeaf.setViewState({ type: 'outline', active: true });
        leaf = rightLeaf;
      }
      await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error('[zen] unable to restore right outline', error);
      new Notice('无法恢复右侧大纲，请确认已在核心插件中启用“大纲”。');
    }
  }
}
