import { describe, expect, it } from 'vitest';
import {
  computeStreakDays,
  isMastered,
  rankWeakPhonemes,
} from '../src/dashboard/components/shadow/ipa/useIpaProgress';
import type { IpaProgress } from '../src/common/types';

describe('rankWeakPhonemes', () => {
  it('returns lowest-accuracy phonemes first', () => {
    const progress: IpaProgress = {
      'iː': { correct: 9, total: 10, lastSeen: 1 },   // 0.90
      'ɪ':  { correct: 5, total: 10, lastSeen: 1 },   // 0.50  weakest seen
      'θ':  { correct: 7, total: 10, lastSeen: 1 },   // 0.70
      'ʃ':  { correct: 8, total: 10, lastSeen: 1 },   // 0.80
    };
    expect(rankWeakPhonemes(progress, 3)).toEqual(['ɪ', 'θ', 'ʃ']);
  });

  it('ignores phonemes with fewer than 2 attempts', () => {
    const progress: IpaProgress = {
      'iː': { correct: 0, total: 1, lastSeen: 1 },    // skipped: too few
      'ɪ':  { correct: 5, total: 10, lastSeen: 1 },
      'θ':  { correct: 0, total: 2, lastSeen: 1 },    // 0.0, included
    };
    expect(rankWeakPhonemes(progress, 5)).toEqual(['θ', 'ɪ']);
  });

  it('returns an empty list when no phoneme has enough history', () => {
    const progress: IpaProgress = {
      'iː': { correct: 0, total: 1, lastSeen: 1 },
    };
    expect(rankWeakPhonemes(progress, 5)).toEqual([]);
  });

  it('caps the result length at n', () => {
    const progress: IpaProgress = {
      'iː': { correct: 1, total: 4, lastSeen: 1 },    // 0.25
      'ɪ':  { correct: 0, total: 4, lastSeen: 1 },    // 0.0
      'θ':  { correct: 2, total: 4, lastSeen: 1 },    // 0.5
      'ʃ':  { correct: 3, total: 4, lastSeen: 1 },    // 0.75
    };
    expect(rankWeakPhonemes(progress, 2)).toEqual(['ɪ', 'iː']);
  });
});

describe('isMastered', () => {
  it('returns false for missing entries', () => {
    expect(isMastered(undefined)).toBe(false);
  });

  it('requires 10+ listening attempts at >=80%', () => {
    expect(isMastered({ correct: 8, total: 10, lastSeen: 1 })).toBe(true);
    expect(isMastered({ correct: 9, total: 9, lastSeen: 1 })).toBe(false); // not enough total
    expect(isMastered({ correct: 7, total: 10, lastSeen: 1 })).toBe(false); // accuracy < 80%
  });

  it('with no production attempts, listening alone is enough', () => {
    expect(isMastered({ correct: 10, total: 10, lastSeen: 1 })).toBe(true);
  });

  it('once production has been attempted, requires 5+ at >=60%', () => {
    // listening passes, but production tried and failing
    expect(
      isMastered({
        correct: 9,
        total: 10,
        lastSeen: 1,
        productionCorrect: 1,
        productionTotal: 5,
      }),
    ).toBe(false);
    // listening passes, production passes
    expect(
      isMastered({
        correct: 9,
        total: 10,
        lastSeen: 1,
        productionCorrect: 3,
        productionTotal: 5,
      }),
    ).toBe(true);
    // production tried but not yet enough attempts
    expect(
      isMastered({
        correct: 9,
        total: 10,
        lastSeen: 1,
        productionCorrect: 2,
        productionTotal: 4,
      }),
    ).toBe(false);
  });
});

describe('computeStreakDays', () => {
  function ymd(d: Date): string {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(d: Date, n: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  const today = new Date(2026, 3, 29); // 2026-04-29 (matches the user's clock)

  it('empty list -> 0', () => {
    expect(computeStreakDays([], today)).toBe(0);
  });

  it('today only -> 1', () => {
    expect(computeStreakDays([ymd(today)], today)).toBe(1);
  });

  it('today + yesterday -> 2', () => {
    expect(computeStreakDays([ymd(today), ymd(addDays(today, -1))], today)).toBe(2);
  });

  it('yesterday only (not yet practiced today) -> 1', () => {
    expect(computeStreakDays([ymd(addDays(today, -1))], today)).toBe(1);
  });

  it('breaks on a gap', () => {
    // -1, -2, then jump to -4 (skipping -3) -> streak is 2
    const dates = [ymd(addDays(today, -1)), ymd(addDays(today, -2)), ymd(addDays(today, -4))];
    expect(computeStreakDays(dates, today)).toBe(2);
  });

  it('returns 0 when most recent practice was 2+ days ago', () => {
    expect(computeStreakDays([ymd(addDays(today, -3))], today)).toBe(0);
  });

  it('handles unsorted arrays', () => {
    const dates = [
      ymd(addDays(today, -2)),
      ymd(today),
      ymd(addDays(today, -1)),
    ];
    expect(computeStreakDays(dates, today)).toBe(3);
  });
});
