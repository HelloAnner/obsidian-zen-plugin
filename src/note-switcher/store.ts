export type NoteDirection = -1 | 1;
export interface NoteSwitcherSnapshot {
  readonly paths: readonly string[];
  readonly currentPath: string | null;
}

/** Ordered session list, independent of the vault, workspace and UI. */
export class NoteSwitcherStore {
  private paths: string[] = [];
  private currentPath: string | null = null;
  private listeners = new Set<() => void>();

  snapshot(): NoteSwitcherSnapshot {
    return { paths: [...this.paths], currentPath: this.currentPath };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  visit(path: string): void {
    if (!/\.md$/i.test(path)) return;
    if (!this.paths.includes(path)) this.paths.push(path);
    if (this.currentPath === path) return;
    this.currentPath = path;
    this.emit();
  }

  adjacent(direction: NoteDirection): string | null {
    const index = this.paths.indexOf(this.currentPath ?? '');
    if (index < 0) return null;
    return this.paths[index + direction] ?? null;
  }

  move(path: string, direction: NoteDirection): void {
    const index = this.paths.indexOf(path);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.paths.length) return;
    [this.paths[index], this.paths[target]] = [this.paths[target], this.paths[index]];
    this.emit();
  }

  moveTo(path: string, target: number): void {
    const index = this.paths.indexOf(path);
    if (index < 0 || !Number.isInteger(target) || target < 0 || target >= this.paths.length || target === index) return;
    this.paths.splice(index, 1);
    this.paths.splice(target, 0, path);
    this.emit();
  }

  /** Current removal selects its successor, or its predecessor at the end. */
  remove(path: string): void {
    this.removeMatching((candidate) => candidate === path);
  }

  removeTree(path: string): void {
    this.removeMatching((candidate) => candidate === path || candidate.startsWith(`${path}/`));
  }

  renameTree(oldPath: string, newPath: string): void {
    const rename = (path: string): string => path === oldPath
      ? newPath
      : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : path;
    const current = this.currentPath === null ? null : rename(this.currentPath);
    const paths = [...new Set(this.paths.map(rename).filter((path) => /\.md$/i.test(path)))];
    if (paths.every((path, index) => path === this.paths[index]) && paths.length === this.paths.length) return;
    const oldIndex = this.paths.indexOf(this.currentPath ?? '');
    this.paths = paths;
    this.currentPath = current !== null && paths.includes(current)
      ? current : paths[Math.min(oldIndex, paths.length - 1)] ?? null;
    this.emit();
  }

  /** Reconcile a retained session after the plugin was disabled. */
  retain(exists: (path: string) => boolean): void {
    this.removeMatching((path) => !exists(path));
  }

  private removeMatching(matches: (path: string) => boolean): void {
    const oldIndex = this.paths.indexOf(this.currentPath ?? '');
    const paths = this.paths.filter((path) => !matches(path));
    if (paths.length === this.paths.length) return;
    if (this.currentPath !== null && !paths.includes(this.currentPath)) {
      // Prefer the first surviving successor, then the nearest predecessor.
      this.currentPath = this.paths.slice(oldIndex + 1).find((path) => paths.includes(path))
        ?? this.paths.slice(0, oldIndex).reverse().find((path) => paths.includes(path)) ?? null;
    }
    this.paths = paths;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

// The global WeakMap survives bundle reloads, but neither writes to disk nor
// retains an App after its vault/window closes. A true app restart clears it.
const sessionKey = Symbol.for('zen.note-switcher.sessions');
export function getSessionStore(app: object): NoteSwitcherStore {
  const globals = globalThis as typeof globalThis & { [sessionKey]?: WeakMap<object, NoteSwitcherStore> };
  const sessions = globals[sessionKey] ??= new WeakMap();
  let store = sessions.get(app);
  if (!store) {
    store = new NoteSwitcherStore();
    sessions.set(app, store);
  } else {
    // Upgrade the retained object when hot reload changes store methods.
    Object.setPrototypeOf(store, NoteSwitcherStore.prototype);
  }
  return store;
}
