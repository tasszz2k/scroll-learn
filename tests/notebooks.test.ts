import { describe, it, expect, beforeEach } from 'vitest';
import {
  getNotebooks,
  getNotebook,
  saveNotebook,
  deleteNotebook,
  moveNotebookFolder,
} from '../src/common/storage';
import { createNotebook, STORAGE_KEYS } from '../src/common/types';

function installChromeMock() {
  const store: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          const out: Record<string, unknown> = {};
          for (const k of keys) {
            if (k in store) out[k] = store[k];
          }
          return out;
        },
        set: async (entries: Record<string, unknown>) => {
          Object.assign(store, entries);
        },
        remove: async (key: string | string[]) => {
          const keys = Array.isArray(key) ? key : [key];
          for (const k of keys) delete store[k];
        },
        clear: async () => {
          for (const k of Object.keys(store)) delete store[k];
        },
      },
    },
  };
  return store;
}

describe('notebook metadata storage', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('uses the canonical storage key', () => {
    expect(STORAGE_KEYS.NOTEBOOKS).toBe('scrolllearn_notebooks');
  });

  it('persists, looks up, and lists notebooks', async () => {
    const a = createNotebook({
      title: 'Hello',
      folderPath: '',
      tags: ['demo'],
      properties: { type: 'concept' },
    });
    await saveNotebook(a);

    const b = createNotebook({
      title: 'World',
      folderPath: '/Demo',
      tags: [],
      properties: {},
    });
    await saveNotebook(b);

    const all = await getNotebooks();
    expect(all).toHaveLength(2);
    expect(all.map(n => n.title).sort()).toEqual(['Hello', 'World']);

    const fetched = await getNotebook(a.id);
    expect(fetched?.title).toBe('Hello');
    expect(fetched?.tags).toEqual(['demo']);
  });

  it('updates updatedAt on save and replaces the existing record', async () => {
    const original = createNotebook({
      title: 'Draft',
      folderPath: '',
      tags: [],
      properties: {},
    });
    await saveNotebook(original);

    // Synthesize a slightly later save and assert the metadata is replaced.
    const next = { ...original, title: 'Final' };
    const saved = await saveNotebook(next);

    expect(saved.title).toBe('Final');
    expect(saved.updatedAt).toBeGreaterThanOrEqual(original.updatedAt);

    const all = await getNotebooks();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe('Final');
  });

  it('deletes a single notebook by id', async () => {
    const a = createNotebook({ title: 'A', folderPath: '', tags: [], properties: {} });
    const b = createNotebook({ title: 'B', folderPath: '', tags: [], properties: {} });
    await saveNotebook(a);
    await saveNotebook(b);

    await deleteNotebook(a.id);

    const all = await getNotebooks();
    expect(all.map(n => n.title)).toEqual(['B']);
  });
});

describe('moveNotebookFolder', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('rewrites exact-match folderPath and nested paths under it', async () => {
    const root = createNotebook({ title: 'Root', folderPath: '', tags: [], properties: {} });
    const inOld = createNotebook({ title: 'Inside', folderPath: '/Old', tags: [], properties: {} });
    const inOldChild = createNotebook({
      title: 'Deep',
      folderPath: '/Old/Sub',
      tags: [],
      properties: {},
    });
    const otherFolder = createNotebook({
      title: 'Other',
      folderPath: '/Other',
      tags: [],
      properties: {},
    });

    await saveNotebook(root);
    await saveNotebook(inOld);
    await saveNotebook(inOldChild);
    await saveNotebook(otherFolder);

    const moved = await moveNotebookFolder('/Old', '/Renamed');
    expect(moved).toBe(2);

    const all = await getNotebooks();
    const byTitle = Object.fromEntries(all.map(n => [n.title, n.folderPath]));
    expect(byTitle.Inside).toBe('/Renamed');
    expect(byTitle.Deep).toBe('/Renamed/Sub');
    expect(byTitle.Root).toBe('');
    expect(byTitle.Other).toBe('/Other');
  });

  it('does not match a folderPath that only shares a prefix string', async () => {
    const a = createNotebook({ title: 'A', folderPath: '/OldStuff', tags: [], properties: {} });
    const b = createNotebook({ title: 'B', folderPath: '/Old', tags: [], properties: {} });
    await saveNotebook(a);
    await saveNotebook(b);

    const moved = await moveNotebookFolder('/Old', '/Renamed');
    expect(moved).toBe(1);

    const all = await getNotebooks();
    const byTitle = Object.fromEntries(all.map(n => [n.title, n.folderPath]));
    expect(byTitle.A).toBe('/OldStuff');
    expect(byTitle.B).toBe('/Renamed');
  });

  it('is a no-op when fromPath === toPath', async () => {
    const a = createNotebook({ title: 'A', folderPath: '/Old', tags: [], properties: {} });
    await saveNotebook(a);

    const moved = await moveNotebookFolder('/Old', '/Old');
    expect(moved).toBe(0);
  });
});
