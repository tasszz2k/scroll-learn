import { describe, expect, it } from 'vitest';
import {
  SAMPLE_NOTEBOOKS,
  instantiateSample,
  restoreSampleNotebooks,
  seedSampleNotebooks,
  type SampleSeedDeps,
} from '../src/common/notebookSamples';
import type { Notebook } from '../src/common/types';

// ---------------- registry shape ----------------

describe('SAMPLE_NOTEBOOKS registry', () => {
  it('ships exactly 5 sample notebooks', () => {
    expect(SAMPLE_NOTEBOOKS).toHaveLength(5);
  });

  it('every sample has a stable id, title, body, and a properties map', () => {
    for (const s of SAMPLE_NOTEBOOKS) {
      expect(s.id).toBeTruthy();
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(50);
      expect(typeof s.properties).toBe('object');
      expect(Array.isArray(s.tags)).toBe(true);
    }
  });

  it('sample ids are unique', () => {
    const ids = SAMPLE_NOTEBOOKS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sample titles are unique (so the FolderTree never shows duplicates)', () => {
    const titles = SAMPLE_NOTEBOOKS.map(s => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('exposes the canonical English-learning sample mix', () => {
    const ids = SAMPLE_NOTEBOOKS.map(s => s.id).sort();
    expect(ids).toEqual([
      'daily-log',
      'learning-plan',
      'phrasal-verbs',
      'present-perfect',
      'welcome',
    ]);
  });

  it('the welcome sample lives at the root and the rest live under /English Learning', () => {
    const welcome = SAMPLE_NOTEBOOKS.find(s => s.id === 'welcome')!;
    expect(welcome.folderPath).toBe('');
    for (const s of SAMPLE_NOTEBOOKS.filter(s => s.id !== 'welcome')) {
      expect(s.folderPath.startsWith('/English Learning')).toBe(true);
    }
  });

  it('welcome body showcases tables, code blocks, checklists, and quotes', () => {
    const welcome = SAMPLE_NOTEBOOKS.find(s => s.id === 'welcome')!;
    expect(welcome.body).toContain('|'); // table pipes
    expect(welcome.body).toContain('```bash'); // fenced code
    expect(welcome.body).toContain('- [ ]'); // checklist
    expect(welcome.body).toContain('> '); // blockquote
  });
});

// ---------------- interpolation ----------------

describe('instantiateSample', () => {
  it('expands {{date}} in the daily-log title and properties', () => {
    const sample = SAMPLE_NOTEBOOKS.find(s => s.id === 'daily-log')!;
    const inst = instantiateSample(sample, new Date(2026, 3, 29, 22, 0)); // Apr 29 2026
    expect(inst.metadata.title).toBe('Learning - 2026-04-29');
    expect(inst.metadata.properties.date).toBe('2026-04-29');
    expect(inst.body).toContain('# Learning - 2026-04-29');
  });

  it('mints a fresh id and createdAt/updatedAt for the metadata', () => {
    const sample = SAMPLE_NOTEBOOKS.find(s => s.id === 'welcome')!;
    const a = instantiateSample(sample);
    const b = instantiateSample(sample);
    expect(a.metadata.id).toBeTruthy();
    expect(b.metadata.id).toBeTruthy();
    expect(a.metadata.id).not.toBe(b.metadata.id);
    expect(a.metadata.createdAt).toBeGreaterThan(0);
    expect(a.metadata.updatedAt).toBeGreaterThan(0);
  });

  it('does not mutate the source sample tags array', () => {
    const sample = SAMPLE_NOTEBOOKS.find(s => s.id === 'phrasal-verbs')!;
    const before = [...sample.tags];
    const inst = instantiateSample(sample);
    inst.metadata.tags.push('mutated');
    expect(sample.tags).toEqual(before);
  });
});

// ---------------- seeding ----------------

interface FakeStore {
  seeded: boolean;
  notebooks: Notebook[];
  bodies: Map<string, string>;
}

function makeDeps(initial: Partial<FakeStore> = {}): { deps: SampleSeedDeps; store: FakeStore } {
  const store: FakeStore = {
    seeded: initial.seeded ?? false,
    notebooks: initial.notebooks ?? [],
    bodies: initial.bodies ?? new Map(),
  };
  const deps: SampleSeedDeps = {
    isSeeded: async () => store.seeded,
    markSeeded: async () => {
      store.seeded = true;
    },
    listNotebooks: async () => [...store.notebooks],
    saveNotebook: async (nb) => {
      const idx = store.notebooks.findIndex(n => n.id === nb.id);
      if (idx >= 0) store.notebooks[idx] = nb;
      else store.notebooks.push(nb);
      return nb;
    },
    saveBody: async (id, md) => {
      store.bodies.set(id, md);
    },
  };
  return { deps, store };
}

describe('seedSampleNotebooks', () => {
  it('seeds every sample on a fresh install', async () => {
    const { deps, store } = makeDeps();
    const result = await seedSampleNotebooks(deps);
    expect(result).toEqual({ seeded: SAMPLE_NOTEBOOKS.length, reason: 'fresh-install' });
    expect(store.seeded).toBe(true);
    expect(store.notebooks).toHaveLength(SAMPLE_NOTEBOOKS.length);
    // Every metadata entry must have a body persisted alongside it.
    for (const nb of store.notebooks) {
      expect(store.bodies.get(nb.id)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('is idempotent - second call short-circuits with reason already-seeded', async () => {
    const { deps, store } = makeDeps();
    await seedSampleNotebooks(deps);
    const before = store.notebooks.length;
    const second = await seedSampleNotebooks(deps);
    expect(second).toEqual({ seeded: 0, reason: 'already-seeded' });
    expect(store.notebooks).toHaveLength(before);
  });

  it('skips the seed and marks the flag when the user already has notebooks', async () => {
    const userNotebook: Notebook = {
      id: 'user-1',
      title: 'My own note',
      folderPath: '',
      tags: [],
      properties: {},
      createdAt: 1,
      updatedAt: 1,
    };
    const { deps, store } = makeDeps({ notebooks: [userNotebook] });
    const result = await seedSampleNotebooks(deps);
    expect(result).toEqual({ seeded: 0, reason: 'has-existing-notebooks' });
    expect(store.notebooks).toHaveLength(1);
    expect(store.notebooks[0].id).toBe('user-1');
    expect(store.seeded).toBe(true);
  });

  it('writes the body to IndexedDB before the metadata so the editor never opens to an empty pane', async () => {
    // We assert ordering by recording calls in the order they happen and
    // checking saveBody for each id appeared before saveNotebook for the
    // same id.
    const events: Array<{ kind: 'body' | 'meta'; id: string }> = [];
    const store: FakeStore = { seeded: false, notebooks: [], bodies: new Map() };
    const deps: SampleSeedDeps = {
      isSeeded: async () => store.seeded,
      markSeeded: async () => { store.seeded = true; },
      listNotebooks: async () => [...store.notebooks],
      saveNotebook: async (nb) => {
        events.push({ kind: 'meta', id: nb.id });
        store.notebooks.push(nb);
        return nb;
      },
      saveBody: async (id, md) => {
        events.push({ kind: 'body', id });
        store.bodies.set(id, md);
      },
    };
    await seedSampleNotebooks(deps);
    // For every id, the body event must come before the meta event.
    const ids = new Set(events.map(e => e.id));
    for (const id of ids) {
      const bodyIdx = events.findIndex(e => e.id === id && e.kind === 'body');
      const metaIdx = events.findIndex(e => e.id === id && e.kind === 'meta');
      expect(bodyIdx).toBeGreaterThanOrEqual(0);
      expect(metaIdx).toBeGreaterThanOrEqual(0);
      expect(bodyIdx).toBeLessThan(metaIdx);
    }
  });

  it('expands {{date}} in the seeded daily-log notebook', async () => {
    const { deps, store } = makeDeps();
    await seedSampleNotebooks(deps, new Date(2026, 0, 5, 9, 4)); // Jan 5 2026
    const dailyLog = store.notebooks.find(nb => nb.title === 'Learning - 2026-01-05');
    expect(dailyLog).toBeDefined();
    expect(dailyLog!.properties.date).toBe('2026-01-05');
  });
});

// ---------------- manual restore ----------------

describe('restoreSampleNotebooks', () => {
  it('seeds every sample on an empty tree and reports added count', async () => {
    const { deps, store } = makeDeps();
    const result = await restoreSampleNotebooks(deps);
    expect(result.added).toBe(SAMPLE_NOTEBOOKS.length);
    expect(result.skippedCollisions).toBe(0);
    expect(store.notebooks).toHaveLength(SAMPLE_NOTEBOOKS.length);
    expect(store.seeded).toBe(true);
    for (const nb of store.notebooks) {
      expect(store.bodies.get(nb.id)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('runs even when the seed flag is already set (manual user gesture overrides one-shot)', async () => {
    const { deps, store } = makeDeps({ seeded: true });
    const result = await restoreSampleNotebooks(deps);
    expect(result.added).toBe(SAMPLE_NOTEBOOKS.length);
    expect(store.notebooks).toHaveLength(SAMPLE_NOTEBOOKS.length);
  });

  it('runs even when the user already has unrelated notebooks (does not pollute, does not skip)', async () => {
    const userNotebook: Notebook = {
      id: 'user-1',
      title: 'My own note',
      folderPath: '',
      tags: [],
      properties: {},
      createdAt: 1,
      updatedAt: 1,
    };
    const { deps, store } = makeDeps({ notebooks: [userNotebook] });
    const result = await restoreSampleNotebooks(deps);
    expect(result.added).toBe(SAMPLE_NOTEBOOKS.length);
    expect(result.skippedCollisions).toBe(0);
    // User's own notebook still there, plus all 5 samples.
    expect(store.notebooks).toHaveLength(SAMPLE_NOTEBOOKS.length + 1);
    expect(store.notebooks.some(nb => nb.id === 'user-1')).toBe(true);
  });

  it('skips a sample whose folder+title collides with an existing notebook (case-insensitive)', async () => {
    // Pre-seed a notebook that collides with the welcome sample by title +
    // root folder. Use a different case to confirm the comparison ignores
    // it.
    const collider: Notebook = {
      id: 'pre-existing',
      title: 'WELCOME TO NOTEBOOKS',
      folderPath: '',
      tags: ['existing'],
      properties: {},
      createdAt: 1,
      updatedAt: 1,
    };
    const { deps, store } = makeDeps({ notebooks: [collider] });
    const result = await restoreSampleNotebooks(deps);
    expect(result.added).toBe(SAMPLE_NOTEBOOKS.length - 1);
    expect(result.skippedCollisions).toBe(1);
    // The collider's id is preserved - we never overwrite user content.
    expect(store.notebooks.find(nb => nb.id === 'pre-existing')).toBeDefined();
    // No second "Welcome to Notebooks" was added at the root.
    const rootWelcomes = store.notebooks.filter(
      nb => nb.folderPath === '' && nb.title.toLowerCase() === 'welcome to notebooks',
    );
    expect(rootWelcomes).toHaveLength(1);
  });

  it('is idempotent - running twice in a row leaves the count stable', async () => {
    const { deps, store } = makeDeps();
    const first = await restoreSampleNotebooks(deps);
    expect(first.added).toBe(SAMPLE_NOTEBOOKS.length);

    const second = await restoreSampleNotebooks(deps);
    expect(second.added).toBe(0);
    expect(second.skippedCollisions).toBe(SAMPLE_NOTEBOOKS.length);
    expect(store.notebooks).toHaveLength(SAMPLE_NOTEBOOKS.length);
  });

  it('expands {{date}} for the daily-log title before checking for collisions', async () => {
    const { deps, store } = makeDeps();
    await restoreSampleNotebooks(deps, new Date(2026, 0, 5, 9, 4)); // Jan 5 2026
    expect(store.notebooks.some(nb => nb.title === 'Learning - 2026-01-05')).toBe(true);

    // Re-running on the same day should skip it as a collision.
    const second = await restoreSampleNotebooks(deps, new Date(2026, 0, 5, 12, 0));
    expect(second.added).toBe(0);
    expect(second.skippedCollisions).toBe(SAMPLE_NOTEBOOKS.length);
  });
});
