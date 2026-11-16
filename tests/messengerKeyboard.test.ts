import { describe, expect, it } from 'vitest';
import { keyAction, type KeyInput } from '../src/content/messenger/keyboard';

function key(k: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { key: k, shift: false, ctrl: false, meta: false, alt: false, composing: false, ...extra };
}

describe('keyAction', () => {
  it('leaves the composer alone except for Esc, Tab and paging', () => {
    expect(keyAction('composer', key('a'))).toBeNull();
    expect(keyAction('composer', key('Enter'))).toBeNull();
    expect(keyAction('composer', key('j'))).toBeNull();
    expect(keyAction('composer', key('Escape'))).toBe('to-list');
    expect(keyAction('composer', key('Tab'))).toBe('to-list');
    expect(keyAction('composer', key('Tab', { shift: true }))).toBe('to-list');
    expect(keyAction('composer', key('PageUp'))).toBe('scroll-up');
  });

  it('moves, opens and jumps from the chat list', () => {
    expect(keyAction('list', key('j'))).toBe('list-next');
    expect(keyAction('list', key('ArrowDown'))).toBe('list-next');
    expect(keyAction('list', key('k'))).toBe('list-prev');
    expect(keyAction('list', key('Enter'))).toBe('open');
    expect(keyAction('list', key('l'))).toBe('open');
    expect(keyAction('list', key('Tab'))).toBe('to-composer');
    expect(keyAction('list', key('Tab', { shift: true }))).toBe('to-search');
    expect(keyAction('list', key('/'))).toBe('to-search');
    expect(keyAction('list', key('n'))).toBe('new-chat');
    expect(keyAction('list', key('?'))).toBe('help');
  });

  it('sends other printable keys from the list or the page to the composer', () => {
    expect(keyAction('list', key('h'))).toBe('type');
    expect(keyAction('none', key('j'))).toBe('type');
    expect(keyAction('none', key(' '))).toBe('type');
    expect(keyAction('none', key('Shift'))).toBeNull();
  });

  it('never takes keys from an IME, a modifier chord, a dialog or another field', () => {
    expect(keyAction('none', key('a', { composing: true }))).toBeNull();
    expect(keyAction('none', key('Process'))).toBeNull();
    expect(keyAction('list', key('j', { meta: true }))).toBeNull();
    expect(keyAction('list', key('k', { ctrl: true }))).toBeNull();
    expect(keyAction('other', key('Escape'))).toBeNull();
    expect(keyAction('other', key('PageDown'))).toBeNull();
  });

  it('only leaves the search field on Esc', () => {
    expect(keyAction('search', key('Escape'))).toBe('to-list');
    expect(keyAction('search', key('j'))).toBeNull();
    expect(keyAction('search', key('PageDown'))).toBeNull();
  });
});
