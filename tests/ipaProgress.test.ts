import { describe, expect, it } from 'vitest';
import { rankWeakPhonemes } from '../src/dashboard/components/shadow/ipa/useIpaProgress';
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
