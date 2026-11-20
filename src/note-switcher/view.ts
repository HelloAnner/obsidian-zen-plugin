import Sortable from 'sortablejs';
import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import type { NoteSwitcherStore } from './store';

export const NOTE_SWITCHER_VIEW = 'zen-note-switcher';
export interface NoteSwitcherActions {
  open(path: string): void;
  remove(path: string): void;
}

/** Native workspace docking, with Sortable owning only row reordering. */
export class NoteSwitcherView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private sortable: Sortable | null = null;
  private suppressClickUntil = 0;

  constructor(leaf: WorkspaceLeaf, private store: NoteSwitcherStore, private actions: NoteSwitcherActions) {
    super(leaf);
    this.registerDomEvent(this.contentEl, 'click', (event) => {
      if (Date.now() < this.suppressClickUntil) return;
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      const path = button?.closest<HTMLElement>('[data-note-path]')?.dataset.notePath;
      if (!path) return;
      if (button.dataset.action === 'remove') this.actions.remove(path);
      else this.actions.open(path);
    });
  }

  getViewType(): string { return NOTE_SWITCHER_VIEW; }
  getDisplayText(): string { return '笔记切换'; }
  getIcon(): string { return 'list-ordered'; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('zen-note-switcher');
    this.unsubscribe = this.store.subscribe(() => this.render());
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.sortable?.destroy();
    this.sortable = null;
    this.contentEl.empty();
  }

  private render(): void {
    const { paths, currentPath } = this.store.snapshot();
    this.sortable?.destroy();
    this.sortable = null;
    this.contentEl.empty();
    const list = this.contentEl.createEl('ol', { cls: 'zen-note-switcher-list' });
    for (const path of paths) {
      const row = list.createEl('li', { cls: 'zen-note-switcher-row' });
      row.dataset.notePath = path;
      if (path === currentPath) row.addClass('is-active');
      const open = row.createEl('button', {
        cls: 'zen-note-switcher-open', attr: { 'data-action': 'open', title: path },
      });
      if (path === currentPath) open.setAttribute('aria-current', 'page');
      open.createSpan({ cls: 'zen-note-switcher-name', text: path.split('/').pop()!.replace(/\.md$/i, '') });
      const remove = row.createEl('button', {
        cls: 'clickable-icon zen-note-switcher-remove',
        attr: { 'data-action': 'remove', 'aria-label': '从列表移除（不删除文件）' },
      });
      setIcon(remove, 'x');
    }
    this.sortable = Sortable.create(list, {
      animation: 120,
      delay: 180,
      delayOnTouchOnly: false,
      forceFallback: true,
      fallbackTolerance: 4,
      filter: '[data-action="remove"]',
      preventOnFilter: false,
      ghostClass: 'zen-note-switcher-ghost',
      onStart: () => { this.suppressClickUntil = Number.POSITIVE_INFINITY; },
      onEnd: (event) => {
        this.suppressClickUntil = Date.now() + 250;
        if (event.oldIndex != null && event.newIndex != null) {
          this.store.moveTo(event.item.dataset.notePath!, event.newIndex);
        }
      },
    });
  }
}
