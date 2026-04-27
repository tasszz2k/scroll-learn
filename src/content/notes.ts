// Notes content script: captures user selections on allowlisted domains and
// forwards them to the background service worker for storage.

import type { Settings } from '../common/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../common/types';
import { isHostAllowed } from '../common/allowlist';

const DEBOUNCE_MS = 350;
const LOCAL_DEDUPE_MS = 3000;
const TOAST_GAP_PX = 8;
// Bounds enforced on the user-configurable toast duration.
const TOAST_MIN_MS = 1000;
const TOAST_MAX_MS = 30000;

type CaptureContext = {
  settings: Settings;
  active: boolean;
};

const ctx: CaptureContext = {
  settings: { ...DEFAULT_SETTINGS },
  active: false,
};

function toastVisibleMs(): number {
  const seconds = ctx.settings.noteToastDurationSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_SETTINGS.noteToastDurationSeconds * 1000;
  return Math.max(TOAST_MIN_MS, Math.min(TOAST_MAX_MS, Math.round(seconds * 1000)));
}

let debounceTimer: number | null = null;
let lastSentText = '';
let lastSentAt = 0;

// Pluck mode state: while Ctrl/Cmd is held, hovering shows a green outline as a
// preview — nothing is saved. Releasing the modifier captures whichever element
// is currently outlined. Click / right-click during the hold also captures
// immediately (useful for macOS where Ctrl+click is contextmenu).
let pluckActive = false;
let pluckHoverEl: HTMLElement | null = null;
let pluckHoverPrev: { outline: string; outlineOffset: string; backgroundColor: string } | null = null;
let pluckPrevBodyCursor = '';
let pluckSessionCaptured = false;

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

function showToast(preview: string, opts: { copied?: boolean; translation?: string } = {}) {
  try {
    const stack = ensureToastStack();

    const toast = document.createElement('div');
    toast.className = 'scrolllearn-note-toast';
    toast.style.cssText = [
      'all: initial',
      'box-sizing: border-box',
      'display: flex',
      'align-items: flex-start',
      'gap: 8px',
      'max-width: 380px',
      'padding: 10px 14px',
      'border-radius: 12px',
      'background: #16a34a',
      'color: #ffffff',
      "font: 500 13px/1.3 'Segoe UI', system-ui, -apple-system, sans-serif",
      'box-shadow: 0 12px 28px rgba(0,0,0,0.25)',
      'opacity: 0',
      'transform: translateY(8px)',
      'transition: opacity 0.18s ease, transform 0.18s ease',
      'pointer-events: auto',
      'cursor: pointer',
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
      'margin-top: 1px',
    ].join(';');

    const body = document.createElement('div');
    body.style.cssText = [
      'all: initial',
      'display: flex',
      'flex-direction: column',
      'min-width: 0',
      'gap: 2px',
      'color: #ffffff',
      "font: 500 13px/1.35 'Segoe UI', system-ui, -apple-system, sans-serif",
    ].join(';');

    const title = document.createElement('span');
    title.textContent = opts.copied ? 'Saved & copied' : 'Note saved';
    title.style.cssText = [
      'all: initial',
      'color: #ffffff',
      "font: 600 13px/1.35 'Segoe UI', system-ui, -apple-system, sans-serif",
    ].join(';');

    const snippet = preview.replace(/\s+/g, ' ').trim();
    const truncated = snippet.length > 120 ? `${snippet.slice(0, 120)}...` : snippet;
    const previewEl = document.createElement('span');
    previewEl.textContent = truncated;
    previewEl.style.cssText = [
      'all: initial',
      'color: rgba(255,255,255,0.92)',
      "font: 400 12px/1.4 'Segoe UI', system-ui, -apple-system, sans-serif",
      'display: -webkit-box',
      '-webkit-line-clamp: 2',
      '-webkit-box-orient: vertical',
      'overflow: hidden',
      'max-width: 340px',
      'word-break: break-word',
    ].join(';');

    body.appendChild(title);
    if (truncated) body.appendChild(previewEl);

    const translationRaw = opts.translation?.replace(/\s+/g, ' ').trim();
    if (translationRaw) {
      const translatedText = translationRaw.length > 120
        ? `${translationRaw.slice(0, 120)}...`
        : translationRaw;
      const translatedEl = document.createElement('span');
      translatedEl.textContent = translatedText;
      translatedEl.style.cssText = [
        'all: initial',
        'margin-top: 4px',
        'padding-top: 4px',
        'border-top: 1px solid rgba(255,255,255,0.25)',
        'color: rgba(255,255,255,0.96)',
        "font: 500 12px/1.4 'Segoe UI', system-ui, -apple-system, sans-serif",
        'font-style: italic',
        'display: -webkit-box',
        '-webkit-line-clamp: 3',
        '-webkit-box-orient: vertical',
        'overflow: hidden',
        'max-width: 340px',
        'word-break: break-word',
      ].join(';');
      body.appendChild(translatedEl);
    }

    toast.appendChild(icon);
    toast.appendChild(body);
    stack.appendChild(toast);

    let removed = false;
    function dismiss() {
      if (removed) return;
      removed = true;
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => {
        toast.remove();
        if (stack.childElementCount === 0) stack.remove();
      }, 220);
    }
    toast.addEventListener('click', dismiss);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(dismiss, toastVisibleMs());
  } catch {
    // best-effort UI; ignore failures
  }
}

function setPluckHover(el: HTMLElement | null) {
  if (pluckHoverEl === el) return;
  if (pluckHoverEl && pluckHoverPrev) {
    pluckHoverEl.style.outline = pluckHoverPrev.outline;
    pluckHoverEl.style.outlineOffset = pluckHoverPrev.outlineOffset;
    pluckHoverEl.style.backgroundColor = pluckHoverPrev.backgroundColor;
  }
  pluckHoverEl = el;
  pluckHoverPrev = null;
  if (el) {
    pluckHoverPrev = {
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      backgroundColor: el.style.backgroundColor,
    };
    el.style.outline = '2px solid #16a34a';
    el.style.outlineOffset = '2px';
    el.style.backgroundColor = 'rgba(22, 163, 74, 0.08)';
  }
}

function pluckTargetFromPoint(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return null;
  if (el.id === 'scrolllearn-note-toast-stack' || el.closest('#scrolllearn-note-toast-stack')) {
    return null;
  }
  return el;
}

function pluckExtractText(target: HTMLElement): string {
  // Prefer the click target itself, but if it has no text walk up to find one.
  // For buttons/links wrap inner spans, climbing to the button gives the full label.
  let el: HTMLElement | null = target;
  while (el) {
    const raw = (el.innerText || el.textContent || '').trim();
    if (raw) return raw;
    el = el.parentElement;
  }
  return '';
}

function onPluckMove(e: MouseEvent) {
  if (!pluckActive) return;
  const target = pluckTargetFromPoint(e.clientX, e.clientY);
  setPluckHover(target);
}

function pluckCaptureElement(target: HTMLElement) {
  if (target.closest('#scrolllearn-note-toast-stack')) return;
  const text = pluckExtractText(target).replace(/\s+/g, ' ').trim();
  if (!text) {
    console.log('[ScrollLearn:notes] pluck: no text extracted from', target);
    return;
  }
  if (text.length < ctx.settings.noteMinLength) {
    console.log('[ScrollLearn:notes] pluck: text below minLength', text);
    return;
  }

  const now = Date.now();
  if (text === lastSentText && now - lastSentAt < LOCAL_DEDUPE_MS) {
    console.log('[ScrollLearn:notes] pluck: dedupe skip', text);
    return;
  }
  lastSentText = text;
  lastSentAt = now;

  trySendNote(text);
}

function onPluckClickCapture(e: MouseEvent) {
  if (!pluckActive) return;

  // If the user happened to drag-select with the modifier held, let the
  // selection-capture path handle it via the normal mouseup flow.
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim()) return;

  const target = (e.target as HTMLElement | null) ?? pluckHoverEl;
  if (!target) return;
  if (target.closest('#scrolllearn-note-toast-stack')) return;

  // Intercept the click so the page's button/link handler doesn't fire.
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  pluckSessionCaptured = true;
  pluckCaptureElement(target);
}

// macOS converts Ctrl+click into a contextmenu event, so the click listener never
// fires there. Intercept contextmenu while pluck is active and use it as the
// capture trigger.
function onPluckContextMenu(e: MouseEvent) {
  if (!pluckActive) return;
  const target = (e.target as HTMLElement | null) ?? pluckHoverEl;
  if (!target) return;
  if (target.closest('#scrolllearn-note-toast-stack')) return;

  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  pluckSessionCaptured = true;
  pluckCaptureElement(target);
}

function startPluck() {
  if (pluckActive) return;
  pluckActive = true;
  pluckSessionCaptured = false;
  pluckPrevBodyCursor = document.body.style.cursor;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mousemove', onPluckMove, true);
  document.addEventListener('click', onPluckClickCapture, true);
  document.addEventListener('contextmenu', onPluckContextMenu, true);
  console.log('[ScrollLearn:notes] pluck mode ON');
}

function stopPluck(opts: { skipCapture?: boolean } = {}) {
  if (!pluckActive) return;
  // Capture the currently-hovered element on release, unless click/contextmenu
  // already handled the capture during this session, or the caller asked us to
  // skip (e.g. window blur).
  const captureTarget = !opts.skipCapture && !pluckSessionCaptured ? pluckHoverEl : null;

  pluckActive = false;
  document.body.style.cursor = pluckPrevBodyCursor;
  setPluckHover(null);
  document.removeEventListener('mousemove', onPluckMove, true);
  document.removeEventListener('click', onPluckClickCapture, true);
  document.removeEventListener('contextmenu', onPluckContextMenu, true);

  if (captureTarget) {
    pluckCaptureElement(captureTarget);
  }
}

function isPluckModifier(e: KeyboardEvent | MouseEvent): boolean {
  if ('key' in e) return e.key === 'Control' || e.key === 'Meta';
  return e.ctrlKey || e.metaKey;
}

function onPluckKeyDown(e: KeyboardEvent) {
  if (!isPluckModifier(e)) return;
  if (!ctx.active) {
    console.log(
      '[ScrollLearn:notes] pluck skipped: site not on allowlist',
      { hostname: normalizeHost(location.hostname), allowlist: ctx.settings.noteCaptureAllowlist },
    );
    return;
  }
  if (isInsideEditable(document.activeElement)) {
    console.log('[ScrollLearn:notes] pluck skipped: focus is in an editable field');
    return;
  }
  startPluck();
}

function onPluckKeyUp(e: KeyboardEvent) {
  // Stop when the modifier is released or no longer held
  if (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey)) {
    stopPluck();
  }
}

function onWindowBlur() {
  // Tab-switch / focus loss while modifier held: the keyup may never fire.
  // Don't capture on blur — user didn't intend to release the modifier.
  stopPluck({ skipCapture: true });
}

function showStatusToast(message: string, kind: 'warn' | 'error' = 'warn') {
  try {
    const stack = ensureToastStack();
    const toast = document.createElement('div');
    const bg = kind === 'error' ? '#dc2626' : '#d97706';
    toast.style.cssText = [
      'all: initial',
      'box-sizing: border-box',
      'display: flex',
      'align-items: center',
      'gap: 8px',
      'max-width: 360px',
      'padding: 10px 14px',
      'border-radius: 12px',
      `background: ${bg}`,
      'color: #ffffff',
      "font: 500 13px/1.3 'Segoe UI', system-ui, -apple-system, sans-serif",
      'box-shadow: 0 12px 28px rgba(0,0,0,0.25)',
      'opacity: 0',
      'transform: translateY(8px)',
      'transition: opacity 0.18s ease, transform 0.18s ease',
      'pointer-events: none',
    ].join(';');
    toast.textContent = message;
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
    }, 1500);
  } catch {
    // ignore
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  // Try the modern clipboard API first; fall back to execCommand for sites where
  // the API is blocked by permissions-policy or the user-gesture chain has lapsed.
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[ScrollLearn:notes] navigator.clipboard.writeText failed, trying fallback:', err);
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (err) {
    console.warn('[ScrollLearn:notes] execCommand copy failed:', err);
    return false;
  }
}

async function trySendNote(text: string) {
  // Stage the captured text on the system clipboard alongside the save so the
  // user can paste it elsewhere without an explicit Ctrl+C step.
  const copied = await copyTextToClipboard(text);

  const note = {
    text,
    url: location.href,
    pageTitle: document.title,
    domain: normalizeHost(location.hostname),
  };
  try {
    chrome.runtime.sendMessage({ type: 'save_note', note }, response => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message ?? 'unknown';
        console.warn('[ScrollLearn:notes] sendMessage failed:', msg);
        showStatusToast(`Save failed: ${msg}`, 'error');
        return;
      }
      if (!response) {
        console.warn('[ScrollLearn:notes] sendMessage: no response');
        showStatusToast('Save failed: no response', 'error');
        return;
      }
      if (!response.ok) {
        console.warn('[ScrollLearn:notes] save_note error:', response.error);
        showStatusToast(`Save failed: ${response.error ?? 'unknown'}`, 'error');
        return;
      }
      const savedTranslation = response.data && typeof response.data === 'object'
        ? (response.data as { translation?: unknown }).translation
        : undefined;
      const translation = typeof savedTranslation === 'string' ? savedTranslation : undefined;
      console.log('[ScrollLearn:notes] save_note ok, clipboard:', copied, 'translation:', !!translation);
      showToast(text, { copied, translation });
    });
  } catch (err) {
    console.warn('[ScrollLearn:notes] sendMessage threw:', err);
    showStatusToast('Save failed: extension context invalid', 'error');
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

function onCopy() {
  // Explicit copy (Ctrl+C / right-click Copy / programmatic copy) is strong
  // intent — capture immediately without the debounce so the toast confirms
  // the action right when the keystroke happens.
  if (!ctx.active) return;
  handleSelection();
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
  document.addEventListener('copy', onCopy, true);
  document.addEventListener('keydown', onPluckKeyDown, true);
  document.addEventListener('keyup', onPluckKeyUp, true);
  window.addEventListener('blur', onWindowBlur);
}

function detachListeners() {
  document.removeEventListener('mouseup', onMouseUp, true);
  document.removeEventListener('keyup', onKeyUp, true);
  document.removeEventListener('copy', onCopy, true);
  document.removeEventListener('keydown', onPluckKeyDown, true);
  document.removeEventListener('keyup', onPluckKeyUp, true);
  window.removeEventListener('blur', onWindowBlur);
  stopPluck();
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
    console.log('[ScrollLearn:notes] capture ACTIVE on', normalizeHost(location.hostname));
  } else if (!shouldBeActive && ctx.active) {
    ctx.active = false;
    detachListeners();
    console.log('[ScrollLearn:notes] capture INACTIVE on', normalizeHost(location.hostname));
  } else if (!shouldBeActive) {
    console.log(
      '[ScrollLearn:notes] capture inactive — host not allowlisted',
      { hostname: normalizeHost(location.hostname), allowlist: ctx.settings.noteCaptureAllowlist },
    );
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
