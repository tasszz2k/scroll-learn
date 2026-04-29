// Tests for src/common/tts/audioCache.ts.
//
// audioCache is IndexedDB-backed. Vitest runs in Node which has no IDB, so we
// install a minimal in-memory shim before the module under test runs. The
// shim covers only the surface audioCache actually exercises (open with
// onupgradeneeded, transactions, get/put/delete/getAll/clear, and the
// promise-style request lifecycle). Behaviour-faithful enough for these
// tests without pulling in a fake-indexeddb dev dependency.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ------------------------------------------------------------------ shim

interface FakeRequest<T = unknown> {
  result: T;
  error: Error | null;
  onsuccess: ((this: FakeRequest<T>, ev: Event) => unknown) | null;
  onerror: ((this: FakeRequest<T>, ev: Event) => unknown) | null;
  onupgradeneeded?: ((this: FakeRequest<T>, ev: Event) => unknown) | null;
}

interface FakeTransaction {
  objectStore(name: string): FakeStore;
  oncomplete: ((this: FakeTransaction, ev: Event) => unknown) | null;
  onerror: ((this: FakeTransaction, ev: Event) => unknown) | null;
  onabort: ((this: FakeTransaction, ev: Event) => unknown) | null;
  error: Error | null;
}

interface FakeStore {
  get(key: string): FakeRequest;
  getAll(): FakeRequest;
  put(value: unknown): FakeRequest;
  delete(key: string): FakeRequest;
  clear(): FakeRequest;
  createIndex(name: string, keyPath: string): unknown;
}

interface FakeDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, opts: { keyPath: string }): FakeStore;
  transaction(storeName: string, mode: 'readonly' | 'readwrite'): FakeTransaction;
}

// Module-level state lives outside the install function so the test can wipe
// it between runs without re-creating the global indexedDB binding.
let storeData: Map<string, Record<string, unknown>> = new Map();

function makeRequest<T>(value: T): FakeRequest<T> {
  const req: FakeRequest<T> = {
    result: value,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  // Fire success on the next microtask so the caller has time to attach
  // onsuccess. Mirrors the real IDB lifecycle.
  queueMicrotask(() => {
    req.onsuccess?.call(req, new Event('success'));
  });
  return req;
}

function makeStore(): FakeStore {
  return {
    get(key) {
      return makeRequest(storeData.get(key));
    },
    getAll() {
      return makeRequest(Array.from(storeData.values()));
    },
    put(value) {
      const v = value as { key: string };
      storeData.set(v.key, v as Record<string, unknown>);
      return makeRequest(v.key);
    },
    delete(key) {
      storeData.delete(key);
      return makeRequest(undefined);
    },
    clear() {
      storeData.clear();
      return makeRequest(undefined);
    },
    createIndex() { /* shim ignores indices */ },
  };
}

function makeTransaction(): FakeTransaction {
  const tx: FakeTransaction = {
    objectStore: () => makeStore(),
    oncomplete: null,
    onerror: null,
    onabort: null,
    error: null,
  };
  // Real IDB completes the transaction after all queued requests settle.
  // The shim doesn't track in-flight requests, so we approximate by deferring
  // oncomplete to a macrotask (setTimeout 0). That's later than the request
  // callbacks (which run on microtasks) and the audioCache caller's
  // .then(value => result = value) chain, so result is populated by the time
  // tx.oncomplete fires.
  setTimeout(() => tx.oncomplete?.call(tx, new Event('complete')), 0);
  return tx;
}

function installFakeIndexedDB(): void {
  const db: FakeDatabase = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => makeStore(),
    transaction: () => makeTransaction(),
  };

  const fakeIndexedDB = {
    open(_name: string, _version: number): FakeRequest<FakeDatabase> {
      const req: FakeRequest<FakeDatabase> = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      // Fire upgradeneeded first (so audioCache creates the store), then
      // success on the next microtask.
      queueMicrotask(() => {
        req.onupgradeneeded?.call(req, new Event('upgradeneeded'));
        queueMicrotask(() => req.onsuccess?.call(req, new Event('success')));
      });
      return req;
    },
  };

  // @ts-expect-error -- Node has no IDB type binding; we are deliberately
  // patching a global for the duration of the test.
  globalThis.indexedDB = fakeIndexedDB;
}

function uninstallFakeIndexedDB(): void {
  // @ts-expect-error -- see installFakeIndexedDB.
  delete globalThis.indexedDB;
}

// ------------------------------------------------------------------ tests

// Import lazily so installFakeIndexedDB runs first.
async function loadCache() {
  // Bust any cached module instance so each test sees a fresh dbPromise.
  // Vitest reuses ESM modules within a worker by default; resetDbHandle on
  // the module clears its internal handle so reopen runs again.
  const mod = await import('../src/common/tts/audioCache');
  mod.resetDbHandle();
  return mod;
}

describe('audioCache', () => {
  beforeEach(() => {
    storeData = new Map();
    installFakeIndexedDB();
  });

  afterEach(() => {
    uninstallFakeIndexedDB();
  });

  it('returns null on a cache miss', async () => {
    const cache = await loadCache();
    const hit = await cache.getCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hello' });
    expect(hit).toBeNull();
  });

  it('roundtrips a Blob through put + get', async () => {
    const cache = await loadCache();
    const blob = new Blob(['hello world'], { type: 'audio/mpeg' });
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hello' }, blob);
    const hit = await cache.getCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hello' });
    expect(hit).not.toBeNull();
    expect(hit!.providerId).toBe('elevenlabs-api');
    expect(hit!.voice).toBe('Rachel');
    expect(hit!.text).toBe('hello');
    expect(hit!.byteLength).toBeGreaterThan(0);
    expect(hit!.mimeType).toBe('audio/mpeg');
  });

  it('keys distinct (provider, voice, text) entries separately', async () => {
    const cache = await loadCache();
    const a = new Blob(['A'], { type: 'audio/mpeg' });
    const b = new Blob(['B'], { type: 'audio/wav' });
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hi' }, a);
    await cache.putCached({ providerId: 'kokoro-api', voice: 'af_heart', text: 'hi' }, b);

    const fromEl = await cache.getCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hi' });
    const fromKokoro = await cache.getCached({ providerId: 'kokoro-api', voice: 'af_heart', text: 'hi' });

    expect(fromEl?.providerId).toBe('elevenlabs-api');
    expect(fromKokoro?.providerId).toBe('kokoro-api');
    expect(fromEl?.byteLength).toBe(1);
    expect(fromKokoro?.byteLength).toBe(1);
  });

  it('treats text comparison case-sensitively (drill variations stay independent)', async () => {
    const cache = await loadCache();
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'Hello' }, blob);

    const lower = await cache.getCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hello' });
    const exact = await cache.getCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'Hello' });
    expect(lower).toBeNull();
    expect(exact).not.toBeNull();
  });

  it('deleteCached removes an entry', async () => {
    const cache = await loadCache();
    const key = { providerId: 'elevenlabs-api' as const, voice: 'Rachel', text: 'gone' };
    await cache.putCached(key, new Blob(['x']), 'audio/mpeg');
    expect(await cache.getCached(key)).not.toBeNull();
    await cache.deleteCached(key);
    expect(await cache.getCached(key)).toBeNull();
  });

  it('clearCache empties everything', async () => {
    const cache = await loadCache();
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'a', text: '1' }, new Blob(['x']));
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'a', text: '2' }, new Blob(['y']));
    expect((await cache.listCached()).length).toBe(2);
    await cache.clearCache();
    expect((await cache.listCached()).length).toBe(0);
  });

  it('listCached + getCacheBytes report size correctly', async () => {
    const cache = await loadCache();
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'a', text: 'one' }, new Blob(['12345']));
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'a', text: 'two' }, new Blob(['67890']));
    const entries = await cache.listCached();
    expect(entries).toHaveLength(2);
    const total = await cache.getCacheBytes();
    expect(total).toBe(10);
  });

  it('purgeOlderThan removes only stale entries', async () => {
    const cache = await loadCache();
    // Manually seed an old entry by reaching into the shim store.
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    storeData.set('elevenlabs-api|a|old', {
      key: 'elevenlabs-api|a|old',
      blob: new Blob(['x']),
      mimeType: 'audio/mpeg',
      byteLength: 1,
      providerId: 'elevenlabs-api',
      voice: 'a',
      text: 'old',
      createdAt: tenMinAgo,
      lastUsedAt: tenMinAgo,
    });
    await cache.putCached({ providerId: 'elevenlabs-api', voice: 'a', text: 'fresh' }, new Blob(['y']));

    const removed = await cache.purgeOlderThan(5 * 60 * 1000);
    expect(removed).toBe(1);
    const remaining = await cache.listCached();
    expect(remaining.map(e => e.text)).toEqual(['fresh']);
  });

  it('roundtrips an entry with alignment data intact', async () => {
    const cache = await loadCache();
    const blob = new Blob(['abc'], { type: 'audio/mpeg' });
    const charStartTimesSec = [0.0, 0.05, 0.12, 0.18, 0.24];
    await cache.putCached(
      { providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hello' },
      blob,
      'audio/mpeg',
      { charStartTimesSec },
    );
    const hit = await cache.getCached({ providerId: 'elevenlabs-api', voice: 'Rachel', text: 'hello' });
    expect(hit).not.toBeNull();
    expect(hit!.alignment).toBeDefined();
    expect(hit!.alignment!.charStartTimesSec).toEqual(charStartTimesSec);
  });

  it('roundtrips an entry without alignment (back-compat with pre-Phase-2 records)', async () => {
    const cache = await loadCache();
    const blob = new Blob(['xyz'], { type: 'audio/mpeg' });
    await cache.putCached(
      { providerId: 'kokoro-api', voice: 'af_heart', text: 'no timing' },
      blob,
    );
    const hit = await cache.getCached({ providerId: 'kokoro-api', voice: 'af_heart', text: 'no timing' });
    expect(hit).not.toBeNull();
    expect(hit!.alignment).toBeUndefined();
    expect(hit!.byteLength).toBeGreaterThan(0);
  });

  it('returns null and stays silent when IndexedDB is unavailable', async () => {
    uninstallFakeIndexedDB();
    const cache = await loadCache();
    const hit = await cache.getCached({ providerId: 'elevenlabs-api', voice: 'a', text: 't' });
    expect(hit).toBeNull();
    // putCached should not throw either.
    await expect(
      cache.putCached({ providerId: 'elevenlabs-api', voice: 'a', text: 't' }, new Blob(['x'])),
    ).resolves.toBeUndefined();
    expect(await cache.listCached()).toEqual([]);
    expect(await cache.getCacheBytes()).toBe(0);
  });
});
