import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSessionPositions, NotePositions } from '../src/note-switcher/positions';

function view(line: number, scroll: number, mode = 'source') {
  const state = { mode, source: true };
  const ephemeral = { scroll, cursor: { from: { line, ch: 3 }, to: { line: line + 1, ch: 5 } } };
  return { state, ephemeral, getState: () => state, getEphemeralState: () => ephemeral };
}

test('round-trip restores independent native scroll, selection and mode for each note', () => {
  const positions = new NotePositions();
  const a = {}, b = {};
  positions.remember(a, view(40, 38.5));
  positions.remember(b, view(8, 80.25, 'preview'));
  assert.deepEqual(positions.recall(a), { state: view(40, 38.5).state, eState: view(40, 38.5).ephemeral });
  assert.deepEqual(positions.recall(b), { state: view(8, 80.25, 'preview').state, eState: view(8, 80.25).ephemeral });
  assert.equal(positions.recall({}), undefined);
});

test('latest reading position wins even when cursor has not moved', () => {
  const positions = new NotePositions(), file = {};
  positions.remember(file, view(40, 38));
  positions.remember(file, view(40, 120));
  assert.equal(positions.recall(file)?.eState?.scroll, 120);
});

test('live editor changes and restoration cannot mutate the saved position', () => {
  const positions = new NotePositions(), file = {}, original = view(20, 18);
  positions.remember(file, original);
  original.ephemeral.cursor.from.line = 0;
  const restored = positions.recall(file)!;
  (restored.eState!.cursor as typeof original.ephemeral.cursor).from.line = 1;
  assert.equal((positions.recall(file)!.eState!.cursor as typeof original.ephemeral.cursor).from.line, 20);
});

test('file identity retains position through rename but not delete/recreate', () => {
  const positions = new NotePositions(), file = { path: 'old.md' };
  positions.remember(file, view(6, 5));
  file.path = 'folder/new.md';
  assert.equal(positions.recall(file)?.eState?.scroll, 5);
  assert.equal(positions.recall({ path: file.path }), undefined);
});

test('positions survive plugin reload in the same app but never cross vaults', () => {
  const app = {}, file = {};
  getSessionPositions(app).remember(file, view(10, 9));
  assert.equal(getSessionPositions(app).recall(file)?.eState?.scroll, 9);
  assert.equal(getSessionPositions({}).recall(file), undefined);
});
