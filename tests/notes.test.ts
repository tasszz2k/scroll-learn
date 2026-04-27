import { describe, it, expect, beforeEach } from 'vitest';
import { detectVietnamese } from '../src/common/translate';
import {
  getNotes,
  saveNote,
  deleteNote,
  clearNotes,
  pruneNotesOlderThan,
} from '../src/common/storage';
import { createNote, STORAGE_KEYS } from '../src/common/types';
import {
  entryMatches,
  isHostAllowed,
  parseRegexEntry,
  validateAllowlistEntry,
} from '../src/common/allowlist';

// Minimal in-memory chrome.storage.local mock
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

describe('detectVietnamese', () => {
  it('returns true for Vietnamese diacritics', () => {
    expect(detectVietnamese('xin chào')).toBe(true);
    expect(detectVietnamese('Tiếng Việt')).toBe(true);
    expect(detectVietnamese('phở bò')).toBe(true);
  });

  it('returns false for plain English', () => {
    expect(detectVietnamese('hello world')).toBe(false);
    expect(detectVietnamese('The quick brown fox')).toBe(false);
  });

  it('returns false for ASCII-only Vietnamese-looking strings without diacritics', () => {
    expect(detectVietnamese('xin chao')).toBe(false);
    expect(detectVietnamese('pho bo')).toBe(false);
  });
});

describe('notes storage', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('saves and retrieves notes', async () => {
    const note = createNote({
      text: 'hello world',
      url: 'https://example.com/page',
      pageTitle: 'Example',
      domain: 'example.com',
    });
    await saveNote(note);
    const all = await getNotes();
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('hello world');
  });

  it('deletes a single note', async () => {
    const a = createNote({ text: 'a', url: 'u', pageTitle: 't', domain: 'd' });
    const b = createNote({ text: 'b', url: 'u', pageTitle: 't', domain: 'd' });
    await saveNote(a);
    await saveNote(b);
    await deleteNote(a.id);
    const all = await getNotes();
    expect(all.map(n => n.text)).toEqual(['b']);
  });

  it('clears all notes', async () => {
    await saveNote(createNote({ text: 'a', url: 'u', pageTitle: 't', domain: 'd' }));
    await saveNote(createNote({ text: 'b', url: 'u', pageTitle: 't', domain: 'd' }));
    await clearNotes();
    const all = await getNotes();
    expect(all).toEqual([]);
  });

  it('dedupes identical text+domain saved within 5 seconds', async () => {
    const base = createNote({
      text: 'duplicate',
      url: 'https://example.com/a',
      pageTitle: 'a',
      domain: 'example.com',
    });
    await saveNote(base);

    const second = createNote({
      text: 'duplicate',
      url: 'https://example.com/b',
      pageTitle: 'b',
      domain: 'example.com',
    });
    // createdAt should be very close to base.createdAt — within the 5s window
    await saveNote(second);

    const all = await getNotes();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(base.id);
  });

  it('does not dedupe identical text from a different domain', async () => {
    await saveNote(createNote({
      text: 'duplicate',
      url: 'https://a.example/',
      pageTitle: 'a',
      domain: 'a.example',
    }));
    await saveNote(createNote({
      text: 'duplicate',
      url: 'https://b.example/',
      pageTitle: 'b',
      domain: 'b.example',
    }));
    const all = await getNotes();
    expect(all).toHaveLength(2);
  });

  it('does not dedupe identical text outside the 5s window', async () => {
    const old = createNote({
      text: 'duplicate',
      url: 'u',
      pageTitle: 't',
      domain: 'd',
    });
    // Force createdAt to be 10 seconds in the past
    old.createdAt = Date.now() - 10_000;
    await saveNote(old);

    await saveNote(createNote({
      text: 'duplicate',
      url: 'u',
      pageTitle: 't',
      domain: 'd',
    }));
    const all = await getNotes();
    expect(all).toHaveLength(2);
  });
});

describe('pruneNotesOlderThan', () => {
  beforeEach(() => {
    installChromeMock();
  });

  it('is a no-op when days <= 0', async () => {
    const old = createNote({ text: 'old', url: 'u', pageTitle: 't', domain: 'd' });
    old.createdAt = Date.now() - 30 * 86400000;
    await saveNote(old);

    const removed = await pruneNotesOlderThan(0);
    expect(removed).toBe(0);
    const all = await getNotes();
    expect(all).toHaveLength(1);
  });

  it('removes notes older than the retention window and keeps recent ones', async () => {
    const recent = createNote({ text: 'recent', url: 'u', pageTitle: 't', domain: 'd' });
    const stale = createNote({ text: 'stale', url: 'u', pageTitle: 't', domain: 'd' });
    stale.createdAt = Date.now() - 10 * 86400000;
    // Bypass dedupe by using unrelated domains/text — but stale.text differs from recent.text already
    await saveNote(stale);
    await saveNote(recent);

    const removed = await pruneNotesOlderThan(7);
    expect(removed).toBe(1);

    const all = await getNotes();
    expect(all.map(n => n.text)).toEqual(['recent']);
  });

  it('uses the correct storage key', async () => {
    expect(STORAGE_KEYS.NOTES).toBe('scrolllearn_notes');
  });
});

describe('allowlist matching', () => {
  it('parses /pattern/flags as a regex entry', () => {
    expect(parseRegexEntry('/foo/')).toEqual({ source: 'foo', flags: '' });
    expect(parseRegexEntry('/foo/i')).toEqual({ source: 'foo', flags: 'i' });
    expect(parseRegexEntry('/.*\\.wikipedia\\.org$/')).toEqual({
      source: '.*\\.wikipedia\\.org$',
      flags: '',
    });
  });

  it('treats plain entries as non-regex', () => {
    expect(parseRegexEntry('example.com')).toBeNull();
    expect(parseRegexEntry('en.wikipedia.org')).toBeNull();
  });

  it('matches plain entries by exact (case-insensitive) hostname', () => {
    expect(entryMatches('example.com', 'example.com')).toBe(true);
    expect(entryMatches('Example.COM', 'example.com')).toBe(true);
    expect(entryMatches('example.com', 'sub.example.com')).toBe(false);
  });

  it('matches regex entries against the hostname', () => {
    expect(entryMatches('/.*\\.wikipedia\\.org$/', 'en.wikipedia.org')).toBe(true);
    expect(entryMatches('/.*\\.wikipedia\\.org$/', 'wikipedia.org')).toBe(false);
    expect(entryMatches('/^news\\./i', 'news.ycombinator.com')).toBe(true);
  });

  it('returns false for invalid regex without throwing', () => {
    expect(entryMatches('/[unclosed/', 'whatever')).toBe(false);
  });

  it('isHostAllowed returns true if any entry matches', () => {
    const list = ['example.com', '/.*\\.wikipedia\\.org$/'];
    expect(isHostAllowed(list, 'example.com')).toBe(true);
    expect(isHostAllowed(list, 'en.wikipedia.org')).toBe(true);
    expect(isHostAllowed(list, 'reddit.com')).toBe(false);
  });

  it('validateAllowlistEntry flags invalid regex but accepts valid ones', () => {
    expect(validateAllowlistEntry('example.com')).toBeNull();
    expect(validateAllowlistEntry('/.*\\.wikipedia\\.org$/')).toBeNull();
    expect(validateAllowlistEntry('/[unclosed/')).toBe('invalid-regex');
    expect(validateAllowlistEntry('   ')).toBe('empty');
  });
});
