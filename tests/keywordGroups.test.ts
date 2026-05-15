import { describe, it, expect, beforeEach } from 'vitest';
import {
  flattenEnabledKeywords,
  STORAGE_KEYS,
  type KeywordGroup,
  type Settings,
} from '../src/common/types';
import {
  getSettings,
  saveSettings,
  migrateKeywordGroups,
  newKeywordGroupId,
} from '../src/common/storage';

// Minimal in-memory chrome.storage.local mock. Mirrors the shape used by
// tests/notes.test.ts so the storage module under test sees a real-looking
// async surface.
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

describe('flattenEnabledKeywords', () => {
  it('returns [] when given no groups', () => {
    expect(flattenEnabledKeywords([])).toEqual([]);
  });

  it('returns keywords from a single enabled group in order', () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'Politics', enabled: true, keywords: ['election', 'senate'] },
    ];
    expect(flattenEnabledKeywords(groups)).toEqual(['election', 'senate']);
  });

  it('skips disabled groups entirely', () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'Politics', enabled: false, keywords: ['election'] },
      { id: 'g2', label: 'Crypto',   enabled: true,  keywords: ['bitcoin'] },
    ];
    expect(flattenEnabledKeywords(groups)).toEqual(['bitcoin']);
  });

  it('dedupes keywords case-insensitively across groups (first wins)', () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'A', enabled: true, keywords: ['Bitcoin'] },
      { id: 'g2', label: 'B', enabled: true, keywords: ['bitcoin', 'crypto'] },
    ];
    expect(flattenEnabledKeywords(groups)).toEqual(['Bitcoin', 'crypto']);
  });

  it('preserves keyword order within a group', () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'A', enabled: true, keywords: ['z', 'a', 'm'] },
    ];
    expect(flattenEnabledKeywords(groups)).toEqual(['z', 'a', 'm']);
  });
});

describe('migrateKeywordGroups', () => {
  it('returns existing groups untouched when present', () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'Politics', enabled: true, keywords: ['election'] },
    ];
    expect(migrateKeywordGroups({ keywordGroups: groups })).toBe(groups);
  });

  it('returns [] when there are no groups and no legacy keywords', () => {
    expect(migrateKeywordGroups({})).toEqual([]);
    expect(migrateKeywordGroups({ blockedKeywords: [] })).toEqual([]);
  });

  it('buckets a legacy flat list into a single Uncategorized group', () => {
    const out = migrateKeywordGroups({ blockedKeywords: ['war', 'bitcoin'] });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('uncategorized');
    expect(out[0].label).toBe('Uncategorized');
    expect(out[0].enabled).toBe(true);
    expect(out[0].keywords).toEqual(['war', 'bitcoin']);
  });

  it('does not bucket when groups already exist, even if blockedKeywords is set', () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'Crypto', enabled: true, keywords: ['bitcoin'] },
    ];
    const out = migrateKeywordGroups({ keywordGroups: groups, blockedKeywords: ['legacy'] });
    expect(out).toBe(groups);
  });
});

describe('newKeywordGroupId', () => {
  it('returns a kg-prefixed string', () => {
    const id = newKeywordGroupId();
    expect(id.startsWith('kg-')).toBe(true);
    expect(id.length).toBeGreaterThan('kg-'.length + 4);
  });

  it('returns a fresh id on each call', () => {
    expect(newKeywordGroupId()).not.toBe(newKeywordGroupId());
  });
});

describe('getSettings + saveSettings', () => {
  let store: Record<string, unknown>;
  beforeEach(() => {
    store = installChromeMock();
  });

  it('migrates a legacy flat list on first read and recomputes blockedKeywords', async () => {
    // Simulate a pre-upgrade install: only the flat field is stored.
    store[STORAGE_KEYS.SETTINGS] = { blockedKeywords: ['war', 'bitcoin'], keywordHits: { war: 3 } };

    const settings = await getSettings();
    expect(settings.keywordGroups).toHaveLength(1);
    expect(settings.keywordGroups[0].label).toBe('Uncategorized');
    expect(settings.keywordGroups[0].keywords).toEqual(['war', 'bitcoin']);
    expect(settings.blockedKeywords).toEqual(['war', 'bitcoin']);
    // Hits must be preserved across the read-side migration.
    expect(settings.keywordHits.war).toBe(3);
  });

  it('returns empty groups + empty blockedKeywords on a fresh install', async () => {
    const settings = await getSettings();
    expect(settings.keywordGroups).toEqual([]);
    expect(settings.blockedKeywords).toEqual([]);
  });

  it('recomputes blockedKeywords from enabled groups on save', async () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'Politics', enabled: true,  keywords: ['election'] },
      { id: 'g2', label: 'Crypto',   enabled: false, keywords: ['bitcoin'] },
      { id: 'g3', label: 'War',      enabled: true,  keywords: ['missile', 'war'] },
    ];
    const saved = await saveSettings({ keywordGroups: groups });
    expect(saved.blockedKeywords).toEqual(['election', 'missile', 'war']);
  });

  it('ignores caller-provided blockedKeywords -- groups always win', async () => {
    const groups: KeywordGroup[] = [
      { id: 'g1', label: 'Politics', enabled: true, keywords: ['election'] },
    ];
    const saved = await saveSettings({
      keywordGroups: groups,
      blockedKeywords: ['NOT-FROM-GROUP'] as unknown as Settings['blockedKeywords'],
    });
    expect(saved.blockedKeywords).toEqual(['election']);
  });

  it('prunes keywordHits entries that no longer match any group keyword on group save', async () => {
    // First save plants two keywords with hits.
    await saveSettings({
      keywordGroups: [
        { id: 'g1', label: 'A', enabled: true, keywords: ['election', 'bitcoin'] },
      ],
    });
    // Simulate the background incrementing hits (does NOT touch groups).
    await saveSettings({ keywordHits: { election: 5, bitcoin: 2, orphan: 99 } });
    let s = await getSettings();
    // Orphan stays because this save did not touch keywordGroups (prune only
    // runs when the caller is rewriting groups).
    expect(s.keywordHits.orphan).toBe(99);

    // Now the user removes 'bitcoin' from the group. Pruning runs and drops
    // both bitcoin and the orphan because neither is in any current group.
    await saveSettings({
      keywordGroups: [
        { id: 'g1', label: 'A', enabled: true, keywords: ['election'] },
      ],
    });
    s = await getSettings();
    expect(s.keywordHits.election).toBe(5);
    expect(s.keywordHits.bitcoin).toBeUndefined();
    expect(s.keywordHits.orphan).toBeUndefined();
  });

  it('blockedKeywords stays in sync when a group is flipped disabled then enabled', async () => {
    await saveSettings({
      keywordGroups: [
        { id: 'g1', label: 'Crypto', enabled: true, keywords: ['bitcoin'] },
      ],
    });
    let s = await getSettings();
    expect(s.blockedKeywords).toEqual(['bitcoin']);

    await saveSettings({
      keywordGroups: [
        { id: 'g1', label: 'Crypto', enabled: false, keywords: ['bitcoin'] },
      ],
    });
    s = await getSettings();
    expect(s.blockedKeywords).toEqual([]);

    await saveSettings({
      keywordGroups: [
        { id: 'g1', label: 'Crypto', enabled: true, keywords: ['bitcoin'] },
      ],
    });
    s = await getSettings();
    expect(s.blockedKeywords).toEqual(['bitcoin']);
  });
});
