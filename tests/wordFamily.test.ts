import { describe, it, expect } from 'vitest';
import { parseDatamuseFamily } from '../src/common/wordFamily';

describe('parseDatamuseFamily', () => {
  it('drops the lemma itself, multi-word phrases, and entries with only the lemma POS', () => {
    // Real-shaped fixture from `sp=paradigm*&md=p`.
    const fixture = [
      { word: 'paradigm', score: 77057, tags: ['n'] },          // lemma → drop
      { word: 'paradigms', score: 15012, tags: ['n'] },         // only lemma POS → drop
      { word: 'paradigmatic', score: 8030, tags: ['adj', 'n'] },
      { word: 'paradigm shift', score: 8026, tags: ['n'] },     // multi-word → drop
      { word: 'paradigmatical', score: 1008, tags: ['adj'] },
      { word: 'paradigmatize', score: 10, tags: ['v'] },
      { word: 'paradigmatically', score: 9, tags: ['adv'] },
    ];
    const family = parseDatamuseFamily(fixture, 'paradigm', 'noun');
    expect(family.map(f => f.word)).toEqual([
      'paradigmatic',
      'paradigmatical',
      'paradigmatize',
      'paradigmatically',
    ]);
    // For paradigmatic (tags ['adj','n']) with excludePos='noun', the picked POS is 'adjective'.
    expect(family[0]).toEqual({ word: 'paradigmatic', pos: 'adjective' });
  });

  it('maps Datamuse short tags to PartOfSpeech', () => {
    const fixture = [
      { word: 'foo', score: 100, tags: ['n'] },
      { word: 'bar', score: 90, tags: ['v'] },
      { word: 'baz', score: 80, tags: ['adj'] },
      { word: 'qux', score: 70, tags: ['adv'] },
    ];
    const family = parseDatamuseFamily(fixture, 'lemma');
    expect(family).toEqual([
      { word: 'foo', pos: 'noun' },
      { word: 'bar', pos: 'verb' },
      { word: 'baz', pos: 'adjective' },
      { word: 'qux', pos: 'adverb' },
    ]);
  });

  it('drops entries with no recognized tags', () => {
    const fixture = [
      { word: 'untagged', score: 50 },                  // no tags field
      { word: 'emptytags', score: 40, tags: [] },       // empty tags
      { word: 'propertag', score: 30, tags: ['prop'] }, // tag we don't map
      { word: 'goodword', score: 20, tags: ['adj'] },
    ];
    const family = parseDatamuseFamily(fixture, 'lemma');
    expect(family.map(f => f.word)).toEqual(['goodword']);
  });

  it('sorts by score and caps results at 8', () => {
    const fixture = Array.from({ length: 12 }, (_, i) => ({
      word: `word${String.fromCharCode(97 + i)}`, // worda, wordb, ...
      score: 100 - i,
      tags: ['n'] as string[],
    }));
    const family = parseDatamuseFamily(fixture, 'lemma');
    expect(family).toHaveLength(8);
    expect(family[0].word).toBe('worda'); // highest score first
  });

  it('dedupes by word', () => {
    const fixture = [
      { word: 'happily', score: 100, tags: ['adv'] },
      { word: 'HAPPILY', score: 90, tags: ['adv'] }, // case-folded duplicate
      { word: 'happiness', score: 80, tags: ['n'] },
    ];
    const family = parseDatamuseFamily(fixture, 'happy', 'adjective');
    expect(family.map(f => f.word)).toEqual(['happily', 'happiness']);
  });

  it('returns [] for non-array input', () => {
    expect(parseDatamuseFamily(null, 'x')).toEqual([]);
    expect(parseDatamuseFamily('garbage', 'x')).toEqual([]);
    expect(parseDatamuseFamily({}, 'x')).toEqual([]);
  });

  it('returns [] when the lemma is the only entry', () => {
    const fixture = [{ word: 'paradigm', score: 1, tags: ['n'] }];
    expect(parseDatamuseFamily(fixture, 'paradigm', 'noun')).toEqual([]);
  });
});
