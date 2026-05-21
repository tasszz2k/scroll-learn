import { describe, it, expect } from 'vitest';

import {
  entryMatchesUrl,
  isUrlIgnored,
  normalizeIgnoreEntry,
  validateIgnoreEntry,
} from '../src/common/urlIgnore';

describe('entryMatchesUrl', () => {
  it('returns false on empty entries', () => {
    expect(entryMatchesUrl('', 'facebook.com', '/messages')).toBe(false);
    expect(entryMatchesUrl('   ', 'facebook.com', '/messages')).toBe(false);
  });

  it('matches host-only entries exactly', () => {
    expect(entryMatchesUrl('facebook.com', 'facebook.com', '/feed')).toBe(true);
    expect(entryMatchesUrl('facebook.com', 'www.facebook.com', '/feed')).toBe(true);
    expect(entryMatchesUrl('facebook.com', 'm.facebook.com', '/messages')).toBe(true);
    expect(entryMatchesUrl('facebook.com', 'reddit.com', '/r/all')).toBe(false);
  });

  it('does not let a host-only entry match a different domain', () => {
    expect(entryMatchesUrl('facebook.com', 'subdomain.facebook.com', '/')).toBe(false);
  });

  it('matches a host + path prefix', () => {
    expect(entryMatchesUrl('facebook.com/messages', 'facebook.com', '/messages')).toBe(true);
    expect(entryMatchesUrl('facebook.com/messages', 'facebook.com', '/messages/')).toBe(true);
    expect(entryMatchesUrl('facebook.com/messages', 'facebook.com', '/messages/t/123')).toBe(true);
    expect(entryMatchesUrl('facebook.com/messages', 'www.facebook.com', '/messages/t/123')).toBe(true);
  });

  it('does not match a different path prefix', () => {
    expect(entryMatchesUrl('facebook.com/messages', 'facebook.com', '/feed')).toBe(false);
    expect(entryMatchesUrl('facebook.com/messages', 'facebook.com', '/messengers')).toBe(false);
  });

  it('strips a scheme prefix on entries', () => {
    expect(entryMatchesUrl('https://facebook.com/messages', 'facebook.com', '/messages')).toBe(true);
  });

  it('honors regex literal entries against host+path', () => {
    expect(
      entryMatchesUrl('/facebook\\.com\\/(messages|marketplace)/', 'facebook.com', '/marketplace/123'),
    ).toBe(true);
    expect(
      entryMatchesUrl('/facebook\\.com\\/(messages|marketplace)/', 'facebook.com', '/feed'),
    ).toBe(false);
  });

  it('returns false on invalid regex literal', () => {
    expect(entryMatchesUrl('/[/', 'facebook.com', '/messages')).toBe(false);
  });
});

describe('isUrlIgnored', () => {
  it('returns false when the list is empty', () => {
    expect(isUrlIgnored([], 'facebook.com', '/feed')).toBe(false);
  });

  it('returns true if any entry matches', () => {
    const list = ['instagram.com', 'facebook.com/messages'];
    expect(isUrlIgnored(list, 'facebook.com', '/messages/t/1')).toBe(true);
    expect(isUrlIgnored(list, 'instagram.com', '/explore')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    const list = ['facebook.com/messages'];
    expect(isUrlIgnored(list, 'facebook.com', '/feed')).toBe(false);
    expect(isUrlIgnored(list, 'youtube.com', '/watch?v=abc')).toBe(false);
  });
});

describe('validateIgnoreEntry', () => {
  it('flags empty input', () => {
    expect(validateIgnoreEntry('')).toBe('empty');
    expect(validateIgnoreEntry('  ')).toBe('empty');
  });

  it('accepts plain hosts and host+path entries', () => {
    expect(validateIgnoreEntry('facebook.com')).toBeNull();
    expect(validateIgnoreEntry('facebook.com/messages')).toBeNull();
  });

  it('accepts a valid regex literal', () => {
    expect(validateIgnoreEntry('/facebook\\.com\\/messages/i')).toBeNull();
  });

  it('rejects an invalid regex literal', () => {
    expect(validateIgnoreEntry('/[/')).toBe('invalid-regex');
  });
});

describe('normalizeIgnoreEntry', () => {
  it('lowercases the host portion and trims whitespace', () => {
    expect(normalizeIgnoreEntry(' Facebook.COM ')).toBe('facebook.com');
    expect(normalizeIgnoreEntry('FACEBOOK.COM/Messages')).toBe('facebook.com/Messages');
  });

  it('strips schemes and www / m prefixes from the host', () => {
    expect(normalizeIgnoreEntry('https://www.facebook.com/messages')).toBe('facebook.com/messages');
    expect(normalizeIgnoreEntry('http://m.facebook.com')).toBe('facebook.com');
  });

  it('leaves regex literals untouched', () => {
    expect(normalizeIgnoreEntry('/Facebook\\.com\\/messages/i')).toBe('/Facebook\\.com\\/messages/i');
  });

  it('drops trailing slash on plain entries', () => {
    expect(normalizeIgnoreEntry('facebook.com/')).toBe('facebook.com');
    expect(normalizeIgnoreEntry('facebook.com/messages/')).toBe('facebook.com/messages');
  });
});
