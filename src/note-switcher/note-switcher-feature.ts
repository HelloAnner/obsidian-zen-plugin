import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { getSessionStore, type NoteDirection, type NoteSwitcherStore } from './store';
import { NOTE_SWITCHER_VIEW, NoteSwitcherView } from './view';

export class ZenNoteSwitcherFeature {
  private store: NoteSwitcherStore;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private plugin: Plugin) {
    this.store = getSessionStore(plugin.app);
  }

  load(): void {
    const { workspace, vault } = this.plugin.app;
    this.plugin.register(() => { this.disposed = true; });
    this.plugin.registerView(NOTE_SWITCHER_VIEW, (leaf) => new NoteSwitcherView(leaf, this.store, {
      open: (path) => this.enqueue(() => this.open(path)),
      remove: (path) => this.enqueue(() => this.remove(path)),
    }));
    this.plugin.addCommand({
      id: 'open-note-switcher', name: '打开笔记切换列表',
      callback: () => { void this.show(true); },
    });
    for (const direction of [-1, 1] as const) {
      this.plugin.addCommand({
        id: direction === -1 ? 'previous-note-in-list' : 'next-note-in-list',
        name: direction === -1 ? '按列表顺序切换到上一篇笔记' : '按列表顺序切换到下一篇笔记',
        hotkeys: [{ modifiers: ['Alt'], key: direction === -1 ? 'ArrowUp' : 'ArrowDown' }],
        callback: () => this.navigate(direction),
      });
    }
    // CodeMirror normally reserves Option+arrows for cursor movement. Consume
    // these before its default keymap; a native command that already handled an
    // event sets defaultPrevented, so the same key never navigates twice.
    this.plugin.registerEditorExtension(Prec.highest(EditorView.domEventHandlers({
      keydown: (event) => {
        if (event.isComposing || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
          || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return false;
        if (!event.defaultPrevented) this.navigate(event.key === 'ArrowUp' ? -1 : 1);
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      },
    })));
    this.plugin.registerEvent(workspace.on('file-open', (file) => {
      if (file instanceof TFile && file.extension.toLowerCase() === 'md') this.store.visit(file.path);
    }));
    this.plugin.registerEvent(workspace.on('active-leaf-change', (leaf) => {
      if (leaf?.view instanceof MarkdownView && leaf.view.file) this.store.visit(leaf.view.file.path);
    }));
    this.plugin.registerEvent(vault.on('rename', (file, oldPath) => this.store.renameTree(oldPath, file.path)));
    this.plugin.registerEvent(vault.on('delete', (file) => this.store.removeTree(file.path)));
    workspace.onLayoutReady(() => {
      if (this.disposed) return;
      this.store.retain((path) => vault.getAbstractFileByPath(path) instanceof TFile);
      const file = workspace.getActiveFile();
      if (file) this.store.visit(file.path);
      // Let Obsidian finish restoring deferred/custom leaves after registerView.
      const timer = window.setTimeout(() => { if (!this.disposed) void this.show(false); }, 500);
      this.plugin.register(() => window.clearTimeout(timer));
    });
  }

  private navigate(direction: NoteDirection): void {
    // Resolve each target after the preceding open completed. Repeated keydown
    // events advance in fixed order rather than racing on the same pointer.
    this.enqueue(async () => {
      const path = this.store.adjacent(direction);
      if (path) await this.open(path);
    });
  }

  private enqueue(action: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      if (!this.disposed) await action();
    }).catch((error) => {
      console.error('[zen] note switch failed', error);
      if (!this.disposed) new Notice('无法打开笔记，请检查文件是否仍存在。');
    });
  }

  private async remove(path: string): Promise<void> {
    // Removing affects session state only. Do not close or delete the document,
    // and do not force-open the replacement pointer (which could re-add it).
    this.store.remove(path);
  }

  private async open(path: string): Promise<void> {
    const { workspace, vault } = this.plugin.app;
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
      this.store.remove(path);
      return;
    }
    let leaf: WorkspaceLeaf | undefined;
    workspace.iterateRootLeaves((candidate) => {
      if (candidate.view instanceof MarkdownView && (!leaf || candidate === workspace.activeLeaf)) leaf = candidate;
    });
    // Never replace the sidebar/custom root view when its row has focus.
    leaf ??= workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true });
    if (!this.disposed) this.store.visit(file.path);
  }

  private async show(reveal: boolean): Promise<void> {
    const { workspace } = this.plugin.app;
    try {
      // During reload a native placeholder may hold the saved type before the
      // registered ItemView is restored. Inspect saved states, not only live views.
      const candidates: WorkspaceLeaf[] = [];
      workspace.iterateAllLeaves((candidate) => {
        if (candidate.getViewState().type === NOTE_SWITCHER_VIEW) candidates.push(candidate);
      });
      let leaf = [...candidates].reverse().find((candidate) => candidate.getRoot() === workspace.rightSplit)
        ?? candidates[0];
      for (const duplicate of candidates) if (duplicate !== leaf) duplicate.detach();
      if (leaf && !(leaf.view instanceof NoteSwitcherView)) {
        await leaf.setViewState({ type: NOTE_SWITCHER_VIEW, active: false });
      }
      if (!leaf) {
        const rightLeaf = workspace.getRightLeaf(false);
        if (!rightLeaf || this.disposed) return;
        leaf = rightLeaf;
        await leaf.setViewState({ type: NOTE_SWITCHER_VIEW, active: false });
      }
      // Existing leaves keep the user's tab group, native split and focus.
      if (reveal && !this.disposed) await workspace.revealLeaf(leaf);
    } catch (error) {
      console.error('[zen] unable to open note switcher', error);
      if (!this.disposed) new Notice('无法打开笔记切换列表。');
    }
  }
}
