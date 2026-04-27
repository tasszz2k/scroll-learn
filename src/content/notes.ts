// Notes content script: captures user selections on allowlisted domains and
// forwards them to the background service worker for storage.

import type { Settings } from '../common/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../common/types';
import { isHostAllowed } from '../common/allowlist';

const DEBOUNCE_MS = 350;
const LOCAL_DEDUPE_MS = 3000;
const TOAST_VISIBLE_MS = 1800;
const TOAST_GAP_PX = 8;

type CaptureContext = {
  settings: Settings;
  active: boolean;
};

const ctx: CaptureContext = {
  settings: { ...DEFAULT_SETTINGS },
  active: false,
};

let debounceTimer: number | null = null;
let lastSentText = '';
let lastSentAt = 0;

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^(www\.|m\.)/, '');
}

function isAllowed(): boolean {
  const host = normalizeHost(location.hostname);
  if (!host) return false;
  return isHostAllowed(ctx.settings.noteCaptureAllowlist, host);
}

function isInsideEditable(node: Node | null): boolean {
  let el: HTMLElement | null = node instanceof HTMLElement
    ? node
    : node?.parentElement ?? null;
  while (el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    if (el.isContentEditable) return true;
    if (el.className && typeof el.className === 'string' && el.className.includes('scrolllearn-')) return true;
    el = el.parentElement;
  }
  return false;
}

function ensureToastStack(): HTMLElement {
  let stack = document.getElementById('scrolllearn-note-toast-stack');
  if (stack) return stack;
  stack = document.createElement('div');
  stack.id = 'scrolllearn-note-toast-stack';
  // Inline styles so page CSS cannot suppress the stack container.
  stack.style.cssText = [
    'all: initial',
    'position: fixed',
    'right: 16px',
    'bottom: 16px',
    'z-index: 2147483647',
    'display: flex',
    'flex-direction: column',
    'align-items: flex-end',
    `gap: ${TOAST_GAP_PX}px`,
    'pointer-events: none',
  ].join(';');
  document.body.appendChild(stack);
  return stack;
}

function showToast(preview: string) {
  try {
    const stack = ensureToastStack();

    const toast = document.createElement('div');
    toast.className = 'scrolllearn-note-toast';
    toast.style.cssText = [
      'all: initial',
      'box-sizing: border-box',
      'display: flex',
      'align-items: center',
      'gap: 8px',
      'max-width: 360px',
      'padding: 10px 14px',
      'border-radius: 12px',
      'background: #16a34a',
      'color: #ffffff',
      "font: 500 13px/1.3 'Segoe UI', system-ui, -apple-system, sans-serif",
      'box-shadow: 0 12px 28px rgba(0,0,0,0.25)',
      'opacity: 0',
      'transform: translateY(8px)',
      'transition: opacity 0.18s ease, transform 0.18s ease',
      'pointer-events: none',
    ].join(';');

    const icon = document.createElement('span');
    icon.textContent = '✓';
    icon.style.cssText = [
      'all: initial',
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'width: 20px',
      'height: 20px',
      'border-radius: 999px',
      'background: rgba(255,255,255,0.2)',
      'color: #ffffff',
      'font: 700 13px/1 system-ui, sans-serif',
      'flex: 0 0 auto',
    ].join(';');

    const body = document.createElement('div');
    body.style.cssText = [
      'all: initial',
      'display: flex',
      'flex-direction: column',
      'min-width: 0',
      'color: #ffffff',
      "font: 500 13px/1.35 'Segoe UI', system-ui, -apple-system, sans-serif",
    ].join(';');

    const title = document.createElement('span');
    title.textContent = 'Note saved';
    title.style.cssText = [
      'all: initial',
      'color: #ffffff',
      "font: 600 13px/1.35 'Segoe UI', system-ui, -apple-system, sans-serif",
    ].join(';');

    const snippet = preview.replace(/\s+/g, ' ').trim();
    const truncated = snippet.length > 80 ? `${snippet.slice(0, 80)}...` : snippet;
    const previewEl = document.createElement('span');
    previewEl.textContent = truncated;
    previewEl.style.cssText = [
      'all: initial',
      'color: rgba(255,255,255,0.9)',
      "font: 400 12px/1.35 'Segoe UI', system-ui, -apple-system, sans-serif",
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
      'max-width: 320px',
    ].join(';');

    body.appendChild(title);
    if (truncated) body.appendChild(previewEl);
    toast.appendChild(icon);
    toast.appendChild(body);
    stack.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => {
        toast.remove();
        if (stack.childElementCount === 0) stack.remove();
      }, 220);
    }, TOAST_VISIBLE_MS);
  } catch {
    // best-effort UI; ignore failures
  }
}

function trySendNote(text: string) {
  const note = {
    text,
    url: location.href,
    pageTitle: document.title,
    domain: normalizeHost(location.hostname),
  };
  try {
    chrome.runtime.sendMessage({ type: 'save_note', note }, response => {
      if (chrome.runtime.lastError) {
        // Extension context invalidated or background not ready: skip silently
        return;
      }
      if (response && response.ok) {
        showToast(text);
      }
    });
  } catch {
    // chrome.runtime can throw if the extension context is invalidated; ignore
  }
}

function handleSelection() {
  if (!ctx.active) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const raw = selection.toString();
  const text = raw.trim();
  if (!text) return;
  if (text.length < ctx.settings.noteMinLength) return;
  if (isInsideEditable(selection.anchorNode)) return;

  const now = Date.now();
  if (text === lastSentText && now - lastSentAt < LOCAL_DEDUPE_MS) return;

  lastSentText = text;
  lastSentAt = now;
  trySendNote(text);
}

function scheduleCapture() {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    handleSelection();
  }, DEBOUNCE_MS);
}

function onMouseUp() {
  scheduleCapture();
}

function onKeyUp(e: KeyboardEvent) {
  // Only react to keys that can extend or finish a selection
  const k = e.key;
  if (
    k === 'Shift' ||
    k === 'Control' ||
    k === 'Meta' ||
    k === 'ArrowLeft' ||
    k === 'ArrowRight' ||
    k === 'ArrowUp' ||
    k === 'ArrowDown' ||
    k === 'Home' ||
    k === 'End' ||
    k === 'PageUp' ||
    k === 'PageDown'
  ) {
    scheduleCapture();
  }
}

function attachListeners() {
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keyup', onKeyUp, true);
}

function detachListeners() {
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('keyup', onKeyUp, true);
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function applyState() {
  const shouldBeActive = isAllowed();
  if (shouldBeActive && !ctx.active) {
    ctx.active = true;
    attachListeners();
  } else if (!shouldBeActive && ctx.active) {
    ctx.active = false;
    detachListeners();
  }
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const partial = (stored[STORAGE_KEYS.SETTINGS] as Partial<Settings> | undefined) ?? {};
    ctx.settings = { ...DEFAULT_SETTINGS, ...partial };
    applyState();
  } catch {
    // ignore
  }
}

function watchSettings() {
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (!changes[STORAGE_KEYS.SETTINGS]) return;
      const next = changes[STORAGE_KEYS.SETTINGS].newValue as Partial<Settings> | undefined;
      ctx.settings = { ...DEFAULT_SETTINGS, ...(next ?? {}) };
      applyState();
    });
  } catch {
    // ignore
  }
}

void loadSettings();
watchSettings();
