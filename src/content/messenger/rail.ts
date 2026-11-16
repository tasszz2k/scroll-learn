// Makes the buttons a theme draws on the chat list respond (the Zalo look's
// blue bar down its left side). Ported from fMess 17-theme-hooks.js and the
// avatar part of 19-account.js (MIT, https://github.com/toanbku/fmess).
//
// The theme lists its buttons in --fmess-buttons on the list: "name left top
// size" each, comma-separated, a negative top counting from the bottom. They
// are pseudo-element paint only, so hover and click are hit-tested here
// against the list's box. The theme reads --fmess-hover-left/-top to draw
// the highlight and data-fmess-hover="<name>" for a label.

interface RailButton {
  name: string;
  left: number;
  top: number;
  size: number;
}

const AVATAR_VAR = '--fmess-avatar';

function buttonAt(list: Element, x: number, y: number): RailButton | null {
  const box = list.getBoundingClientRect();
  for (const spec of getComputedStyle(list).getPropertyValue('--fmess-buttons').split(',')) {
    const [name, left, top, size] = spec.trim().replace(/"/g, '').split(/\s+/);
    const px = Number(size);
    if (!name || !(px > 0)) continue;
    const button: RailButton = {
      name,
      left: box.left + Number(left),
      top: Number(top) < 0 ? box.bottom + Number(top) - px : box.top + Number(top),
      size: px,
    };
    if (x >= button.left && x <= button.left + px && y >= button.top && y <= button.top + px) return button;
  }
  return null;
}

function listOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[role="navigation"]') : null;
}

function unlight(list: HTMLElement) {
  list.style.removeProperty('--fmess-hover-left');
  list.style.removeProperty('--fmess-hover-top');
  list.style.removeProperty('cursor');
  list.removeAttribute('data-fmess-hover');
}

let hoveredList: HTMLElement | null = null;

function onMouseMove(event: MouseEvent) {
  const list = listOf(event.target);
  if (hoveredList && hoveredList !== list) unlight(hoveredList);
  hoveredList = list;
  if (!list) return;
  const button = buttonAt(list, event.clientX, event.clientY);
  if (!button) {
    unlight(list);
    return;
  }
  const box = list.getBoundingClientRect();
  list.style.setProperty('--fmess-hover-left', `${button.left - box.left}px`);
  list.style.setProperty('--fmess-hover-top', `${button.top - box.top}px`);
  list.style.cursor = 'pointer';
  if (list.getAttribute('data-fmess-hover') !== button.name) list.setAttribute('data-fmess-hover', button.name);
}

export interface RailActions {
  toggleChatList: () => void;
}

let actions: RailActions | null = null;

// fMess opens its native account menu and settings window here; a browser
// tab has neither, so the avatar is the way back to Facebook and settings
// opens ScrollLearn's. Chats folds the list in and out, as Zalo's Messages
// button does. The other icons (contacts, cloud, ...) are decorative
// upstream too.
function onClick(event: MouseEvent) {
  const list = listOf(event.target);
  const button = list && buttonAt(list, event.clientX, event.clientY);
  if (!button) return;
  let run: (() => void) | null = null;
  if (button.name === 'account') run = () => window.location.assign('https://www.facebook.com/');
  else if (button.name === 'chats') run = () => actions?.toggleChatList();
  else if (button.name === 'settings') {
    run = () => {
      // Throws synchronously once the extension reloads under the page.
      try {
        chrome.runtime.sendMessage({ type: 'open_dashboard', hash: 'settings' }).catch(() => {});
      } catch {
        /* extension context invalidated */
      }
    };
  }
  if (!run) return;
  event.preventDefault();
  event.stopPropagation();
  run();
}

// Facebook's hidden top bar still holds your profile picture; reading it
// from there avoids the page-world modules fMess uses, which the isolated
// content-script world cannot reach.
function syncAvatar() {
  const image = [...document.querySelectorAll('[role="banner"] svg image')].find(img => !img.closest('[role="dialog"]'));
  const href = image?.getAttribute('xlink:href') || image?.getAttribute('href') || '';
  const root = document.documentElement;
  if (/^https:\/\/[^"\\\s]+$/.test(href)) root.style.setProperty(AVATAR_VAR, `url("${href}")`);
}

let avatarTimer: number | null = null;

export function startRail(railActions: RailActions) {
  actions = railActions;
  if (avatarTimer !== null) return;
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('click', onClick, true);
  syncAvatar();
  // The banner renders after the chats on a cold load.
  avatarTimer = window.setInterval(syncAvatar, 5000);
}

export function stopRail() {
  if (avatarTimer === null) return;
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('click', onClick, true);
  window.clearInterval(avatarTimer);
  avatarTimer = null;
  actions = null;
  if (hoveredList) unlight(hoveredList);
  hoveredList = null;
  document.documentElement.style.removeProperty(AVATAR_VAR);
}
