import type { OpenViewState } from 'obsidian';

interface NoteView {
  getState(): Record<string, unknown>;
  getEphemeralState(): Record<string, unknown>;
}

/** Keep Obsidian's native scroll, cursor, selection and mode state per file.
 * File identities survive renames; WeakMap entries disappear with deleted files.
 * Snapshots must not alias the live editor's mutable selection objects.
 */
export class NotePositions {
  private positions = new WeakMap<object, OpenViewState>();

  remember(file: object, view: NoteView): void {
    this.positions.set(file, structuredClone({
      state: view.getState(),
      eState: view.getEphemeralState(),
    }));
  }

  recall(file: object): OpenViewState | undefined {
    const position = this.positions.get(file);
    return position ? structuredClone(position) : undefined;
  }
}

const sessionKey = Symbol.for('zen.note-switcher.positions');
export function getSessionPositions(app: object): NotePositions {
  const globals = globalThis as typeof globalThis & { [sessionKey]?: WeakMap<object, NotePositions> };
  const sessions = globals[sessionKey] ??= new WeakMap();
  let positions = sessions.get(app);
  if (!positions) {
    positions = new NotePositions();
    sessions.set(app, positions);
  } else {
    Object.setPrototypeOf(positions, NotePositions.prototype);
  }
  return positions;
}
