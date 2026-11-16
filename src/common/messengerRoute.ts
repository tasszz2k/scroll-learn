// Which pages count as Messenger for the Messenger focus mode and themes.
//
// The chats live at facebook.com/messages/... (encrypted chats at
// /messages/e2ee/t/<id>), and the photo/video viewer opened from them at
// /messenger_media. Marketplace's inbox (/marketplace/messages) is not the
// Messenger UI and must stay untouched.

import { normalizeHost } from './urlIgnore';

const CHATS_PATH_RE = /^\/(messages|messenger_media)(\/|$)/;

export function isFacebookHost(host: string): boolean {
  return normalizeHost(host) === 'facebook.com';
}

export function isMessengerRoute(host: string, pathname: string): boolean {
  return isFacebookHost(host) && CHATS_PATH_RE.test(pathname || '');
}

export function isMessengerMediaRoute(pathname: string): boolean {
  return /^\/messenger_media(\/|$)/.test(pathname || '');
}
