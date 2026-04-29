// IndexedDB-backed cache for generated TTS audio.
//
// The Shadow player calls TTS providers (ElevenLabs, Kokoro) to render each
// dialogue line as audio. Those calls are expensive: ElevenLabs spends
// monthly free credits, Kokoro queues against a shared HuggingFace Space.
// Once a line has been rendered for a given (provider, voice, text) tuple,
// the result is permanent -- so we cache the Blob locally and replay it
// instead of re-generating.
//
// chrome.storage.local has a 5 MB cap and a 100 KB-per-item cap, which
// makes it unsuitable for binary audio. IndexedDB has neither limit and is
// available everywhere the dashboard runs.
//
// This module is intentionally small and dependency-free. The web-speech
// provider doesn't produce a Blob, so it never touches this cache; only the
// cloud providers do.

import type { TTSProviderId } from '../types';

const DB_NAME = 'scrolllearn-tts-cache';
const STORE = 'audio';
const DB_VERSION = 1;

// Soft upper bound on cached audio size. When exceeded, the oldest entries
// (by lastUsedAt) are evicted until the cache is back under budget.
const MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100 MB

export interface AudioCacheKey {
  providerId: TTSProviderId;
  // Provider-specific voice id. For Web Speech this is the voice.name; for
  // cloud providers it's the model/voice id from their UI.
  voice: string;
  // The exact text rendered. Treated case- and whitespace-sensitive on
  // purpose so the learner can drill subtle variations independently.
  text: string;
}

/**
 * Optional per-character timing data captured at generation time. We only
 * persist start times; character N's end is character N+1's start, and the
 * last character's end is the audio's natural duration. Length must equal
 * `text.length` exactly when present. Cache entries written before this
 * field existed simply lack it -- the playback path then falls back to the
 * static-highlight behaviour we shipped originally.
 */
export interface AudioAlignment {
  charStartTimesSec: number[];
}

export interface CachedAudioEntry {
  // Composite primary key (see keyOf).
  key: string;
  blob: Blob;
  mimeType: string;
  byteLength: number;
  providerId: TTSProviderId;
  voice: string;
  text: string;
  createdAt: number;
  lastUsedAt: number;
  alignment?: AudioAlignment;
}

function keyOf(k: AudioCacheKey): string {
  // Pipe-separated and never emitted to a UI; we can keep it simple. Text is
  // the dominant length, so it goes last.
  return `${k.providerId}|${k.voice}|${k.text}`;
}

// IndexedDB lives only in browser environments. Tests and the service
// worker should treat the cache as unavailable rather than crashing.
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
        store.createIndex('byteLength', 'byteLength');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

// Resets the cached promise after a hard close (e.g. after Chrome version
// changes the schema). Tests that wipe the DB also rely on this.
export function resetDbHandle(): void {
  dbPromise = null;
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

/**
 * Look up a cached audio entry. Returns the entry (and stamps lastUsedAt)
 * or null on miss / when IndexedDB is unavailable.
 */
export async function getCached(k: AudioCacheKey): Promise<CachedAudioEntry | null> {
  if (!indexedDbAvailable()) return null;
  const key = keyOf(k);
  try {
    return await withStore<CachedAudioEntry | null>('readwrite', async (store) => {
      const entry = await reqAsPromise<CachedAudioEntry | undefined>(store.get(key));
      if (!entry) return null;
      // Bump lastUsedAt so eviction picks the truly idle entries first.
      const updated: CachedAudioEntry = { ...entry, lastUsedAt: Date.now() };
      store.put(updated);
      return updated;
    });
  } catch {
    return null;
  }
}

/**
 * Store an audio Blob. Triggers a background eviction sweep if the cache
 * has grown beyond MAX_CACHE_BYTES. The optional `alignment` carries
 * per-character start times when the provider supplies them; cache hits
 * later replay it back through `playAudioBlob` to drive karaoke highlight.
 */
export async function putCached(
  k: AudioCacheKey,
  blob: Blob,
  mimeType: string = blob.type || 'audio/mpeg',
  alignment?: AudioAlignment,
): Promise<void> {
  if (!indexedDbAvailable()) return;
  const now = Date.now();
  const entry: CachedAudioEntry = {
    key: keyOf(k),
    blob,
    mimeType,
    byteLength: blob.size,
    providerId: k.providerId,
    voice: k.voice,
    text: k.text,
    createdAt: now,
    lastUsedAt: now,
    ...(alignment ? { alignment } : {}),
  };
  try {
    await withStore<void>('readwrite', store => {
      store.put(entry);
    });
  } catch {
    return;
  }
  // Eviction is fire-and-forget; failures don't matter to the caller.
  void evictIfOverBudget();
}

/**
 * Remove a single cached entry. No-op if the key isn't in the cache.
 */
export async function deleteCached(k: AudioCacheKey): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>('readwrite', store => {
      store.delete(keyOf(k));
    });
  } catch {
    /* ignore */
  }
}

/**
 * Walk the cache. Used by stats UI and tests.
 */
export async function listCached(): Promise<CachedAudioEntry[]> {
  if (!indexedDbAvailable()) return [];
  try {
    return await withStore<CachedAudioEntry[]>('readonly', store =>
      reqAsPromise(store.getAll()),
    );
  } catch {
    return [];
  }
}

/**
 * Total bytes currently in the cache.
 */
export async function getCacheBytes(): Promise<number> {
  const entries = await listCached();
  return entries.reduce((sum, e) => sum + (e.byteLength || 0), 0);
}

/**
 * Wipe everything. Returned promise resolves after the transaction
 * completes; failures are swallowed.
 */
export async function clearCache(): Promise<void> {
  if (!indexedDbAvailable()) return;
  try {
    await withStore<void>('readwrite', store => {
      store.clear();
    });
  } catch {
    /* ignore */
  }
}

/**
 * Drop entries whose lastUsedAt is older than `cutoffMs` ago. Returns the
 * number of entries removed.
 */
export async function purgeOlderThan(ageMs: number): Promise<number> {
  if (!indexedDbAvailable()) return 0;
  const cutoff = Date.now() - ageMs;
  const entries = await listCached();
  const stale = entries.filter(e => e.lastUsedAt < cutoff);
  if (stale.length === 0) return 0;
  try {
    await withStore<void>('readwrite', store => {
      stale.forEach(e => store.delete(e.key));
    });
  } catch {
    return 0;
  }
  return stale.length;
}

async function evictIfOverBudget(): Promise<void> {
  const entries = await listCached();
  let total = entries.reduce((sum, e) => sum + e.byteLength, 0);
  if (total <= MAX_CACHE_BYTES) return;

  // Oldest by lastUsedAt first.
  entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const toRemove: string[] = [];
  for (const e of entries) {
    if (total <= MAX_CACHE_BYTES) break;
    toRemove.push(e.key);
    total -= e.byteLength;
  }
  if (toRemove.length === 0) return;
  try {
    await withStore<void>('readwrite', store => {
      toRemove.forEach(k => store.delete(k));
    });
  } catch {
    /* ignore */
  }
}
