import { useEffect, useRef, useState } from 'react';
import { saveBody } from '../../common/notebookStore';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseNotebookAutosaveOptions {
  // Notebook id whose body is being edited. When this changes, the previous
  // notebook's pending body flushes synchronously before the new id takes
  // effect so the user does not lose typing on a fast switch.
  notebookId: string | null;
  // Current editor body string. The hook compares against the last-saved
  // value (per notebookId) to skip no-op writes.
  body: string;
  // Default 800ms - keeps the editor responsive while batching keystrokes.
  debounceMs?: number;
  // Called every time a save completes, so the parent can refresh metadata
  // (updatedAt) or trigger a metadata save in lockstep.
  onAfterSave?: (notebookId: string) => void;
}

interface UseNotebookAutosaveApi {
  status: AutosaveStatus;
  savedAt: number | null;
  // Imperatively flush the pending debounce. Returns once the save resolves.
  flush: () => Promise<void>;
}

// Debounced body persistence to IndexedDB. Flushes:
//   1. After `debounceMs` of typing inactivity.
//   2. When the parent switches notebooks (the previous body is flushed
//      before the new id is bound).
//   3. When the page becomes hidden (visibilitychange => hidden) or the
//      window unloads (pagehide).
//   4. Imperatively via the returned `flush()` (used by Cmd/Ctrl+S).
export function useNotebookAutosave({
  notebookId,
  body,
  debounceMs = 800,
  onAfterSave,
}: UseNotebookAutosaveOptions): UseNotebookAutosaveApi {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const timerRef = useRef<number | null>(null);
  // Last successfully-saved body per notebookId. Avoids replaying writes when
  // a notebook switch hands us the same body we already persisted.
  const lastSavedRef = useRef<{ id: string | null; body: string }>({ id: null, body: '' });
  const pendingRef = useRef<{ id: string; body: string } | null>(null);
  // Tracks the most recent notebookId we've SCHEDULED a save for. When this
  // diverges from `notebookId`, the body prop is briefly stale (the parent's
  // getBody hasn't resolved yet), so we hold off scheduling until the body
  // actually corresponds to the new id.
  const lastIdRef = useRef<string | null>(null);
  const onAfterSaveRef = useRef(onAfterSave);
  useEffect(() => { onAfterSaveRef.current = onAfterSave; }, [onAfterSave]);

  async function persist(id: string, value: string) {
    setStatus('saving');
    try {
      await saveBody(id, value);
      lastSavedRef.current = { id, body: value };
      setStatus('saved');
      setSavedAt(Date.now());
      onAfterSaveRef.current?.(id);
    } catch {
      setStatus('error');
    }
  }

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  async function flushNow(): Promise<void> {
    clearTimer();
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    await persist(pending.id, pending.body);
  }

  useEffect(() => {
    if (notebookId == null) {
      lastIdRef.current = null;
      setStatus('idle');
      return;
    }
    // First effect run for a new notebookId: the body prop is whatever the
    // parent had on the previous render and may not match the new id yet.
    // Skip scheduling here -- the next render (after getBody resolves and
    // setBodyText runs) will hand us a body paired with this id.
    if (lastIdRef.current !== notebookId) {
      lastIdRef.current = notebookId;
      setStatus('idle');
      return;
    }
    // No-op when the body matches the last save for this id.
    if (lastSavedRef.current.id === notebookId && lastSavedRef.current.body === body) {
      return;
    }
    pendingRef.current = { id: notebookId, body };
    setStatus('idle');
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      void persist(pending.id, pending.body);
    }, debounceMs);
    return () => {
      clearTimer();
    };
  }, [notebookId, body, debounceMs]);

  // Notebook switch: flush previous body synchronously so a fast tree switch
  // doesn't drop the in-flight edit. We flush whenever notebookId changes by
  // comparing against the last persisted id.
  useEffect(() => {
    return () => {
      // Cleanup runs on unmount too. flushNow is async but we don't await --
      // the body is in the IDB transaction queue before unmount tears down.
      void flushNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // Page-level safety net: flush when the tab is hidden or unloads.
  useEffect(() => {
    function onHide() {
      void flushNow();
    }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
    // flushNow is stable across renders (latest closure captured via ref);
    // re-binding on every render would churn DOM listeners needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    savedAt,
    flush: flushNow,
  };
}
