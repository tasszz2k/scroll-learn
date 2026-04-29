// IndexedDB-backed storage for notebook bodies + image attachments.
//
// chrome.storage.local has a 5 MB cap and a 100 KB-per-item cap, which
// makes it unsuitable for multi-MB markdown blobs and image Blobs. More
// importantly, storage.onChanged fires on every write, so storing the body
// there would fan a fresh copy of the entire notebook through the live-sync
// listener on every keystroke -- expensive and unnecessary. IndexedDB has
// neither limit.
//
// This module is deliberately small and dependency-free; mirrors the shape
// of src/common/tts/audioCache.ts so anyone reading the codebase can map
// one onto the other.

import { generateId } from './types';

const DB_NAME = 'scrolllearn-notebooks';
const STORE_BODIES = 'bodies';
const STORE_ATTACHMENTS = 'attachments';
const DB_VERSION = 1;

export interface NotebookBody {
  // Same id as the parent Notebook's metadata record.
  id: string;
  markdown: string;
  updatedAt: number;
}

export interface NotebookAttachment {
  // Standalone attachment id; stable for the lifetime of the notebook so
  // the editor can embed it as `attachment://<id>` and the renderer can
  // resolve it back to a blob URL.
  id: string;
  notebookId: string;
  mime: string;
  filename: string;
  blob: Blob;
  byteLength: number;
  createdAt: number;
}

// Tests and the service worker both lack IndexedDB. Treat the store as
// unavailable rather than crashing.
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
      if (!db.objectStoreNames.contains(STORE_BODIES)) {
        db.createObjectStore(STORE_BODIES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ATTACHMENTS)) {
        const store = db.createObjectStore(STORE_ATTACHMENTS, { keyPath: 'id' });
        // Lookup by notebookId for delete-all-attachments-for-notebook on
        // notebook delete.
        store.createIndex('notebookId', 'notebookId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

export function resetDbHandle(): void {
  dbPromise = null;
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
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

// ---------------------------------------------------------------- bodies

export async function getBody(notebookId: string): Promise<string> {
  if (!indexedDbAvailable()) return '';
  try {
    const entry = await withStore<NotebookBody | undefined>(
      STORE_BODIES,
      'readonly',
      store => reqAsPromise(store.get(notebookId)),
    );
    return entry?.markdown ?? '';
  } catch {
    return '';
  }
}

export async function saveBody(notebookId: string, markdown: string): Promise<void> {
  if (!indexedDbAvailable()) return;
  const entry: NotebookBody = {
    id: notebookId,
    markdown,
    updatedAt: Date.now(),
  };
  try {
    await withStore<void>(STORE_BODIES, 'readwrite', store => {
      store.put(entry);
    });
  } catch {
    /* nothing actionable; autosave will retry on the next keystroke */
  }
}

export async function deleteBody(notebookId: string): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>(STORE_BODIES, 'readwrite', store => {
      store.delete(notebookId);
    });
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------- attachments

export interface PutAttachmentInput {
  notebookId: string;
  filename: string;
  mime: string;
  blob: Blob;
}

export async function putAttachment(input: PutAttachmentInput): Promise<NotebookAttachment> {
  const entry: NotebookAttachment = {
    id: generateId(),
    notebookId: input.notebookId,
    mime: input.mime || input.blob.type || 'application/octet-stream',
    filename: input.filename,
    blob: input.blob,
    byteLength: input.blob.size,
    createdAt: Date.now(),
  };
  if (!indexedDbAvailable()) return entry;
  try {
    await withStore<void>(STORE_ATTACHMENTS, 'readwrite', store => {
      store.put(entry);
    });
  } catch {
    /* nothing to surface; the editor will show the placeholder anyway */
  }
  return entry;
}

export async function getAttachment(id: string): Promise<NotebookAttachment | null> {
  if (!indexedDbAvailable()) return null;
  try {
    const entry = await withStore<NotebookAttachment | undefined>(
      STORE_ATTACHMENTS,
      'readonly',
      store => reqAsPromise(store.get(id)),
    );
    return entry ?? null;
  } catch {
    return null;
  }
}

export async function listAttachments(notebookId: string): Promise<NotebookAttachment[]> {
  if (!indexedDbAvailable()) return [];
  try {
    const all = await withStore<NotebookAttachment[]>(
      STORE_ATTACHMENTS,
      'readonly',
      store => reqAsPromise(store.getAll()),
    );
    return all.filter(a => a.notebookId === notebookId);
  } catch {
    return [];
  }
}

export async function deleteAttachment(id: string): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>(STORE_ATTACHMENTS, 'readwrite', store => {
      store.delete(id);
    });
  } catch {
    /* ignore */
  }
}

// Delete every attachment whose notebookId matches. Called from the
// notebook delete path so dangling Blobs do not accumulate in IndexedDB.
export async function deleteAttachmentsFor(notebookId: string): Promise<number> {
  if (!indexedDbAvailable()) return 0;
  const all = await listAttachments(notebookId);
  if (all.length === 0) return 0;
  try {
    await withStore<void>(STORE_ATTACHMENTS, 'readwrite', store => {
      all.forEach(a => store.delete(a.id));
    });
  } catch {
    return 0;
  }
  return all.length;
}

// One-shot helper: tear down body + every attachment for the given notebook.
// The dashboard calls this before sending the 'delete_notebook' message, so
// metadata in chrome.storage and bodies in IndexedDB stay in sync.
export async function deleteAllForNotebook(notebookId: string): Promise<void> {
  await Promise.all([
    deleteBody(notebookId),
    deleteAttachmentsFor(notebookId),
  ]);
}

// Resolve an `attachment://<id>` URL embedded in markdown to a blob URL the
// renderer can paint into <img>. Caller is responsible for revoking the URL
// when the component unmounts.
export async function getAttachmentURL(id: string): Promise<string | null> {
  const att = await getAttachment(id);
  if (!att) return null;
  try {
    return URL.createObjectURL(att.blob);
  } catch {
    return null;
  }
}

// Wipe everything. Used by clearAllData() flows and tests.
export async function clearAll(): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>(STORE_BODIES, 'readwrite', store => {
      store.clear();
    });
    await withStore<void>(STORE_ATTACHMENTS, 'readwrite', store => {
      store.clear();
    });
  } catch {
    /* ignore */
  }
}
