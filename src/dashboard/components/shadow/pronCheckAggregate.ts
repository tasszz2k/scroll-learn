// Pure rollup helpers for the pronunciation-check practice plan. No React,
// no chrome.* — easy to unit test.

import type { PronCheckRun } from '../../../common/types';

export interface ProblemWordTally {
  word: string;             // case-folded display key
  count: number;            // total flags across all runs
  phonemes: string[];       // unique phoneme symbols flagged with this word
  lastRunIndex: number;     // index in the runs[] array (most recent occurrence)
}

export interface ProblemPhonemeTally {
  symbol: string;
  count: number;
  lastRunIndex: number;
}

function normalizeWord(s: string): string {
  return s.trim().toLowerCase();
}

function normalizePhoneme(s: string): string {
  // Strip slashes the model might emit; match phonemes.ts symbols (without slashes).
  return s.replace(/^\/|\/$/g, '').trim();
}

export function aggregateProblemWords(runs: PronCheckRun[]): ProblemWordTally[] {
  const map = new Map<string, ProblemWordTally>();
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx];
    if (!run || !run.report || !Array.isArray(run.report.lines)) continue;
    for (const line of run.report.lines) {
      if (!Array.isArray(line.problemWords)) continue;
      for (const pw of line.problemWords) {
        const word = normalizeWord(pw.word ?? '');
        if (!word) continue;
        const phs = (Array.isArray(pw.phonemes) ? pw.phonemes : [])
          .map(normalizePhoneme)
          .filter(Boolean);
        const existing = map.get(word);
        if (existing) {
          existing.count += 1;
          existing.lastRunIndex = runIdx;
          for (const p of phs) {
            if (!existing.phonemes.includes(p)) existing.phonemes.push(p);
          }
        } else {
          map.set(word, {
            word,
            count: 1,
            phonemes: [...new Set(phs)],
            lastRunIndex: runIdx,
          });
        }
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastRunIndex - a.lastRunIndex;
  });
}

export function aggregateProblemPhonemes(runs: PronCheckRun[]): ProblemPhonemeTally[] {
  const map = new Map<string, ProblemPhonemeTally>();
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx];
    if (!run || !run.report || !Array.isArray(run.report.lines)) continue;
    for (const line of run.report.lines) {
      if (!Array.isArray(line.problemWords)) continue;
      for (const pw of line.problemWords) {
        const phs = (Array.isArray(pw.phonemes) ? pw.phonemes : [])
          .map(normalizePhoneme)
          .filter(Boolean);
        for (const sym of phs) {
          const existing = map.get(sym);
          if (existing) {
            existing.count += 1;
            existing.lastRunIndex = runIdx;
          } else {
            map.set(sym, { symbol: sym, count: 1, lastRunIndex: runIdx });
          }
        }
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastRunIndex - a.lastRunIndex;
  });
}
