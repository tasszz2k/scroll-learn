import { describe, it, expect } from 'vitest';
import {
  aggregateProblemPhonemes,
  aggregateProblemWords,
} from '../src/dashboard/components/shadow/pronCheckAggregate';
import type {
  PronCheckConfidence,
  PronCheckIssueType,
  PronCheckRun,
} from '../src/common/types';

function makeRun(
  id: string,
  problems: Array<{
    word: string;
    phonemes: string[];
    confidence?: PronCheckConfidence;
    issueType?: PronCheckIssueType;
  }>,
): PronCheckRun {
  return {
    id,
    createdAt: 0,
    durationSec: 0,
    report: {
      scores: { pronunciation: 0, naturalness: 0, fluency: 0 },
      summary: '',
      lines: [
        {
          idx: 0,
          said: '',
          tip: '',
          problemWords: problems.map(p => ({
            word: p.word,
            phonemes: p.phonemes,
            ...(p.confidence ? { confidence: p.confidence } : {}),
            ...(p.issueType ? { issueType: p.issueType } : {}),
          })),
        },
      ],
    },
  };
}

describe('aggregateProblemWords', () => {
  it('returns [] when there are no runs', () => {
    expect(aggregateProblemWords([])).toEqual([]);
  });

  it('case-folds and merges duplicates across runs', () => {
    const runs = [
      makeRun('r1', [{ word: 'Thought', phonemes: ['θ'] }]),
      makeRun('r2', [{ word: 'thought', phonemes: ['θ'] }]),
      makeRun('r3', [{ word: 'THOUGHT', phonemes: ['θ'] }]),
    ];
    const out = aggregateProblemWords(runs);
    expect(out).toHaveLength(1);
    expect(out[0].word).toBe('thought');
    expect(out[0].count).toBe(3);
    expect(out[0].phonemes).toEqual(['θ']);
  });

  it('strips slashes from phoneme symbols', () => {
    const runs = [
      makeRun('r1', [{ word: 'this', phonemes: ['/ð/'] }]),
    ];
    const out = aggregateProblemWords(runs);
    expect(out[0].phonemes).toEqual(['ð']);
  });

  it('sorts by count desc, ties broken by recency (most recent run first)', () => {
    const runs = [
      makeRun('r1', [{ word: 'alpha', phonemes: [] }, { word: 'beta', phonemes: [] }]),
      makeRun('r2', [{ word: 'alpha', phonemes: [] }]),
      makeRun('r3', [{ word: 'gamma', phonemes: [] }]),
    ];
    const out = aggregateProblemWords(runs);
    // alpha:2, beta:1 (lastRun=0), gamma:1 (lastRun=2)
    expect(out.map(t => t.word)).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('skips empty word entries', () => {
    const runs = [
      makeRun('r1', [{ word: '', phonemes: ['θ'] }, { word: 'word', phonemes: ['w'] }]),
    ];
    const out = aggregateProblemWords(runs);
    expect(out.map(t => t.word)).toEqual(['word']);
  });

  it('collects unique phonemes when same word is flagged with different sounds', () => {
    const runs = [
      makeRun('r1', [{ word: 'birthday', phonemes: ['θ'] }]),
      makeRun('r2', [{ word: 'birthday', phonemes: ['ɜː'] }]),
      makeRun('r3', [{ word: 'birthday', phonemes: ['θ'] }]),
    ];
    const out = aggregateProblemWords(runs);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    expect([...out[0].phonemes].sort()).toEqual(['ɜː', 'θ'].sort());
  });

  it('excludes low-confidence (uncertain ASR mismatch) entries from the practice plan', () => {
    const runs = [
      makeRun('r1', [
        { word: 'thought', phonemes: ['θ'], confidence: 'high', issueType: 'pronunciation' },
        { word: 'helm', phonemes: [], confidence: 'low', issueType: 'uncertain_asr_mismatch' },
        { word: 'devx', phonemes: [], confidence: 'low', issueType: 'uncertain_asr_mismatch' },
      ]),
    ];
    const out = aggregateProblemWords(runs);
    expect(out.map(t => t.word)).toEqual(['thought']);
  });

  it('treats missing confidence/issueType as high-confidence (back-compat)', () => {
    const runs = [
      makeRun('r1', [{ word: 'thought', phonemes: ['θ'] }]), // legacy entry, no fields
    ];
    const out = aggregateProblemWords(runs);
    expect(out).toHaveLength(1);
    expect(out[0].word).toBe('thought');
  });
});

describe('aggregateProblemPhonemes', () => {
  it('counts each occurrence of each phoneme across runs', () => {
    const runs = [
      makeRun('r1', [{ word: 'thought', phonemes: ['θ'] }]),
      makeRun('r2', [{ word: 'this', phonemes: ['ð'] }, { word: 'three', phonemes: ['θ'] }]),
    ];
    const out = aggregateProblemPhonemes(runs);
    const tally = Object.fromEntries(out.map(t => [t.symbol, t.count]));
    expect(tally).toEqual({ θ: 2, ð: 1 });
  });

  it('sorts by count desc, ties broken by recency', () => {
    const runs = [
      makeRun('r1', [{ word: 'a', phonemes: ['x'] }]),
      makeRun('r2', [{ word: 'b', phonemes: ['y'] }]),
    ];
    const out = aggregateProblemPhonemes(runs);
    // both count=1; lastRunIndex y=1 > x=0
    expect(out.map(t => t.symbol)).toEqual(['y', 'x']);
  });

  it('excludes low-confidence entries from the phoneme tally', () => {
    const runs = [
      makeRun('r1', [
        { word: 'thought', phonemes: ['θ'], confidence: 'high' },
        { word: 'helm', phonemes: ['h'], confidence: 'low', issueType: 'uncertain_asr_mismatch' },
      ]),
    ];
    const out = aggregateProblemPhonemes(runs);
    expect(out.map(t => t.symbol)).toEqual(['θ']);
  });

  it('returns [] for runs with no problemWords', () => {
    const runs: PronCheckRun[] = [
      {
        id: 'r1',
        createdAt: 0,
        durationSec: 0,
        report: { scores: { pronunciation: 0, naturalness: 0, fluency: 0 }, summary: '', lines: [] },
      },
    ];
    expect(aggregateProblemPhonemes(runs)).toEqual([]);
  });
});
