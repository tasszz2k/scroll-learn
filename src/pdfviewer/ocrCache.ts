// IndexedDB-backed cache for per-page OCR results.
//
// OCR-ing a scanned page with Tesseract costs a few seconds of CPU, so we only
// want to pay it once per document. Word geometry is tiny (a few KB per page),
// so unlike the TTS audio cache this is bounded by entry count rather than
// bytes. Entries are keyed by the PDF's content fingerprint plus page index so
// the cache survives file moves/renames and never collides across documents.
//
// Boxes are stored in scale-independent page-point coordinates (the unscaled
// PDF.js viewport, scale = 1). The viewer multiplies by the current render
// scale when building the overlay, so a cached result stays correct even if
// the window width or device pixel ratio differs on the next open.

import type { OcrWord } from './ocr';

const DB_NAME = 'scrolllearn-ocr-cache';
const STORE = 'pages';
const DB_VERSION = 1;

// Word arrays are small; cap by page count and evict the least-recently-used.
const MAX_ENTRIES = 5000;

export interface CachedOcrPage {
  // `${docId}:${pageIndex}`
  key: string;
  words: OcrWord[];
  createdAt: number;
  lastUsedAt: number;
}

function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!indexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('lastUsedAt', 'lastUsedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    Promise.resolve(fn(store)).then(value => {
      result = value;
    }).catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function ocrCacheKey(docId: string, pageIndex: number): string {
  return `${docId}:${pageIndex}`;
}

// Return cached words (in page-point coords) or null on miss / unavailable.
// Stamps lastUsedAt so eviction targets the truly idle documents.
export async function getCachedOcr(key: string): Promise<OcrWord[] | null> {
  if (!indexedDbAvailable()) return null;
  try {
    return await withStore<OcrWord[] | null>('readwrite', async (store) => {
      const entry = await reqAsPromise<CachedOcrPage | undefined>(store.get(key));
      if (!entry) return null;
      store.put({ ...entry, lastUsedAt: Date.now() });
      return entry.words;
    });
  } catch {
    return null;
  }
}

export async function putCachedOcr(key: string, words: OcrWord[]): Promise<void> {
  if (!indexedDbAvailable()) return;
  const now = Date.now();
  const entry: CachedOcrPage = { key, words, createdAt: now, lastUsedAt: now };
  try {
    await withStore<void>('readwrite', store => {
      store.put(entry);
    });
  } catch {
    return;
  }
  void evictIfOverBudget();
}

export async function clearOcrCache(): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>('readwrite', store => {
      store.clear();
    });
  } catch {
    /* ignore */
  }
}

async function evictIfOverBudget(): Promise<void> {
  try {
    const entries = await withStore<CachedOcrPage[]>('readonly', store =>
      reqAsPromise(store.getAll()),
    );
    if (entries.length <= MAX_ENTRIES) return;
    entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const toRemove = entries.slice(0, entries.length - MAX_ENTRIES).map(e => e.key);
    await withStore<void>('readwrite', store => {
      toRemove.forEach(k => store.delete(k));
    });
  } catch {
    /* ignore */
  }
}
