// IndexedDB store for saved-text highlights in the in-extension PDF viewer.
//
// When the user plucks text from a PDF we save it as a bookmark AND paint a
// persistent colored highlight over the exact words on the page, so reopening
// the document shows what was already captured and hovering a highlight brings
// back its explanation (translation / senses / word family).
//
// Rects are stored in scale-independent page-point coordinates (the unscaled
// PDF.js viewport, scale = 1), exactly like the OCR cache, so a highlight
// stays aligned regardless of the window width / device pixel ratio on the
// next open. Highlights are grouped per document via the `docId` index (the
// PDF content fingerprint).

import type { DictionarySense } from '../common/types';
import type { DerivedForm } from '../common/wordFamily';

const DB_NAME = 'scrolllearn-pdf-highlights';
const STORE = 'highlights';
const DB_VERSION = 1;

// A single line box (or element box) in page-point space.
export interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoredHighlight {
  id: string;
  docId: string;
  pageIndex: number;
  text: string;
  rects: HighlightRect[];
  createdAt: number;
  translation?: string;
  senses?: DictionarySense[];
  derivedForms?: DerivedForm[];
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
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('docId', 'docId');
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

export async function getHighlightsForDoc(docId: string): Promise<StoredHighlight[]> {
  if (!indexedDbAvailable()) return [];
  try {
    return await withStore<StoredHighlight[]>('readonly', store =>
      reqAsPromise(store.index('docId').getAll(docId)),
    );
  } catch {
    return [];
  }
}

export async function putHighlight(hl: StoredHighlight): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>('readwrite', store => {
      store.put(hl);
    });
  } catch {
    /* ignore */
  }
}

export async function deleteHighlight(id: string): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>('readwrite', store => {
      store.delete(id);
    });
  } catch {
    /* ignore */
  }
}
