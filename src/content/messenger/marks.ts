// Marks the parts of Messenger that fMess themes style. Ported from fMess
// 08-panes.js (list/details detection) and 09-marks.js (MIT,
// https://github.com/toanbku/fmess).
//
// Facebook translates its aria-labels (a Vietnamese Facebook says "Tìm kiếm",
// not "Search"), so the parts are found by where they are and by their icons,
// never by label text. Each gets data-fmess-ui="<name>"; the vendored theme
// CSS matches on those names, so they must stay identical to upstream.

const UI = 'data-fmess-ui';
export const LIST_PANE = 'data-fmess-list';
const CHAT_ROW = 'data-fmess-chat-row';

// The start of the SVG path each composer icon begins with.
const COMPOSER_ICONS: ReadonlyArray<readonly [string, string]> = [
  ['M102 926.75 102 929', 'voice-clip'],
  ['M8 .5A3.5 3.5 0 0 0 4.5 4', 'voice-clip'],
  ['M7 4.25a1.25 1.25 0 1 1-2.5 0', 'attach'],
  ['M8.305 1h-.61c-1.368', 'sticker'],
  ['M7.695 1h.61c1.367', 'gif'],
  // While recording a voice clip: cancel, and send (stop has no path).
  ['M8 .5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z', 'record-cancel'],
  ['M16.6915026,12.4744748', 'send'],
  // The replay of a recorded clip (the pause icon appears once it plays).
  ['M10 25.5v-15a1.5 1.5 0 012.17-1.34l15 7.5a1.5', 'record-play'],
  ['M99.825 918.322', 'attach'],
  ['M106.617 923.049', 'sticker'],
  ['M460.25 1079a', 'gif'],
  ['M210.5,405 C209.121', 'emoji'],
];
const RECORD_CANCEL_PATH = 'M8 .5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15z';
// Messenger's own like button, a thumbs-up (a chat's own one is an emoji picture).
const THUMBS_UP = 'M16,9.1c';

const COMPOSER_MARKS = new Set([
  'composer',
  'composer-bar',
  ...COMPOSER_ICONS.map(([, name]) => name),
  'record-stop',
  'like',
  'send',
  'more-actions',
]);
const REPLY_MARKS = new Set(['reply-text', 'reply-title', 'reply-quote']);
const EDIT_MARKS = new Set(['edit-composer', 'edit-bar', 'edit-cancel', 'edit-box', 'edit-field', 'edit-emoji', 'edit-done']);

function mark(el: Element | null | undefined, name: string) {
  if (el && el.getAttribute(UI) !== name) el.setAttribute(UI, name);
}

function pathOf(button: Element): string {
  return button.querySelector('svg path')?.getAttribute('d') ?? '';
}

function markComposer(composer: Element) {
  mark(composer, 'composer');
  // The bar above the box while replying, or with a link's preview.
  const bar = composer.previousElementSibling;
  mark(bar, 'composer-bar');
  // Marked so a theme needn't find the reply block with a :has() left of a
  // combinator, which made the browser restyle the whole chat on every new
  // message.
  const title = bar?.querySelector('h3')?.parentElement;
  if (title && title !== bar && title.parentElement !== bar) {
    mark(title.parentElement, 'reply-text');
    mark(title, 'reply-title');
    mark(title.nextElementSibling, 'reply-quote');
  }
  const field = [...composer.children].find(child => child.querySelector('[role="textbox"]'));
  const buttons = [...composer.querySelectorAll('[role="button"]')];
  const recording = buttons.some(button => pathOf(button).startsWith(RECORD_CANCEL_PATH));
  for (const button of buttons) {
    const path = pathOf(button);
    const icon = COMPOSER_ICONS.find(([start]) => path.startsWith(start))?.[1];
    // The last part holds the like button, or send once there is text.
    const end = composer.lastElementChild?.tagName === 'SPAN' && composer.lastElementChild.contains(button);
    const like = Boolean(button.querySelector('img')) || path.startsWith(THUMBS_UP);
    if (icon) mark(button, icon);
    else if (!path && button.querySelector('svg')) mark(button, 'record-stop');
    else if (end) mark(button, like ? 'like' : 'send');
    else if (recording && !field?.contains(button)) mark(button, 'record-play');
    else if (!field?.contains(button)) mark(button, 'more-actions');
  }
}

// The lowest box around el, inside the chat, with a button that isn't in el.
function aroundWithButton(el: Element, log: Element): Element | null {
  for (let box = el.parentElement; box && !box.contains(log); box = box.parentElement) {
    for (const button of box.querySelectorAll('[role="button"]')) if (!el.contains(button)) return box;
  }
  return null;
}

// Editing a message: Facebook's edit box has no region and is two rows, a
// bar (title + cancel) and the box (field with emoji, then the save check).
// Found from the text outwards, each step the next box with another button.
function markEdit(textbox: Element, log: Element | null): Element | null {
  if (!log) return null;
  const field = aroundWithButton(textbox, log);
  const row = field && aroundWithButton(field, log);
  const panel = row && aroundWithButton(row, log);
  if (!field || !row || !panel || panel.children.length !== 2) return null;
  const box = [...panel.children].find(child => child.contains(row)) ?? null;
  const bar = [...panel.children].find(child => child !== box) ?? null;
  mark(panel, 'edit-composer');
  mark(bar, 'edit-bar');
  mark(box, 'edit-box');
  mark(field, 'edit-field');
  for (const button of panel.querySelectorAll('[role="button"]')) {
    mark(button, field.contains(button) ? 'edit-emoji' : box?.contains(button) ? 'edit-done' : 'edit-cancel');
  }
  return panel;
}

// Facebook keeps elements across chats and edits; a mark left on them keeps
// a theme's look (a pill, a hidden button) where it no longer belongs.
function unmarkOldComposer(main: Element | null, composer: Element | null, edit: Element | null) {
  for (const el of main?.querySelectorAll(`[${UI}]`) ?? []) {
    const name = el.getAttribute(UI) ?? '';
    let kept = true;
    if (EDIT_MARKS.has(name)) kept = Boolean(edit?.contains(el));
    else if (name === 'composer') kept = el === composer;
    else if (name === 'composer-bar') kept = el === composer?.previousElementSibling;
    else if (REPLY_MARKS.has(name)) kept = Boolean(composer?.previousElementSibling?.contains(el));
    else if (COMPOSER_MARKS.has(name)) kept = Boolean(composer?.contains(el));
    if (!kept) el.removeAttribute(UI);
  }
}

// The reaction picker is opened by a click and lives outside the chat.
function markReactions() {
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (!menu.querySelector('[role="menuitemradio"] img[alt]')) continue;
    mark(menu, 'reactions');
    mark(menu.querySelector('[role="button"]'), 'more-emojis');
  }
}

let markedInfo: Element | null = null;

function markUi(main: Element | null, list: Element | null, log: Element | null, details: Element | null) {
  // While a message is edited the nearest region holds the whole chat;
  // marking it as the composer shrank the chat to a narrow pill.
  const textbox = main?.querySelector('[role="textbox"][contenteditable="true"]') ?? null;
  const region = textbox?.closest('[role="region"]') ?? null;
  const composer = region && !(log && region.contains(log)) ? region : null;
  if (composer) markComposer(composer);
  const edit = textbox && !composer ? markEdit(textbox, log) : null;
  unmarkOldComposer(main, composer, edit);
  mark(details, 'details');
  mark(list?.querySelector('[role="button"][aria-haspopup="menu"]:not([role="grid"] *)'), 'list-menu');
  // The header's button with aria-expanded opens the details; the calls are
  // the two buttons before it on the same line.
  if (main && log && !(markedInfo?.isConnected && main.contains(markedInfo))) {
    const info = [...main.querySelectorAll('[role="button"][aria-expanded]')].find(
      button => !log.contains(button) && !composer?.contains(button) && !details?.contains(button),
    );
    if (info) {
      markedInfo = info;
      mark(info, 'info');
      let header: Element = info;
      while (header.parentElement && !header.parentElement.contains(log)) header = header.parentElement;
      mark(header, 'chat-header');
      const buttons = [...header.querySelectorAll('[role="button"]')];
      const top = info.getBoundingClientRect().top;
      const calls = buttons
        .slice(0, buttons.indexOf(info))
        .filter(button => button.querySelector('svg') && Math.abs(button.getBoundingClientRect().top - top) < 8)
        .slice(-2);
      if (calls.length === 2) {
        mark(calls[0], 'audio-call');
        mark(calls[1], 'video-call');
      }
    }
  }
  markReactions();
}

// The row whose first child holds the messages and whose second is the
// details pane (Facebook gives the details a minimum width).
function findChatRow(log: Element, main: Element): Element | null {
  for (let el: Element | null = log; el && el !== main; el = el.parentElement) {
    const row: Element | null = el.parentElement;
    if (!row || row.children.length < 2 || row.firstElementChild !== el) continue;
    const details = el.nextElementSibling;
    if (!details) continue;
    const style = getComputedStyle(row);
    if (style.display === 'flex' && style.flexDirection === 'row' && parseFloat(getComputedStyle(details).minWidth) >= 200) return row;
  }
  return null;
}

// fMess puts its account button first in the list header (the row holding
// "Chats" and new message). The themes key on it: Zalo hides it and the
// heading block after it (`#fmess-account + div`) and lays the header's
// buttons over the search row from its container. Without it the heading
// leaks out of the folded header and new message loses its place, so an
// inert placeholder stands in for the button.
const ACCOUNT_ID = 'fmess-account';

function syncAccountAnchor() {
  let header: Element | null = document.querySelector('[role="navigation"] a[href="/messages/new/"]');
  while (header && !header.querySelector('h1')) header = header.parentElement;
  if (!header) return;
  let anchor = document.getElementById(ACCOUNT_ID);
  if (!anchor) {
    anchor = document.createElement('div');
    anchor.id = ACCOUNT_ID;
    anchor.setAttribute('aria-hidden', 'true');
  }
  if (header.firstElementChild !== anchor) header.prepend(anchor);
}

let searchedLog: Element | null = null;

// The chat list is the role="navigation" beside role="main".
export function findListPane(): Element | null {
  const main = document.querySelector('[role="main"]');
  return main?.parentElement?.querySelector(':scope > [role="navigation"]') ?? null;
}

export function syncMarks() {
  syncAccountAnchor();
  const main = document.querySelector('[role="main"]');
  const list = findListPane();
  if (list && !list.hasAttribute(LIST_PANE)) {
    document.querySelector(`[${LIST_PANE}]`)?.removeAttribute(LIST_PANE);
    list.setAttribute(LIST_PANE, '');
  }
  const log = main?.querySelector('[role="log"]') ?? null;
  let row = document.querySelector(`[${CHAT_ROW}]`);
  // Finding the row reads styles, so only once per chat and after a click
  // or resize (either can open the details), not every second.
  if (main && log && !row?.contains(log) && log !== searchedLog) {
    searchedLog = log;
    const found = findChatRow(log, main);
    if (found) {
      row?.removeAttribute(CHAT_ROW);
      found.setAttribute(CHAT_ROW, '');
      row = found;
    }
  }
  const details = log && row?.contains(log) && row.children.length > 1 ? row.children[1] : null;
  markUi(main, list, log, details);
}

let interval: number | null = null;
let typedFrame = 0;

function onClick() {
  searchedLog = null;
  window.setTimeout(syncMarks, 50);
  window.setTimeout(syncMarks, 400);
}

function onResize() {
  searchedLog = null;
}

// Typing turns the like button into send.
function onInput(event: Event) {
  const composer = event.target instanceof Element ? event.target.closest(`[${UI}="composer"]`) : null;
  if (composer && !typedFrame) {
    typedFrame = requestAnimationFrame(() => {
      typedFrame = 0;
      markComposer(composer);
    });
  }
}

export function startMarks() {
  if (interval !== null) return;
  syncMarks();
  interval = window.setInterval(syncMarks, 1000);
  document.addEventListener('click', onClick, { capture: true, passive: true });
  document.addEventListener('input', onInput, { capture: true, passive: true });
  window.addEventListener('resize', onResize, { passive: true });
}

export function stopMarks() {
  if (interval === null) return;
  window.clearInterval(interval);
  interval = null;
  document.removeEventListener('click', onClick, { capture: true });
  document.removeEventListener('input', onInput, { capture: true });
  window.removeEventListener('resize', onResize);
  if (typedFrame) cancelAnimationFrame(typedFrame);
  typedFrame = 0;
  searchedLog = null;
  markedInfo = null;
  document.getElementById(ACCOUNT_ID)?.remove();
  for (const el of document.querySelectorAll(`[${UI}], [${LIST_PANE}], [${CHAT_ROW}]`)) {
    el.removeAttribute(UI);
    el.removeAttribute(LIST_PANE);
    el.removeAttribute(CHAT_ROW);
  }
}
