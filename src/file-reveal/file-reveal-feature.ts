import { MarkdownView, Plugin, TFile, type View } from 'obsidian';

/** Adapter for Obsidian's built-in (virtualized) file explorer. */
interface ExplorerView extends View {
  fileItems?: Record<string, { selfEl: HTMLElement; parent?: ExplorerItem }>;
  revealActiveFile?: () => void;
}
interface ExplorerItem {
  parent?: ExplorerItem;
  setCollapsed?: (collapsed: boolean, animate: boolean) => void;
}

/** Reveal the active note without activating the explorer or moving editor focus. */
export class ZenFileRevealFeature {
  private frame = 0;
  private disposed = false;

  constructor(private plugin: Plugin) {}

  load(): void {
    const { workspace } = this.plugin.app;
    const schedule = () => this.schedule();
    this.plugin.registerEvent(workspace.on('file-open', schedule));
    this.plugin.registerEvent(workspace.on('active-leaf-change', (leaf) => {
      if (leaf?.view instanceof MarkdownView) schedule();
    }));
    // Also reveal once a previously hidden sidebar becomes visible.
    this.plugin.registerEvent(workspace.on('layout-change', schedule));
    workspace.onLayoutReady(schedule);
    this.plugin.register(() => {
      this.disposed = true;
      cancelAnimationFrame(this.frame);
    });
  }

  private schedule(): void {
    if (this.disposed) return;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.reveal());
  }

  private reveal(): void {
    if (this.disposed) return;
    const { workspace } = this.plugin.app;
    const file = workspace.getActiveFile();
    if (!(file instanceof TFile)) return;
    for (const leaf of workspace.getLeavesOfType('file-explorer')) {
      const view = leaf.view as ExplorerView;
      if (!view.containerEl.isShown()) continue;
      const item = view.fileItems?.[file.path];
      if (!item || !view.revealActiveFile) continue;
      // The native implementation expands ancestors and materializes the virtual
      // row. Unlike revealInFolder, it does not activate the sidebar leaf.
      let parent = item.parent;
      while (parent) {
        parent.setCollapsed?.(false, false);
        parent = parent.parent;
      }
      view.revealActiveFile();
      this.frame = requestAnimationFrame(() => {
        if (this.disposed || workspace.getActiveFile()?.path !== file.path) return;
        const row = view.fileItems?.[file.path]?.selfEl;
        const scroller = view.containerEl.querySelector<HTMLElement>('.nav-files-container');
        if (!row?.isConnected || !scroller?.clientHeight || !view.containerEl.isShown()) return;
        const rowRect = row.getBoundingClientRect();
        const scrollRect = scroller.getBoundingClientRect();
        const delta = rowRect.top + rowRect.height / 2 - scrollRect.top - scroller.clientHeight / 2;
        if (Math.abs(delta) > 1) scroller.scrollTop += delta;
      });
    }
  }
}
