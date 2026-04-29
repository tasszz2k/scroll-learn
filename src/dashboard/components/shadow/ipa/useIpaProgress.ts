import { useCallback, useEffect, useRef, useState } from 'react';
import type { IpaProgress, IpaProgressEntry } from '../../../../common/types';
import { STORAGE_KEYS } from '../../../../common/types';

interface UseIpaProgressApi {
  progress: IpaProgress;
  totalAnswers: number;
  recordAnswer: (phoneme: string, correct: boolean) => void;
  getWeakPhonemes: (n: number) => string[];
  // Pick a phoneme weighted toward the learner's weakest (lowest accuracy
  // and/or least-seen) symbols. Falls back to uniform when no history exists.
  pickWeightedPhoneme: (candidates: string[]) => string | null;
  resetProgress: () => void;
}

const FLUSH_DEBOUNCE_MS = 300;

function entryAccuracy(entry: IpaProgressEntry | undefined): number {
  if (!entry || entry.total === 0) return 0;
  return entry.correct / entry.total;
}

// Lower score = weaker. Used for ordering and weighted random.
function weaknessScore(entry: IpaProgressEntry | undefined): number {
  if (!entry || entry.total === 0) return 0; // never seen -> max weakness
  return entryAccuracy(entry);
}

export function useIpaProgress(): UseIpaProgressApi {
  const [progress, setProgress] = useState<IpaProgress>({});
  // Mirror the latest progress in a ref so recordAnswer updates can compose
  // without going through a setState round-trip on every keypress.
  const progressRef = useRef<IpaProgress>({});
  const flushTimerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  // Load initial progress and subscribe to chrome.storage.onChanged so a
  // second tab stays in sync with the active one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'get_ipa_progress' });
        if (cancelled) return;
        const data: IpaProgress = res?.ok ? (res.data ?? {}) : {};
        progressRef.current = data;
        setProgress(data);
      } catch {
        /* ignore */
      }
    })();

    function onChanged(
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) {
      if (area !== 'local') return;
      if (!(STORAGE_KEYS.IPA_PROGRESS in changes)) return;
      const next = (changes[STORAGE_KEYS.IPA_PROGRESS].newValue as IpaProgress | undefined) ?? {};
      progressRef.current = next;
      setProgress(next);
    }
    chrome.storage.onChanged.addListener(onChanged);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      // Flush any pending writes on unmount.
      if (dirtyRef.current) {
        const snapshot = progressRef.current;
        void chrome.runtime.sendMessage({ type: 'set_ipa_progress', progress: snapshot });
        dirtyRef.current = false;
      }
    };
  }, []);

  function scheduleFlush() {
    dirtyRef.current = true;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      const snapshot = progressRef.current;
      void chrome.runtime.sendMessage({ type: 'set_ipa_progress', progress: snapshot });
    }, FLUSH_DEBOUNCE_MS);
  }

  const recordAnswer = useCallback((phoneme: string, correct: boolean) => {
    const prev = progressRef.current[phoneme];
    const next: IpaProgressEntry = {
      correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
      total: (prev?.total ?? 0) + 1,
      lastSeen: Date.now(),
    };
    const updated: IpaProgress = { ...progressRef.current, [phoneme]: next };
    progressRef.current = updated;
    setProgress(updated);
    scheduleFlush();
  }, []);

  const getWeakPhonemes = useCallback(
    (n: number): string[] => {
      const entries = Object.entries(progressRef.current);
      // Only consider phonemes the learner has actually attempted -- weakness
      // for never-seen sounds is meaningless before they've been drilled.
      const seen = entries.filter(([, e]) => e.total >= 2);
      if (seen.length === 0) return [];
      seen.sort((a, b) => weaknessScore(a[1]) - weaknessScore(b[1]));
      return seen.slice(0, Math.max(0, n)).map(([sym]) => sym);
    },
    [],
  );

  const pickWeightedPhoneme = useCallback(
    (candidates: string[]): string | null => {
      if (candidates.length === 0) return null;
      // Weight = (1 - accuracy) + 0.1 baseline so well-known sounds still
      // appear occasionally. Never-seen sounds get the maximum weight.
      const weights = candidates.map(sym => {
        const e = progressRef.current[sym];
        if (!e || e.total === 0) return 1.1;
        return 1.1 - entryAccuracy(e);
      });
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return candidates[Math.floor(Math.random() * candidates.length)];
      let r = Math.random() * total;
      for (let i = 0; i < candidates.length; i++) {
        r -= weights[i];
        if (r <= 0) return candidates[i];
      }
      return candidates[candidates.length - 1];
    },
    [],
  );

  const resetProgress = useCallback(() => {
    progressRef.current = {};
    setProgress({});
    dirtyRef.current = true;
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    void chrome.runtime.sendMessage({ type: 'set_ipa_progress', progress: {} });
    dirtyRef.current = false;
  }, []);

  const totalAnswers = Object.values(progress).reduce((sum, e) => sum + e.total, 0);

  return { progress, totalAnswers, recordAnswer, getWeakPhonemes, pickWeightedPhoneme, resetProgress };
}

// Pure ranker exported separately so tests can exercise it without React.
export function rankWeakPhonemes(progress: IpaProgress, n: number): string[] {
  const entries = Object.entries(progress).filter(([, e]) => e.total >= 2);
  entries.sort((a, b) => weaknessScore(a[1]) - weaknessScore(b[1]));
  return entries.slice(0, Math.max(0, n)).map(([sym]) => sym);
}
