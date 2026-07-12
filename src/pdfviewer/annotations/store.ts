import type { Annotation } from './types';

const DB_NAME = 'scrolllearn-pdf-annotations';
const STORE = 'annotations';
const DB_VERSION = 2;
const DOC_ID_INDEX = 'docId';

function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!indexedDbAvailable()) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      if (!transaction) {
        throw new Error('IndexedDB upgrade transaction unavailable');
      }
      const store = db.objectStoreNames.contains(STORE)
        ? transaction.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' });
      if (!store.indexNames.contains(DOC_ID_INDEX)) {
        store.createIndex(DOC_ID_INDEX, DOC_ID_INDEX);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (dbPromise === opening) dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });

  dbPromise = opening;
  void opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function withRequest<T>(
  mode: IDBTransactionMode,
  setup: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STORE, mode);
    } catch (error) {
      reject(error);
      return;
    }

    let request: IDBRequest<T>;
    try {
      request = setup(transaction.objectStore(STORE));
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    let requestSucceeded = false;
    let result: T;
    request.onsuccess = () => {
      result = request.result;
      requestSucceeded = true;
    };
    request.onerror = () => {
      transaction.abort();
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
    transaction.oncomplete = () => {
      if (!requestSucceeded) {
        reject(new Error('IndexedDB transaction completed before its request'));
        return;
      }
      resolve(result);
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
  }));
}

function deleteById(id: IDBValidKey): Promise<void> {
  return withRequest<undefined>('readwrite', store => store.delete(id));
}

function deleteByDocId(docId: string): Promise<void> {
  return openDb().then(db => new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STORE, 'readwrite');
    } catch (error) {
      reject(error);
      return;
    }

    let request: IDBRequest<IDBCursorWithValue | null>;
    try {
      request = transaction
        .objectStore(STORE)
        .index(DOC_ID_INDEX)
        .openCursor(IDBKeyRange.only(docId));
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const deletion = cursor.delete();
      deletion.onerror = () => {
        transaction.abort();
        reject(deletion.error ?? new Error('IndexedDB delete failed'));
      };
      cursor.continue();
    };
    request.onerror = () => {
      transaction.abort();
      reject(request.error ?? new Error('IndexedDB cursor failed'));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
  }));
}

export async function getForDoc(docId: string): Promise<Annotation[]> {
  if (!indexedDbAvailable()) return [];

  try {
    return await withRequest<Annotation[]>('readonly', store =>
      store.index(DOC_ID_INDEX).getAll(docId),
    );
  } catch {
    return [];
  }
}

export async function put(annotation: Annotation): Promise<void> {
  if (!indexedDbAvailable()) {
    throw new Error('IndexedDB unavailable');
  }
  await withRequest('readwrite', store => store.put(annotation));
}

export async function remove(id: string): Promise<void> {
  if (!indexedDbAvailable()) {
    throw new Error('IndexedDB unavailable');
  }
  await deleteById(id);
}

export async function clearDoc(docId: string): Promise<void> {
  if (!indexedDbAvailable()) return;

  try {
    await deleteByDocId(docId);
  } catch {
    // Persistence is best-effort because annotations must not block PDF reading.
  }
}
