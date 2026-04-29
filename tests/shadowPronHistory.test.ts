import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendPronCheckRun,
  deletePronCheckHistoryFor,
  getPronCheckHistory,
} from '../src/common/shadowPronHistory';
import type { PronCheckRun } from '../src/common/types';

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

function makeRun(id: string): PronCheckRun {
  return {
    id,
    createdAt: Date.now(),
    durationSec: 12,
    report: {
      scores: { pronunciation: 80, naturalness: 75, fluency: 70 },
      summary: 'ok',
      lines: [],
    },
  };
}

describe('shadowPronHistory', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('returns [] for an unknown script id', async () => {
    const list = await getPronCheckHistory('does-not-exist');
    expect(list).toEqual([]);
  });

  it('appends runs in order, oldest-first', async () => {
    await appendPronCheckRun('s1', makeRun('a'));
    await appendPronCheckRun('s1', makeRun('b'));
    await appendPronCheckRun('s1', makeRun('c'));
    const list = await getPronCheckHistory('s1');
    expect(list.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('caps history at 50 runs and drops oldest', async () => {
    for (let i = 0; i < 55; i++) {
      await appendPronCheckRun('s1', makeRun(`r${i}`));
    }
    const list = await getPronCheckHistory('s1');
    expect(list.length).toBe(50);
    // Oldest 5 should have been dropped.
    expect(list[0].id).toBe('r5');
    expect(list[49].id).toBe('r54');
  });

  it('isolates history per script id', async () => {
    await appendPronCheckRun('s1', makeRun('a'));
    await appendPronCheckRun('s2', makeRun('b'));
    const list1 = await getPronCheckHistory('s1');
    const list2 = await getPronCheckHistory('s2');
    expect(list1.map(r => r.id)).toEqual(['a']);
    expect(list2.map(r => r.id)).toEqual(['b']);
  });

  it('deletePronCheckHistoryFor removes a script entry without touching others', async () => {
    await appendPronCheckRun('s1', makeRun('a'));
    await appendPronCheckRun('s2', makeRun('b'));
    await deletePronCheckHistoryFor('s1');
    expect(await getPronCheckHistory('s1')).toEqual([]);
    expect(await getPronCheckHistory('s2')).toHaveLength(1);
  });

  it('deletePronCheckHistoryFor on an unknown id is a no-op', async () => {
    await appendPronCheckRun('s1', makeRun('a'));
    await deletePronCheckHistoryFor('s2');
    expect(await getPronCheckHistory('s1')).toHaveLength(1);
  });
});
