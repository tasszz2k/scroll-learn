import { describe, it, expect } from 'vitest';
import { isSingleWord, parseDictionarySenses } from '../src/common/translate';

describe('isSingleWord', () => {
  it('treats a bare word as single', () => {
    expect(isSingleWord('run')).toBe(true);
    expect(isSingleWord('happy')).toBe(true);
  });

  it('rejects multi-word strings', () => {
    expect(isSingleWord('run away')).toBe(false);
    expect(isSingleWord('happy days')).toBe(false);
  });

  it('strips surrounding punctuation/whitespace', () => {
    expect(isSingleWord(' "happy", ')).toBe(true);
    expect(isSingleWord('"run"')).toBe(true);
  });

  it('rejects empty / whitespace-only input', () => {
    expect(isSingleWord('')).toBe(false);
    expect(isSingleWord('   ')).toBe(false);
  });

  it('treats a single Vietnamese word as single', () => {
    expect(isSingleWord('vui')).toBe(true);
    expect(isSingleWord('hạnh phúc')).toBe(false);
  });
});

describe('parseDictionarySenses', () => {
  it('extracts POS-grouped translations from a gtx-shaped fixture', () => {
    // Mimic the shape returned by translate.googleapis.com when dt=t&dt=bd is requested.
    const fixture = [
      // dt=t block
      [['Run', 'run', null, null, 1]],
      // dt=bd block (the dictionary)
      [
        ['noun', ['cuộc chạy', 'sự chạy'], [], 'run', 1],
        ['verb', ['chạy', 'điều hành'], [], 'run', 1],
      ],
      'en',
    ];

    const senses = parseDictionarySenses(fixture);
    expect(senses.map(s => s.pos)).toEqual(['noun', 'verb']);
    expect(senses[0].terms).toEqual(['cuộc chạy', 'sự chạy']);
    expect(senses[1].terms).toEqual(['chạy', 'điều hành']);
    expect(senses[0].posLabel).toBe('noun');
  });

  it('maps Vietnamese pos labels to canonical PartOfSpeech', () => {
    const fixture = [
      [['Vui', 'vui']],
      [
        ['tính từ', ['happy', 'glad'], [], 'vui'],
      ],
    ];
    const senses = parseDictionarySenses(fixture);
    expect(senses).toHaveLength(1);
    expect(senses[0].pos).toBe('adjective');
    expect(senses[0].terms).toEqual(['happy', 'glad']);
  });

  it('returns an empty array when there is no bd block', () => {
    const fixture = [[['Hello', 'hello']]];
    expect(parseDictionarySenses(fixture)).toEqual([]);
  });

  it('returns empty for unexpected shapes without throwing', () => {
    expect(parseDictionarySenses(null)).toEqual([]);
    expect(parseDictionarySenses({})).toEqual([]);
    expect(parseDictionarySenses('garbage')).toEqual([]);
  });

  it('caps terms per sense at 5', () => {
    const fixture = [
      [['x']],
      [
        ['noun', ['a', 'b', 'c', 'd', 'e', 'f', 'g'], [], 'x'],
      ],
    ];
    const senses = parseDictionarySenses(fixture);
    expect(senses[0].terms).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
