// Keyboard-only use of Messenger, for the CLI theme. The mouse still works;
// the keys just make it unnecessary. Three zones, like a terminal app:
// the chat list (rows are real links, so focus and Enter behave natively),
// the search field, and the composer. Typing anywhere outside a field
// writes a message.
//
// Facebook's own key handling is left alone: only the keys keyAction()
// names are taken, and never while an IME is composing (Vietnamese Telex),
// while a modifier is held, or while focus is inside a dialog or menu.

export type KeyZone = 'composer' | 'search' | 'list' | 'none' | 'other';

export type KeyAction =
  | 'list-next'
  | 'list-prev'
  | 'open'
  | 'to-list'
  | 'to-composer'
  | 'to-search'
  | 'new-chat'
  | 'info'
  | 'help'
  | 'type'
  | 'scroll-up'
  | 'scroll-down';

export interface KeyInput {
  key: string;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  composing: boolean;
}

export function keyAction(zone: KeyZone, k: KeyInput): KeyAction | null {
  if (k.composing || k.key === 'Process' || k.ctrl || k.meta || k.alt) return null;
  if (k.key === 'PageUp' && zone !== 'other' && zone !== 'search') return 'scroll-up';
  if (k.key === 'PageDown' && zone !== 'other' && zone !== 'search') return 'scroll-down';
  switch (zone) {
    case 'composer':
      return k.key === 'Escape' || k.key === 'Tab' ? 'to-list' : null;
    case 'search':
      return k.key === 'Escape' ? 'to-list' : null;
    case 'list':
      switch (k.key) {
        case 'ArrowDown':
        case 'j':
          return 'list-next';
        case 'ArrowUp':
        case 'k':
          return 'list-prev';
        case 'Enter':
        case 'ArrowRight':
        case 'l':
          return 'open';
        case 'Tab':
          return k.shift ? 'to-search' : 'to-composer';
        case '/':
          return 'to-search';
        case 'n':
          return 'new-chat';
        case 'i':
          return 'info';
        case '?':
          return 'help';
        case 'Escape':
          return null;
      }
      return k.key.length === 1 ? 'type' : null;
    case 'none':
      switch (k.key) {
        case 'ArrowDown':
          return 'list-next';
        case 'ArrowUp':
          return 'list-prev';
        case 'Tab':
        case 'Escape':
          return 'to-list';
        case 'Enter':
          return 'to-composer';
        case '/':
          return 'to-search';
        case '?':
          return 'help';
      }
      return k.key.length === 1 ? 'type' : null;
    default:
      return null;
  }
}

const HELP_ID = 'sl-msgr-keys';
const HELP_ROWS: ReadonlyArray<readonly [string, string]> = [
  ['type', 'write a message'],
  ['Enter', 'send'],
  ['Esc  Tab', 'go to the chat list'],
  ['j k  Up Down', 'move in the chat list'],
  ['Enter  l', 'open the chat (cd)'],
  ['Tab', 'back to the message field'],
  ['/', 'search chats'],
  ['n', 'new chat'],
  ['i', 'chat info'],
  ['PgUp PgDn', 'scroll the messages'],
  ['?', 'show or hide this help'],
];

const ROW_LINK = '[data-fmess-list] [role="row"] a[role="link"]';

function textbox(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="main"] [role="textbox"][contenteditable="true"]:not([role="log"] *)',
  );
}

function searchField(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('[data-fmess-list] input');
}

function rows(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>(ROW_LINK)].filter(a => a.getClientRects().length > 0);
}

function zoneOf(el: Element | null): KeyZone {
  if (!el || el === document.body || el === document.documentElement) return 'none';
  if (el.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return 'other';
  if (el === textbox()) return 'composer';
  if (el === searchField()) return 'search';
  if (el.closest(ROW_LINK)) return 'list';
  const editable = el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  return editable ? 'other' : 'none';
}

function focusRow(row: HTMLElement | undefined) {
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
}

function moveInList(step: 1 | -1) {
  const all = rows();
  if (all.length === 0) return;
  const at = all.findIndex(a => a === document.activeElement || a.contains(document.activeElement));
  if (at === -1) {
    // Entering the list lands on the open chat first, like `pwd`.
    focusRow(all.find(a => a.getAttribute('aria-current') === 'page') ?? all[0]);
    return;
  }
  focusRow(all[Math.min(all.length - 1, Math.max(0, at + step))]);
}

function toList() {
  const all = rows();
  focusRow(all.find(a => a.getAttribute('aria-current') === 'page') ?? all[0]);
}

function toComposer(): boolean {
  const box = textbox();
  if (!box) return false;
  box.focus();
  return true;
}

let openTimer: number | null = null;

// The chat loads after the link's navigation, so the composer is focused
// once the address has changed and its text field exists.
function openRow(row: HTMLAnchorElement) {
  const from = location.pathname;
  const target = new URL(row.href, location.href).pathname;
  row.click();
  if (openTimer !== null) window.clearInterval(openTimer);
  const started = Date.now();
  openTimer = window.setInterval(() => {
    const arrived = target === from || location.pathname !== from;
    if ((arrived && toComposer()) || Date.now() - started > 3000) {
      window.clearInterval(openTimer!);
      openTimer = null;
    }
  }, 100);
}

function scrollLog(direction: 1 | -1) {
  const log = document.querySelector('[role="main"] [role="log"]');
  for (let el: Element | null = log; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(style.overflowY)) {
      el.scrollBy({ top: direction * el.clientHeight * 0.8 });
      return;
    }
  }
}

function toggleHelp(show?: boolean) {
  const open = document.getElementById(HELP_ID);
  if (open || show === false) {
    open?.remove();
    return;
  }
  const box = document.createElement('div');
  box.id = HELP_ID;
  box.setAttribute('role', 'note');
  const title = document.createElement('div');
  title.className = 'sl-keys-title';
  title.textContent = '$ man messenger';
  box.append(title);
  for (const [keys, what] of HELP_ROWS) {
    const line = document.createElement('div');
    const k = document.createElement('span');
    k.className = 'sl-keys-k';
    k.textContent = keys;
    line.append(k, document.createTextNode(what));
    box.append(line);
  }
  const foot = document.createElement('div');
  foot.className = 'sl-keys-foot';
  foot.textContent = 'Esc or ? to close';
  box.append(foot);
  document.documentElement.append(box);
}

function onKeyDown(event: KeyboardEvent) {
  if (document.documentElement.hasAttribute('data-fmess-media')) return;
  if (document.getElementById(HELP_ID) && (event.key === 'Escape' || event.key === '?')) {
    event.preventDefault();
    event.stopPropagation();
    toggleHelp(false);
    return;
  }
  const active = document.activeElement;
  const action = keyAction(zoneOf(active), {
    key: event.key,
    shift: event.shiftKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    composing: event.isComposing,
  });
  if (!action) return;

  // 'type' only moves focus: the key itself must still reach the composer.
  if (action === 'type') {
    toComposer();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  switch (action) {
    case 'list-next':
      moveInList(1);
      break;
    case 'list-prev':
      moveInList(-1);
      break;
    case 'open': {
      const row = active?.closest<HTMLAnchorElement>(ROW_LINK);
      if (row) openRow(row);
      break;
    }
    case 'to-list': {
      // Esc while replying drops the reply first, as Messenger's [cancel].
      const cancelReply = document.querySelector<HTMLElement>('[data-fmess-ui="composer-bar"] [role="button"]');
      if (event.key === 'Escape' && zoneOf(active) === 'composer' && document.querySelector('[data-fmess-ui="reply-text"]') && cancelReply) {
        cancelReply.click();
        break;
      }
      toList();
      break;
    }
    case 'to-composer':
      toComposer();
      break;
    case 'to-search':
      searchField()?.focus();
      break;
    case 'new-chat':
      document.querySelector<HTMLElement>('[data-fmess-list] a[href="/messages/new/"]')?.click();
      break;
    case 'info':
      document.querySelector<HTMLElement>('[data-fmess-ui="info"]')?.click();
      break;
    case 'help':
      toggleHelp();
      break;
    case 'scroll-up':
      scrollLog(-1);
      break;
    case 'scroll-down':
      scrollLog(1);
      break;
  }
}

let started = false;

export function startKeyboard() {
  if (started) return;
  started = true;
  // Capture phase, so Esc and Tab are handled before Facebook's composer
  // moves focus on its own.
  window.addEventListener('keydown', onKeyDown, true);
}

export function stopKeyboard() {
  if (!started) return;
  started = false;
  window.removeEventListener('keydown', onKeyDown, true);
  if (openTimer !== null) window.clearInterval(openTimer);
  openTimer = null;
  toggleHelp(false);
}
