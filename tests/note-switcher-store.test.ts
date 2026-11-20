import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSessionStore, NoteSwitcherStore } from '../src/note-switcher/store';

function notes(...paths: string[]): NoteSwitcherStore {
  const store = new NoteSwitcherStore();
  paths.forEach((path) => store.visit(path));
  return store;
}

test('new Markdown notes append; revisits retain their original positions', () => {
  const store = notes('a.md', 'b.md', 'c.md');
  store.visit('a.md');
  store.visit('image.png');
  store.visit('canvas.canvas');
  assert.deepEqual(store.snapshot(), { paths: ['a.md', 'b.md', 'c.md'], currentPath: 'a.md' });
});

test('navigation follows fixed order and stops at either boundary', () => {
  const store = notes('a.md', 'b.md', 'c.md');
  assert.equal(store.adjacent(1), null);
  assert.equal(store.adjacent(-1), 'b.md');
  store.visit('a.md');
  assert.equal(store.adjacent(-1), null);
  assert.equal(store.adjacent(1), 'b.md');
  assert.equal(new NoteSwitcherStore().adjacent(1), null);
});

test('moving a note changes order, not the current pointer', () => {
  const store = notes('a.md', 'b.md', 'c.md');
  store.move('c.md', -1);
  assert.deepEqual(store.snapshot(), { paths: ['a.md', 'c.md', 'b.md'], currentPath: 'c.md' });
  assert.equal(store.adjacent(1), 'b.md');
  store.move('a.md', -1);
  store.move('b.md', 1);
  store.move('missing.md', 1);
  assert.deepEqual(store.snapshot().paths, ['a.md', 'c.md', 'b.md']);
});

test('dragging to an absolute index preserves current and rejects invalid targets', () => {
  const store = notes('a.md', 'b.md', 'c.md', 'd.md');
  store.moveTo('d.md', 0);
  assert.deepEqual(store.snapshot(), { paths: ['d.md', 'a.md', 'b.md', 'c.md'], currentPath: 'd.md' });
  store.moveTo('d.md', 3);
  assert.deepEqual(store.snapshot().paths, ['a.md', 'b.md', 'c.md', 'd.md']);
  store.moveTo('d.md', -1);
  store.moveTo('d.md', 4);
  assert.equal(store.snapshot().currentPath, 'd.md');
});

test('current removal selects successor, then predecessor, then null', () => {
  const store = notes('a.md', 'b.md', 'c.md');
  store.visit('b.md');
  store.remove('b.md');
  assert.equal(store.snapshot().currentPath, 'c.md');
  store.remove('c.md');
  assert.equal(store.snapshot().currentPath, 'a.md');
  store.remove('a.md');
  assert.deepEqual(store.snapshot(), { paths: [], currentPath: null });
});

test('removing another entry keeps current and reopening a removed entry appends', () => {
  const store = notes('a.md', 'b.md', 'c.md');
  store.remove('a.md');
  assert.equal(store.snapshot().currentPath, 'c.md');
  store.visit('a.md');
  assert.deepEqual(store.snapshot().paths, ['b.md', 'c.md', 'a.md']);
});

test('file and folder renames preserve order and current across exact prefixes', () => {
  const store = notes('folder/a.md', 'folder/b.md', 'folder-other/c.md');
  store.visit('folder/b.md');
  store.renameTree('folder', 'renamed');
  store.renameTree('renamed/b.md', 'renamed/new.md');
  assert.deepEqual(store.snapshot(), {
    paths: ['renamed/a.md', 'renamed/new.md', 'folder-other/c.md'], currentPath: 'renamed/new.md',
  });
});

test('renaming away from Markdown removes that entry', () => {
  const store = notes('a.md', 'b.md');
  store.renameTree('b.md', 'b.txt');
  assert.deepEqual(store.snapshot(), { paths: ['a.md'], currentPath: 'a.md' });
});

test('folder deletion removes descendants, not similarly named folders', () => {
  const store = notes('before.md', 'folder/a.md', 'folder/b.md', 'folder-other/c.md', 'after.md');
  store.visit('folder/a.md');
  store.removeTree('folder');
  assert.deepEqual(store.snapshot(), {
    paths: ['before.md', 'folder-other/c.md', 'after.md'], currentPath: 'folder-other/c.md',
  });
});

test('retained sessions prune files removed while the plugin was unloaded', () => {
  const store = notes('a.md', 'b.md', 'c.md');
  store.retain((path) => path !== 'c.md');
  assert.deepEqual(store.snapshot(), { paths: ['a.md', 'b.md'], currentPath: 'b.md' });
});

test('snapshots cannot mutate the store and unsubscribe detaches listeners', () => {
  const store = new NoteSwitcherStore();
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  store.visit('a.md');
  store.visit('a.md');
  (store.snapshot().paths as string[]).push('injected.md');
  assert.deepEqual(store.snapshot().paths, ['a.md']);
  assert.equal(changes, 1);
  unsubscribe();
  store.visit('b.md');
  assert.equal(changes, 1);
});

test('session store is shared for an app, isolated between apps, never capped', () => {
  const app = {};
  const store = getSessionStore(app);
  assert.equal(getSessionStore(app), store);
  assert.notEqual(getSessionStore({}), store);
  for (let i = 0; i < 250; i++) store.visit(`${i}.md`);
  assert.equal(store.snapshot().paths.length, 250);
});
