import { describe, it, expect } from 'vitest';

import { isMessengerRoute, isMessengerMediaRoute } from '../src/common/messengerRoute';

describe('isMessengerRoute', () => {
  it('matches the chats on every Facebook host form', () => {
    expect(isMessengerRoute('www.facebook.com', '/messages')).toBe(true);
    expect(isMessengerRoute('facebook.com', '/messages/')).toBe(true);
    expect(isMessengerRoute('m.facebook.com', '/messages/t/123')).toBe(true);
    expect(isMessengerRoute('WWW.FACEBOOK.COM', '/messages/t/123')).toBe(true);
  });

  it('matches encrypted chats and the media viewer', () => {
    expect(isMessengerRoute('www.facebook.com', '/messages/e2ee/t/987654321')).toBe(true);
    expect(isMessengerRoute('www.facebook.com', '/messenger_media/?thread_id=1')).toBe(true);
  });

  it('does not match other Facebook pages', () => {
    expect(isMessengerRoute('www.facebook.com', '/')).toBe(false);
    expect(isMessengerRoute('www.facebook.com', '/marketplace/messages')).toBe(false);
    expect(isMessengerRoute('www.facebook.com', '/messagesfoo')).toBe(false);
    expect(isMessengerRoute('www.facebook.com', '/groups/messages')).toBe(false);
    expect(isMessengerRoute('www.facebook.com', '')).toBe(false);
  });

  it('does not match other hosts', () => {
    expect(isMessengerRoute('www.messenger.com', '/t/123')).toBe(false);
    expect(isMessengerRoute('www.instagram.com', '/messages')).toBe(false);
    expect(isMessengerRoute('evilfacebook.com', '/messages')).toBe(false);
  });
});

describe('isMessengerMediaRoute', () => {
  it('matches only the viewer path', () => {
    expect(isMessengerMediaRoute('/messenger_media')).toBe(true);
    expect(isMessengerMediaRoute('/messenger_media/')).toBe(true);
    expect(isMessengerMediaRoute('/messages/t/1')).toBe(false);
  });
});
