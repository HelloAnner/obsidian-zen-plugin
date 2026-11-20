import { MarkdownView, Plugin, type WorkspaceLeaf } from 'obsidian';

interface NotePosition {
  state: Record<string, unknown>;
  ephemeral: Record<string, unknown>;
}
const key = Symbol.for('zen.note-positions');

/** Native view/ephemeral states preserve mode, selection and logical scroll. */
export class NotePositions {
  private positions: Map<string, NotePosition>;

  constructor(private plugin: Plugin) {
    const globals = globalThis as typeof globalThis & { [key]?: WeakMap<object, Map<string, NotePosition>> };
    const sessions = globals[key] ??= new WeakMap();
    this.positions = sessions.get(plugin.app) ?? new Map();
    sessions.set(plugin.app, this.positions);
  }

  load(): void {
    const capture = () => this.capture();
    this.plugin.registerDomEvent(document, 'scroll', capture, true);
    this.plugin.registerDomEvent(document, 'keyup', capture, true);
    this.plugin.registerDomEvent(document, 'mouseup', capture, true);
    this.plugin.registerEvent(this.plugin.app.workspace.on('editor-change', capture));
    this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
      for (const [path, value] of [...this.positions]) {
        if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
        this.positions.delete(path);
        this.positions.set(file.path + path.slice(oldPath.length), value);
      }
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => {
      for (const path of this.positions.keys()) {
        if (path === file.path || path.startsWith(`${file.path}/`)) this.positions.delete(path);
      }
    }));
    this.capture();
  }

  capture(): void {
    this.plugin.app.workspace.iterateRootLeaves((leaf) => this.save(leaf));
  }

  save(leaf: WorkspaceLeaf): void {
    if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) return;
    this.positions.set(leaf.view.file.path, {
      state: { ...leaf.getViewState().state },
      ephemeral: structuredClone(leaf.getEphemeralState()),
    });
  }

  get(path: string): NotePosition | undefined { return this.positions.get(path); }
}
