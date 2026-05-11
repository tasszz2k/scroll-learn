import { describe, it, expect } from 'vitest';

// matchedKeyword will be exported from blocker.ts in Task 3.
// Import it here; the test will fail until Task 3 implements it.
import { matchedKeyword } from '../src/content/blocker';

describe('matchedKeyword', () => {
  it('returns null when keyword list is empty', () => {
    expect(matchedKeyword('Iran war started today', [])).toBeNull();
  });

  it('returns null when no keyword matches', () => {
    expect(matchedKeyword('friendly post about cats', ['iran war', 'crypto'])).toBeNull();
  });

  it('matches a single-word keyword case-insensitively', () => {
    expect(matchedKeyword('Crypto is rising', ['crypto'])).toBe('crypto');
  });

  it('does NOT match a substring inside a longer word', () => {
    // "iran" should not match "Iranian"
    expect(matchedKeyword('The Iranian president spoke', ['iran'])).toBeNull();
  });

  it('matches a whole word at the start of text', () => {
    expect(matchedKeyword('bitcoin hits all-time high', ['bitcoin'])).toBe('bitcoin');
  });

  it('matches a whole word surrounded by punctuation', () => {
    expect(matchedKeyword('Today, war, and peace.', ['war'])).toBe('war');
  });

  it('matches a multi-word phrase whole-word on outer edges', () => {
    expect(matchedKeyword('Breaking: Iran war escalates', ['iran war'])).toBe('iran war');
  });

  it('does NOT match a multi-word phrase inside a longer word boundary', () => {
    expect(matchedKeyword('No keywords here at all', ['iran war'])).toBeNull();
  });

  it('returns the first matching keyword when multiple could match', () => {
    const result = matchedKeyword('bitcoin and crypto news', ['crypto', 'bitcoin']);
    // first keyword in list wins
    expect(result).toBe('crypto');
  });

  it('escapes regex special characters in keywords', () => {
    // "$money" has a special regex char
    expect(matchedKeyword('I love $money talks', ['$money'])).toBe('$money');
  });

  it('handles keyword with mixed case stored form', () => {
    expect(matchedKeyword('Iran War 2024', ['Iran War'])).toBe('Iran War');
  });
});
