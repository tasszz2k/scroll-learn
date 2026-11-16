// Collapsible chat list: marks the list pane and keeps a small edge handle on
// the chat pane's left border to fold the list away and bring it back.
//
// The handle is a fixed-position element on <html>, placed from the chat
// pane's box, rather than a child of Facebook's React tree, so React's
// re-renders never drop or trip over it.

import { LIST_PANE, findListPane } from './marks';

const HIDDEN = 'data-sl-list-hidden';
const TOGGLE_ID = 'sl-msgr-list-toggle';
const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5"/></svg>';

let onToggle: (() => void) | null = null;

function ensureToggle(): HTMLButtonElement {
  let button = document.getElementById(TOGGLE_ID) as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement('button');
    button.id = TOGGLE_ID;
    button.type = 'button';
    button.innerHTML = CHEVRON;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onToggle?.();
    });
  }
  if (button.parentElement !== document.documentElement) document.documentElement.append(button);
  return button;
}

function placeToggle(button: HTMLElement) {
  const main = document.querySelector('[role="main"]');
  const box = main?.getBoundingClientRect();
  if (!box || box.width === 0) {
    button.style.display = 'none';
    return;
  }
  button.style.removeProperty('display');
  button.style.left = `${box.left}px`;
  button.style.top = `${box.top + box.height / 2}px`;
}

function place() {
  const button = document.getElementById(TOGGLE_ID);
  if (button) placeToggle(button);
}

let resizeListening = false;

export function syncChatList(hidden: boolean, toggle: () => void) {
  onToggle = toggle;
  const list = findListPane();
  if (list && !list.hasAttribute(LIST_PANE)) {
    document.querySelector(`[${LIST_PANE}]`)?.removeAttribute(LIST_PANE);
    list.setAttribute(LIST_PANE, '');
  }
  const root = document.documentElement;
  const changed = root.hasAttribute(HIDDEN) !== hidden;
  root.toggleAttribute(HIDDEN, hidden);

  const button = ensureToggle();
  const label = hidden ? 'Show chat list' : 'Hide chat list';
  if (button.title !== label) {
    button.title = label;
    button.setAttribute('aria-label', label);
  }
  button.setAttribute('aria-pressed', String(hidden));
  placeToggle(button);
  // The chat pane moves once the list folds; place again after layout.
  if (changed) requestAnimationFrame(() => requestAnimationFrame(place));
  if (!resizeListening) {
    resizeListening = true;
    window.addEventListener('resize', place, { passive: true });
  }
}

export function removeChatList() {
  onToggle = null;
  document.documentElement.removeAttribute(HIDDEN);
  document.getElementById(TOGGLE_ID)?.remove();
  if (resizeListening) {
    resizeListening = false;
    window.removeEventListener('resize', place);
  }
}
