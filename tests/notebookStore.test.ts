// Tests for src/common/notebookStore.ts.
//
// notebookStore is IndexedDB-backed. Vitest runs in Node which has no IDB,
// so we install a minimal in-memory shim before the module under test
// runs. The shim is multi-store (bodies + attachments) and tracks a
// notebookId index by walking the values in listAttachments() / index ops.
// Behaviour-faithful enough for these tests without pulling in
// fake-indexeddb as a dev dependency.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

interface FakeIndex {
  getAll(key: string): FakeRequest;
}

interface FakeStore {
  get(key: string): FakeRequest;
  getAll(): FakeRequest;
  put(value: unknown): FakeRequest;
  delete(key: string): FakeRequest;
  clear(): FakeRequest;
  createIndex(name: string, keyPath: string): unknown;
  index(name: string): FakeIndex;
}

interface FakeDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, opts: { keyPath: string }): FakeStore;
  transaction(storeName: string, mode: 'readonly' | 'readwrite'): FakeTransaction;
}

// Module-level state lives outside install so tests can reset between runs.
let stores: Map<string, Map<string, Record<string, unknown>>> = new Map();

function getOrCreateStoreData(name: string): Map<string, Record<string, unknown>> {
  let s = stores.get(name);
  if (!s) {
    s = new Map();
    stores.set(name, s);
  }
  return s;
}

function makeRequest<T>(value: T): FakeRequest<T> {
  const req: FakeRequest<T> = {
    result: value,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => {
    req.onsuccess?.call(req, new Event('success'));
  });
  return req;
}

function makeStore(storeName: string): FakeStore {
  const data = getOrCreateStoreData(storeName);
  return {
    get(key) {
      return makeRequest(data.get(key));
    },
    getAll() {
      return makeRequest(Array.from(data.values()));
    },
    put(value) {
      const v = value as { id: string };
      data.set(v.id, v as Record<string, unknown>);
      return makeRequest(v.id);
    },
    delete(key) {
      data.delete(key);
      return makeRequest(undefined);
    },
    clear() {
      data.clear();
      return makeRequest(undefined);
    },
    createIndex() { /* shim ignores indices for this suite */ },
    index(_name) {
      // notebookStore only ever calls listAttachments via getAll then
      // filters in JS, so the index path is only here for completeness.
      return {
        getAll(_key: string) {
          return makeRequest(Array.from(data.values()));
        },
      };
    },
  };
}

function makeTransaction(): FakeTransaction {
  const tx: FakeTransaction = {
    objectStore: (name: string) => makeStore(name),
    oncomplete: null,
    onerror: null,
    onabort: null,
    error: null,
  };
  setTimeout(() => tx.oncomplete?.call(tx, new Event('complete')), 0);
  return tx;
}

function installFakeIndexedDB(): void {
  const db: FakeDatabase = {
    objectStoreNames: { contains: () => true },
    createObjectStore: (name: string) => makeStore(name),
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
      queueMicrotask(() => {
        req.onupgradeneeded?.call(req, new Event('upgradeneeded'));
        queueMicrotask(() => req.onsuccess?.call(req, new Event('success')));
      });
      return req;
    },
  };

  // @ts-expect-error -- patching the Node global for the duration of tests.
  globalThis.indexedDB = fakeIndexedDB;
}

function uninstallFakeIndexedDB(): void {
  // @ts-expect-error -- see installFakeIndexedDB.
  delete globalThis.indexedDB;
}

async function loadStore() {
  const mod = await import('../src/common/notebookStore');
  mod.resetDbHandle();
  return mod;
}

describe('notebookStore bodies', () => {
  beforeEach(() => {
    stores = new Map();
    installFakeIndexedDB();
  });
  afterEach(() => {
    uninstallFakeIndexedDB();
  });

  it('returns empty string on a body miss', async () => {
    const ns = await loadStore();
    expect(await ns.getBody('missing')).toBe('');
  });

  it('roundtrips a body through saveBody + getBody', async () => {
    const ns = await loadStore();
    await ns.saveBody('nb1', '# Hello\n\nBody');
    expect(await ns.getBody('nb1')).toBe('# Hello\n\nBody');
  });

  it('overwrites the body on a second save', async () => {
    const ns = await loadStore();
    await ns.saveBody('nb1', 'first');
    await ns.saveBody('nb1', 'second');
    expect(await ns.getBody('nb1')).toBe('second');
  });

  it('keeps separate bodies per notebook id', async () => {
    const ns = await loadStore();
    await ns.saveBody('a', 'A body');
    await ns.saveBody('b', 'B body');
    expect(await ns.getBody('a')).toBe('A body');
    expect(await ns.getBody('b')).toBe('B body');
  });

  it('deleteBody removes the entry', async () => {
    const ns = await loadStore();
    await ns.saveBody('nb1', 'hi');
    await ns.deleteBody('nb1');
    expect(await ns.getBody('nb1')).toBe('');
  });
});

describe('notebookStore attachments', () => {
  beforeEach(() => {
    stores = new Map();
    installFakeIndexedDB();
  });
  afterEach(() => {
    uninstallFakeIndexedDB();
  });

  it('persists an attachment and lists it back', async () => {
    const ns = await loadStore();
    const blob = new Blob(['xyz'], { type: 'image/png' });
    const att = await ns.putAttachment({
      notebookId: 'nb1',
      filename: 'screenshot.png',
      mime: 'image/png',
      blob,
    });
    expect(att.id).toBeTruthy();
    expect(att.notebookId).toBe('nb1');
    expect(att.byteLength).toBe(3);

    const list = await ns.listAttachments('nb1');
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe('screenshot.png');
  });

  it('listAttachments scopes results to the requested notebook', async () => {
    const ns = await loadStore();
    await ns.putAttachment({
      notebookId: 'nb1',
      filename: 'a.png',
      mime: 'image/png',
      blob: new Blob(['a'], { type: 'image/png' }),
    });
    await ns.putAttachment({
      notebookId: 'nb2',
      filename: 'b.png',
      mime: 'image/png',
      blob: new Blob(['b'], { type: 'image/png' }),
    });
    const onlyNb1 = await ns.listAttachments('nb1');
    expect(onlyNb1).toHaveLength(1);
    expect(onlyNb1[0].filename).toBe('a.png');
  });

  it('getAttachment returns the entry by id', async () => {
    const ns = await loadStore();
    const blob = new Blob(['x'], { type: 'image/png' });
    const att = await ns.putAttachment({
      notebookId: 'nb1',
      filename: 'foo.png',
      mime: 'image/png',
      blob,
    });
    const fetched = await ns.getAttachment(att.id);
    expect(fetched?.filename).toBe('foo.png');
    expect(fetched?.notebookId).toBe('nb1');
  });

  it('deleteAttachment removes a single attachment', async () => {
    const ns = await loadStore();
    const att = await ns.putAttachment({
      notebookId: 'nb1',
      filename: 'a.png',
      mime: 'image/png',
      blob: new Blob(['a']),
    });
    await ns.deleteAttachment(att.id);
    expect(await ns.getAttachment(att.id)).toBeNull();
  });

  it('deleteAttachmentsFor wipes every attachment of a notebook and counts them', async () => {
    const ns = await loadStore();
    await ns.putAttachment({
      notebookId: 'nb1',
      filename: 'a.png',
      mime: 'image/png',
      blob: new Blob(['a']),
    });
    await ns.putAttachment({
      notebookId: 'nb1',
      filename: 'b.png',
      mime: 'image/png',
      blob: new Blob(['b']),
    });
    await ns.putAttachment({
      notebookId: 'nb2',
      filename: 'c.png',
      mime: 'image/png',
      blob: new Blob(['c']),
    });

    const removed = await ns.deleteAttachmentsFor('nb1');
    expect(removed).toBe(2);
    expect(await ns.listAttachments('nb1')).toHaveLength(0);
    expect(await ns.listAttachments('nb2')).toHaveLength(1);
  });

  it('deleteAllForNotebook removes the body and every attachment in one call', async () => {
    const ns = await loadStore();
    await ns.saveBody('nb1', 'goodbye');
    await ns.putAttachment({
      notebookId: 'nb1',
      filename: 'a.png',
      mime: 'image/png',
      blob: new Blob(['a']),
    });

    await ns.deleteAllForNotebook('nb1');
    expect(await ns.getBody('nb1')).toBe('');
    expect(await ns.listAttachments('nb1')).toHaveLength(0);
  });
});

describe('notebookStore graceful degradation', () => {
  beforeEach(() => {
    stores = new Map();
  });
  afterEach(() => {
    uninstallFakeIndexedDB();
  });

  it('returns empty body and silently no-ops writes when IndexedDB is unavailable', async () => {
    const ns = await loadStore();
    expect(await ns.getBody('x')).toBe('');
    await expect(ns.saveBody('x', 'hi')).resolves.toBeUndefined();
    await expect(ns.deleteBody('x')).resolves.toBeUndefined();
    expect(await ns.listAttachments('x')).toEqual([]);
    expect(await ns.getAttachment('any')).toBeNull();
  });
});
