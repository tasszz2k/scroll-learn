import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IpaProgress, IpaProgressEntry, IpaStudyStats } from '../../../../common/types';
import { STORAGE_KEYS } from '../../../../common/types';
import { PHONEMES } from './phonemes';

interface MasteryCounts {
  count: number;
  total: number;
}

interface UseIpaProgressApi {
  progress: IpaProgress;
  totalAnswers: number;
  recordAnswer: (phoneme: string, correct: boolean) => void;
  recordProduction: (phoneme: string, correct: boolean) => void;
  recordPracticeToday: () => void;
  getWeakPhonemes: (n: number) => string[];
  // Pick a phoneme weighted toward the learner's weakest (lowest accuracy
  // and/or least-seen) symbols. Falls back to uniform when no history exists.
  pickWeightedPhoneme: (candidates: string[]) => string | null;
  resetProgress: () => void;
  streakDays: number;
  mastered: MasteryCounts;
  todayAttempts: number;
  isMastered: (symbol: string) => boolean;
}

const FLUSH_DEBOUNCE_MS = 300;
const MAX_PRACTICE_DATES = 365;

function entryAccuracy(entry: IpaProgressEntry | undefined): number {
  if (!entry || entry.total === 0) return 0;
  return entry.correct / entry.total;
}

// Lower score = weaker. Used for ordering and weighted random.
function weaknessScore(entry: IpaProgressEntry | undefined): number {
  if (!entry || entry.total === 0) return 0; // never seen -> max weakness
  return entryAccuracy(entry);
}

// Mastery rule: at least 10 listening attempts at >=80% accuracy. Production
// is opt-in -- if the learner has tried the Speak tab even once, we additionally
// require 5 production attempts at >=60% before flipping the badge.
export function isMastered(entry: IpaProgressEntry | undefined): boolean {
  if (!entry) return false;
  const listenOk = entry.total >= 10 && (entry.correct / entry.total) >= 0.8;
  if (!listenOk) return false;
  const prodTotal = entry.productionTotal ?? 0;
  if (prodTotal === 0) return true;
  const prodCorrect = entry.productionCorrect ?? 0;
  return prodTotal >= 5 && (prodCorrect / prodTotal) >= 0.6;
}

function localDateKey(d: Date): string {
  // Use local-clock ISO date so the streak follows the learner's wall clock,
  // not UTC. toISOString() would shift the date for late-evening practice in
  // negative timezones.
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// Pure helper exported for tests. Consecutive days ending at "today or
// yesterday" -- a learner who practiced yesterday but hasn't opened the app
// yet today still has their streak intact.
export function computeStreakDays(dates: string[], today: Date): number {
  if (!dates || dates.length === 0) return 0;
  const set = new Set(dates);
  const todayKey = localDateKey(today);
  const yesterdayKey = localDateKey(addDays(today, -1));
  let cursor: Date;
  if (set.has(todayKey)) {
    cursor = today;
  } else if (set.has(yesterdayKey)) {
    cursor = addDays(today, -1);
  } else {
    return 0;
  }
  let count = 0;
  while (set.has(localDateKey(cursor))) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

function startOfTodayMs(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function useIpaProgress(): UseIpaProgressApi {
  const [progress, setProgress] = useState<IpaProgress>({});
  const [stats, setStats] = useState<IpaStudyStats>({ practiceDates: [] });
  // Mirror the latest progress in a ref so recordAnswer updates can compose
  // without going through a setState round-trip on every keypress.
  const progressRef = useRef<IpaProgress>({});
  const statsRef = useRef<IpaStudyStats>({ practiceDates: [] });
  const flushTimerRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const statsFlushTimerRef = useRef<number | null>(null);
  const statsDirtyRef = useRef(false);

  // Load initial progress and subscribe to chrome.storage.onChanged so a
  // second tab stays in sync with the active one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [progRes, statsRes] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'get_ipa_progress' }),
          chrome.runtime.sendMessage({ type: 'get_ipa_stats' }),
        ]);
        if (cancelled) return;
        const p: IpaProgress = progRes?.ok ? (progRes.data ?? {}) : {};
        const s: IpaStudyStats = statsRes?.ok ? (statsRes.data ?? { practiceDates: [] }) : { practiceDates: [] };
        progressRef.current = p;
        statsRef.current = s;
        setProgress(p);
        setStats(s);
      } catch {
        /* ignore */
      }
    })();

    function onChanged(
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) {
      if (area !== 'local') return;
      if (STORAGE_KEYS.IPA_PROGRESS in changes) {
        const next = (changes[STORAGE_KEYS.IPA_PROGRESS].newValue as IpaProgress | undefined) ?? {};
        progressRef.current = next;
        setProgress(next);
      }
      if (STORAGE_KEYS.IPA_STATS in changes) {
        const next = (changes[STORAGE_KEYS.IPA_STATS].newValue as IpaStudyStats | undefined) ?? { practiceDates: [] };
        statsRef.current = next;
        setStats(next);
      }
    }
    chrome.storage.onChanged.addListener(onChanged);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      if (statsFlushTimerRef.current !== null) {
        window.clearTimeout(statsFlushTimerRef.current);
      }
      // Flush any pending writes on unmount.
      if (dirtyRef.current) {
        const snapshot = progressRef.current;
        void chrome.runtime.sendMessage({ type: 'set_ipa_progress', progress: snapshot });
        dirtyRef.current = false;
      }
      if (statsDirtyRef.current) {
        const snapshot = statsRef.current;
        void chrome.runtime.sendMessage({ type: 'set_ipa_stats', stats: snapshot });
        statsDirtyRef.current = false;
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

  function scheduleStatsFlush() {
    statsDirtyRef.current = true;
    if (statsFlushTimerRef.current !== null) {
      window.clearTimeout(statsFlushTimerRef.current);
    }
    statsFlushTimerRef.current = window.setTimeout(() => {
      statsFlushTimerRef.current = null;
      if (!statsDirtyRef.current) return;
      statsDirtyRef.current = false;
      const snapshot = statsRef.current;
      void chrome.runtime.sendMessage({ type: 'set_ipa_stats', stats: snapshot });
    }, FLUSH_DEBOUNCE_MS);
  }

  const recordAnswer = useCallback((phoneme: string, correct: boolean) => {
    const prev = progressRef.current[phoneme];
    const now = Date.now();
    const merged: IpaProgressEntry = {
      ...(prev ?? { correct: 0, total: 0, lastSeen: 0 }),
      correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
      total: (prev?.total ?? 0) + 1,
      lastSeen: now,
      firstSeen: prev?.firstSeen ?? now,
    };
    if (!prev?.masteredAt && isMastered(merged)) {
      merged.masteredAt = now;
    }
    const updated: IpaProgress = { ...progressRef.current, [phoneme]: merged };
    progressRef.current = updated;
    setProgress(updated);
    scheduleFlush();
  }, []);

  const recordProduction = useCallback((phoneme: string, correct: boolean) => {
    const prev = progressRef.current[phoneme];
    const now = Date.now();
    const merged: IpaProgressEntry = {
      ...(prev ?? { correct: 0, total: 0, lastSeen: 0 }),
      productionCorrect: (prev?.productionCorrect ?? 0) + (correct ? 1 : 0),
      productionTotal: (prev?.productionTotal ?? 0) + 1,
      lastSeen: now,
      firstSeen: prev?.firstSeen ?? now,
    };
    if (!prev?.masteredAt && isMastered(merged)) {
      merged.masteredAt = now;
    }
    const updated: IpaProgress = { ...progressRef.current, [phoneme]: merged };
    progressRef.current = updated;
    setProgress(updated);
    scheduleFlush();
  }, []);

  const recordPracticeToday = useCallback(() => {
    const todayKey = localDateKey(new Date());
    const existing = statsRef.current.practiceDates;
    if (existing.includes(todayKey)) return;
    const next = [...existing, todayKey].slice(-MAX_PRACTICE_DATES);
    const merged: IpaStudyStats = { practiceDates: next };
    statsRef.current = merged;
    setStats(merged);
    scheduleStatsFlush();
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
    statsRef.current = { practiceDates: [] };
    setProgress({});
    setStats({ practiceDates: [] });
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (statsFlushTimerRef.current !== null) {
      window.clearTimeout(statsFlushTimerRef.current);
      statsFlushTimerRef.current = null;
    }
    dirtyRef.current = false;
    statsDirtyRef.current = false;
    void chrome.runtime.sendMessage({ type: 'set_ipa_progress', progress: {} });
    void chrome.runtime.sendMessage({ type: 'set_ipa_stats', stats: { practiceDates: [] } });
  }, []);

  const totalAnswers = Object.values(progress).reduce((sum, e) => sum + e.total, 0);

  const mastered: MasteryCounts = useMemo(() => {
    let count = 0;
    for (const p of PHONEMES) {
      if (isMastered(progress[p.symbol])) count++;
    }
    return { count, total: PHONEMES.length };
  }, [progress]);

  const streakDays = useMemo(
    () => computeStreakDays(stats.practiceDates, new Date()),
    [stats.practiceDates],
  );

  // Number of distinct phonemes touched today. We don't store per-day
  // counters, so per-phoneme totals (all-time) can't be summed safely; the
  // distinct count is honest and still surfaces "I did some practice today"
  // in the header.
  const todayAttempts = useMemo(() => {
    const cutoff = startOfTodayMs(new Date());
    let count = 0;
    for (const e of Object.values(progress)) {
      if ((e.lastSeen ?? 0) >= cutoff) count++;
    }
    return count;
  }, [progress]);

  const isMasteredCb = useCallback(
    (symbol: string) => isMastered(progressRef.current[symbol]),
    [],
  );

  return {
    progress,
    totalAnswers,
    recordAnswer,
    recordProduction,
    recordPracticeToday,
    getWeakPhonemes,
    pickWeightedPhoneme,
    resetProgress,
    streakDays,
    mastered,
    todayAttempts,
    isMastered: isMasteredCb,
  };
}

// Pure ranker exported separately so tests can exercise it without React.
export function rankWeakPhonemes(progress: IpaProgress, n: number): string[] {
  const entries = Object.entries(progress).filter(([, e]) => e.total >= 2);
  entries.sort((a, b) => weaknessScore(a[1]) - weaknessScore(b[1]));
  return entries.slice(0, Math.max(0, n)).map(([sym]) => sym);
}
