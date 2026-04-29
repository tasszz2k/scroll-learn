// Tests for the karaoke boundary helpers in src/common/tts/playback.ts.
//
// playAudioBlob itself drives an HTMLAudioElement through a requestAnimationFrame
// loop, but the per-frame logic that maps audio.currentTime through alignment
// data into a word-range index is factored out into pure helpers
// (computeWordRanges and findActiveBoundary). Testing those directly avoids
// having to mock the DOM Audio surface, while still pinning the contract the
// rAF loop relies on: cursor advances monotonically, the active word index
// only changes when the spoken char crosses into a new word, and punctuation
// chars that fall outside any word range never produce a spurious boundary.

import { describe, expect, it } from 'vitest';
import {
  computeWordRanges,
  findActiveBoundary,
  type WordRange,
} from '../src/common/tts/playback';

describe('computeWordRanges', () => {
  it('returns one range per whitespace-separated token', () => {
    expect(computeWordRanges('Hello world')).toEqual([
      { start: 0, length: 5 },
      { start: 6, length: 5 },
    ]);
  });

  it('keeps trailing punctuation attached to its word', () => {
    // "Hi, there!" -> "Hi," and "there!" so the highlight covers the comma /
    // exclamation point along with the word, matching what Web Speech emits.
    expect(computeWordRanges('Hi, there!')).toEqual([
      { start: 0, length: 3 },
      { start: 4, length: 6 },
    ]);
  });

  it('handles multiple consecutive spaces and tabs', () => {
    expect(computeWordRanges('a  b\tc')).toEqual([
      { start: 0, length: 1 },
      { start: 3, length: 1 },
      { start: 5, length: 1 },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(computeWordRanges('')).toEqual([]);
  });

  it('returns [] for whitespace-only input', () => {
    expect(computeWordRanges('   \t\n ')).toEqual([]);
  });
});

describe('findActiveBoundary', () => {
  // Test fixture: "Hi, there!" with alignment that puts the comma and
  // exclamation point at later times than the word chars before them. The
  // word ranges are { 0..2: "Hi," } and { 4..9: "there!" }; index 3 is the
  // intervening space, which falls outside both ranges.
  const text = 'Hi, there!';
  const words: WordRange[] = computeWordRanges(text);
  const charStartTimes = [
    0.00, // H
    0.10, // i
    0.20, // ,
    0.25, // (space)
    0.30, // t
    0.40, // h
    0.50, // e
    0.60, // r
    0.70, // e
    0.80, // !
  ];

  it('returns -1 for empty text or empty alignment', () => {
    expect(findActiveBoundary(0.5, [], words, 0).wordIndex).toBe(-1);
    expect(findActiveBoundary(0.5, charStartTimes, [], 0).wordIndex).toBe(-1);
  });

  it('reports the first word once currentTime crosses into its first char', () => {
    const r = findActiveBoundary(0.05, charStartTimes, words, 0);
    expect(r.wordIndex).toBe(0);
    expect(r.cursor).toBe(1);
  });

  it('keeps the same word active while currentTime stays inside it', () => {
    // Frame at 0.12s -- still inside "Hi,". The cursor advanced past two
    // chars but the active word index is unchanged, which the rAF loop uses
    // to decide whether to fire onBoundary.
    const r = findActiveBoundary(0.12, charStartTimes, words, 0);
    expect(r.wordIndex).toBe(0);
    expect(r.cursor).toBe(2);
  });

  it('switches to the next word when currentTime crosses the gap', () => {
    // 0.32s lands on "t" of "there!", which is the start of the second word.
    const r = findActiveBoundary(0.32, charStartTimes, words, 2);
    expect(r.wordIndex).toBe(1);
  });

  it('does not emit a separate boundary for trailing punctuation', () => {
    // Simulate the rAF loop ticking forward through "there!" frame by frame.
    // The exclamation point is part of the same word range, so the loop must
    // never observe a different wordIndex once it lands on word 1.
    let cursor = 4; // start at "t"
    const seen: number[] = [];
    let last = -1;
    const frames = [0.32, 0.41, 0.51, 0.61, 0.71, 0.81];
    for (const t of frames) {
      const r = findActiveBoundary(t, charStartTimes, words, cursor);
      cursor = r.cursor;
      if (r.wordIndex !== -1 && r.wordIndex !== last) {
        last = r.wordIndex;
        seen.push(r.wordIndex);
      }
    }
    expect(seen).toEqual([1]); // word 1 fired exactly once across all frames
  });

  it('clamps to the last char so the final word stays highlighted past audio end', () => {
    // currentTime 5.0 is well past the last char's start time. The cursor
    // advances to length, charIndex clamps to length-1 (the "!"), which
    // still resolves to word 1 ("there!").
    const r = findActiveBoundary(5.0, charStartTimes, words, 0);
    expect(r.cursor).toBe(charStartTimes.length);
    expect(r.wordIndex).toBe(1);
  });

  it('reports -1 while the cursor sits on a whitespace char between words', () => {
    // Frame at 0.27s -- past the comma, on the space (index 3). The space is
    // outside any word range so the helper returns -1, which the rAF loop
    // interprets as "do not fire onBoundary this frame".
    const r = findActiveBoundary(0.27, charStartTimes, words, 0);
    expect(r.wordIndex).toBe(-1);
  });

  it('boundary emission across a full pass fires once per word', () => {
    // Walk a frame schedule through the entire utterance and confirm
    // onBoundary would only fire for word 0 then word 1.
    const frames = [0.0, 0.05, 0.12, 0.21, 0.27, 0.32, 0.45, 0.65, 0.85, 1.0];
    let cursor = 0;
    let last = -1;
    const fired: Array<{ start: number; length: number }> = [];
    for (const t of frames) {
      const r = findActiveBoundary(t, charStartTimes, words, cursor);
      cursor = r.cursor;
      if (r.wordIndex !== -1 && r.wordIndex !== last) {
        last = r.wordIndex;
        const w = words[r.wordIndex];
        fired.push({ start: w.start, length: w.length });
      }
    }
    expect(fired).toEqual([
      { start: 0, length: 3 }, // "Hi,"
      { start: 4, length: 6 }, // "there!"
    ]);
  });
});
