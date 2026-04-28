// Notes content script: on allowlisted domains, captures the element under the
// cursor while the user holds the Option (Alt) key ("pluck mode") and forwards
// its text to the background service worker for storage. Plain text selection
// alone never triggers a save; the user must opt in by holding the modifier.

import type { Settings, DictionarySense, DerivedForm } from '../common/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../common/types';
import { isHostAllowed } from '../common/allowlist';

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

let lastSentText = '';
let lastSentAt = 0;

// Pluck mode state: while Option (Alt) is held, hovering shows a green outline
// as a preview; nothing is saved. Releasing the modifier captures whichever
// element is currently outlined. Clicking during the hold also captures
// immediately. If the user drag-selects text during the hold, the selected
// words are saved instead of the surrounding element's full text. Pressing Esc
// cancels without saving.
let pluckActive = false;
let pluckHoverEl: HTMLElement | null = null;
let pluckHoverPrev: { outline: string; outlineOffset: string; backgroundColor: string } | null = null;
let pluckPrevBodyCursor = '';
let pluckSessionCaptured = false;
let pluckMouseDown = false;

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

function posLabel(pos: DictionarySense['pos']): string {
  switch (pos) {
    case 'noun': return 'noun';
    case 'verb': return 'verb';
    case 'adjective': return 'adj';
    case 'adverb': return 'adv';
    case 'pronoun': return 'pron';
    case 'preposition': return 'prep';
    case 'conjunction': return 'conj';
    case 'interjection': return 'interj';
    default: return '';
  }
}

function showToast(
  preview: string,
  opts: {
    copied?: boolean;
    translation?: string;
    senses?: DictionarySense[];
    derivedForms?: DerivedForm[];
  } = {},
) {
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

    const senses = opts.senses ?? [];
    for (const sense of senses) {
      const label = posLabel(sense.pos);
      const display = sense.terms.join(', ');
      if (!display) continue;
      const senseEl = document.createElement('span');
      senseEl.textContent = label ? `(${label}) ${display}` : display;
      senseEl.style.cssText = [
        'all: initial',
        'margin-top: 2px',
        'color: rgba(255,255,255,0.92)',
        "font: 400 11px/1.4 'Segoe UI', system-ui, -apple-system, sans-serif",
        'font-style: italic',
        'display: -webkit-box',
        '-webkit-line-clamp: 3',
        '-webkit-box-orient: vertical',
        'overflow: hidden',
        'max-width: 340px',
        'word-break: break-word',
      ].join(';');
      body.appendChild(senseEl);
    }

    const derivedForms = opts.derivedForms ?? [];
    if (derivedForms.length > 0) {
      const parts = derivedForms
        .map(f => {
          const label = posLabel(f.pos);
          return label ? `${f.word} (${label})` : f.word;
        })
        .filter(Boolean);
      if (parts.length > 0) {
        const familyEl = document.createElement('span');
        familyEl.textContent = `family: ${parts.join(' · ')}`;
        familyEl.style.cssText = [
          'all: initial',
          'margin-top: 4px',
          'padding-top: 4px',
          'border-top: 1px solid rgba(255,255,255,0.18)',
          'color: rgba(255,255,255,0.88)',
          "font: 400 11px/1.4 'Segoe UI', system-ui, -apple-system, sans-serif",
          'display: -webkit-box',
          '-webkit-line-clamp: 3',
          '-webkit-box-orient: vertical',
          'overflow: hidden',
          'max-width: 340px',
          'word-break: break-word',
        ].join(';');
        body.appendChild(familyEl);
      }
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
  if (el.id === 'scrolllearn-sidebar-fab' || el.closest('#scrolllearn-sidebar-fab')) {
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
  // While the user is dragging to select text, suppress the hover outline so it
  // doesn't compete visually with the native selection highlight.
  if (pluckMouseDown) {
    setPluckHover(null);
    return;
  }
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

function pluckCaptureSelection(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return false;
  const raw = sel.toString();
  if (!raw.trim()) return false;
  if (isInsideEditable(sel.anchorNode)) {
    console.log('[ScrollLearn:notes] pluck selection: inside editable, skip');
    return false;
  }
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length < ctx.settings.noteMinLength) {
    console.log('[ScrollLearn:notes] pluck selection: below minLength', text);
    return false;
  }

  const now = Date.now();
  if (text === lastSentText && now - lastSentAt < LOCAL_DEDUPE_MS) {
    console.log('[ScrollLearn:notes] pluck selection: dedupe skip', text);
    return false;
  }
  lastSentText = text;
  lastSentAt = now;

  trySendNote(text);
  return true;
}

function onPluckMouseDown() {
  if (!pluckActive) return;
  pluckMouseDown = true;
}

// Selection wins over element capture: if the user has any non-empty text
// selection at this trigger, save that text and skip element capture.
function pluckCaptureSelectionOrElement(target: HTMLElement | null): boolean {
  if (pluckCaptureSelection()) return true;
  if (!target) return false;
  if (target.closest('#scrolllearn-note-toast-stack')) return false;
  pluckCaptureElement(target);
  return true;
}

function onPluckMouseUpCapture() {
  if (!pluckActive) return;
  if (!pluckMouseDown) return;
  pluckMouseDown = false;
  if (pluckSessionCaptured) return;

  // If the user drag-selected text during the modifier hold, save just those
  // words. A bare click (no selection) is handled by the click listener below.
  if (pluckCaptureSelection()) {
    pluckSessionCaptured = true;
  }
}

function onPluckClickCapture(e: MouseEvent) {
  if (!pluckActive) return;

  // mouseup may have already captured a drag-selected range during this hold.
  // Consume the click so the page's link/button handler doesn't fire either.
  if (pluckSessionCaptured) {
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    return;
  }

  const target = (e.target as HTMLElement | null) ?? pluckHoverEl;
  if (!target) return;
  if (target.closest('#scrolllearn-note-toast-stack')) return;

  // Intercept the click so the page's button/link handler doesn't fire.
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

  if (pluckCaptureSelectionOrElement(target)) {
    pluckSessionCaptured = true;
  }
}

function startPluck() {
  if (pluckActive) return;
  pluckActive = true;
  pluckSessionCaptured = false;
  pluckMouseDown = false;
  pluckPrevBodyCursor = document.body.style.cursor;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mousemove', onPluckMove, true);
  document.addEventListener('mousedown', onPluckMouseDown, true);
  document.addEventListener('mouseup', onPluckMouseUpCapture, true);
  document.addEventListener('click', onPluckClickCapture, true);
  console.log('[ScrollLearn:notes] pluck mode ON');
}

function stopPluck(opts: { skipCapture?: boolean } = {}) {
  if (!pluckActive) return;
  // On release, prefer any drag-selected text over the hovered element. Skip
  // entirely if click/contextmenu/mouseup already captured this session or the
  // caller asked us to (e.g. window blur).
  const shouldCapture = !opts.skipCapture && !pluckSessionCaptured;
  const captureTarget = shouldCapture ? pluckHoverEl : null;

  pluckActive = false;
  pluckMouseDown = false;
  document.body.style.cursor = pluckPrevBodyCursor;
  setPluckHover(null);
  document.removeEventListener('mousemove', onPluckMove, true);
  document.removeEventListener('mousedown', onPluckMouseDown, true);
  document.removeEventListener('mouseup', onPluckMouseUpCapture, true);
  document.removeEventListener('click', onPluckClickCapture, true);

  if (shouldCapture) {
    pluckCaptureSelectionOrElement(captureTarget);
  }
}

function isPluckModifier(e: KeyboardEvent | MouseEvent): boolean {
  if ('key' in e) return e.key === 'Alt';
  return e.altKey;
}

function onPluckKeyDown(e: KeyboardEvent) {
  // Esc cancels an in-progress pluck without saving the hovered element.
  if (e.key === 'Escape' && pluckActive) {
    console.log('[ScrollLearn:notes] pluck cancelled via Escape');
    stopPluck({ skipCapture: true });
    return;
  }
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
  if (e.key === 'Alt' || !e.altKey) {
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

function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err && 'message' in err) {
    return `${String((err as { name: unknown }).name)}: ${String((err as { message: unknown }).message)}`;
  }
  return String(err);
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  // Try the modern clipboard API first; fall back to execCommand for sites where
  // the API is blocked by permissions-policy or the document is not focused
  // (common on preview/iframe surfaces). hasFocus() avoids a guaranteed
  // DOMException on the most frequent failure mode.
  let modernErr: unknown = null;
  if (
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function' &&
    document.hasFocus()
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      modernErr = err;
    }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return true;
  } catch (err) {
    console.warn('[ScrollLearn:notes] clipboard fallback threw:', describeError(err));
    return false;
  }
  if (modernErr) {
    console.warn('[ScrollLearn:notes] clipboard write blocked:', describeError(modernErr));
  }
  return false;
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
      const data = (response.data && typeof response.data === 'object')
        ? response.data as {
            translation?: unknown;
            senses?: unknown;
            derivedForms?: unknown;
          }
        : {};
      const translation = typeof data.translation === 'string' ? data.translation : undefined;
      const senses = Array.isArray(data.senses) ? data.senses as DictionarySense[] : undefined;
      const derivedForms = Array.isArray(data.derivedForms) ? data.derivedForms as DerivedForm[] : undefined;
      console.log('[ScrollLearn:notes] save_note ok, clipboard:', copied, 'translation:', !!translation, 'senses:', senses?.length ?? 0, 'family:', derivedForms?.length ?? 0);
      showToast(text, { copied, translation, senses, derivedForms });
    });
  } catch (err) {
    console.warn('[ScrollLearn:notes] sendMessage threw:', err);
    showStatusToast('Save failed: extension context invalid', 'error');
  }
}

function attachListeners() {
  document.addEventListener('keydown', onPluckKeyDown, true);
  document.addEventListener('keyup', onPluckKeyUp, true);
  window.addEventListener('blur', onWindowBlur);
}

function detachListeners() {
  document.removeEventListener('keydown', onPluckKeyDown, true);
  document.removeEventListener('keyup', onPluckKeyUp, true);
  window.removeEventListener('blur', onWindowBlur);
  stopPluck();
}

// Floating action button that opens the Scroll Learn side panel. Positioned
// just above the toast stack baseline so an in-flight save toast doesn't
// occlude it. Inline-styled with `all: initial` so the host page CSS cannot
// hide or restyle it.
function ensureSidebarFab(): HTMLElement {
  const existing = document.getElementById('scrolllearn-sidebar-fab');
  if (existing) return existing;
  const fab = document.createElement('button');
  fab.id = 'scrolllearn-sidebar-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open Scroll Learn sidebar');
  fab.title = 'Open Scroll Learn sidebar';
  fab.style.cssText = [
    'all: initial',
    'box-sizing: border-box',
    'position: fixed',
    'right: 16px',
    'bottom: 88px',
    'z-index: 2147483646',
    'width: 44px',
    'height: 44px',
    'border-radius: 999px',
    'background: #1F1B16',
    'color: #FBF8F2',
    'display: inline-flex',
    'align-items: center',
    'justify-content: center',
    'box-shadow: 0 10px 24px rgba(0,0,0,0.28)',
    'cursor: pointer',
    'transition: transform 0.15s ease, box-shadow 0.15s ease',
  ].join(';');
  fab.innerHTML = [
    '<svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true" style="display:block">',
    '<rect x="14" y="16" width="36" height="3" fill="#FBF8F2" />',
    '<rect x="14" y="26" width="28" height="3" fill="#FBF8F2" />',
    '<rect x="14" y="36" width="32" height="3" fill="#FBF8F2" />',
    '<path d="M 50 12 Q 60 32 50 52" fill="none" stroke="#C96442" stroke-width="3" stroke-linecap="round" />',
    '<circle cx="50" cy="46" r="3" fill="#C96442" />',
    '</svg>',
  ].join('');
  fab.addEventListener('mouseenter', () => {
    fab.style.transform = 'translateY(-1px)';
    fab.style.boxShadow = '0 14px 28px rgba(0,0,0,0.32)';
  });
  fab.addEventListener('mouseleave', () => {
    fab.style.transform = '';
    fab.style.boxShadow = '0 10px 24px rgba(0,0,0,0.28)';
  });
  fab.addEventListener('click', e => {
    // Prevent the page from interpreting the click on its own elements.
    e.preventDefault();
    e.stopPropagation();
    try {
      chrome.runtime.sendMessage({ type: 'open_side_panel' }, response => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message ?? 'unknown';
          console.warn('[ScrollLearn:notes] open_side_panel failed:', msg);
          showStatusToast(`Sidebar failed: ${msg}`, 'error');
          return;
        }
        if (response && response.ok === false) {
          const errMsg = String(response.error ?? 'unknown');
          console.warn('[ScrollLearn:notes] open_side_panel error:', errMsg);
          showStatusToast(`Sidebar: ${errMsg}`, 'error');
        }
      });
    } catch (err) {
      console.warn('[ScrollLearn:notes] open_side_panel threw:', err);
      showStatusToast('Sidebar: extension context invalid. Reload the extension.', 'error');
    }
  });
  document.body.appendChild(fab);
  return fab;
}

function mountFab() {
  if (!document.body) {
    // Body may not exist yet on document_start; wait for DOMContentLoaded.
    document.addEventListener('DOMContentLoaded', () => {
      if (ctx.active) ensureSidebarFab();
    }, { once: true });
    return;
  }
  ensureSidebarFab();
}

function unmountFab() {
  const fab = document.getElementById('scrolllearn-sidebar-fab');
  fab?.remove();
}

function applyState() {
  const shouldBeActive = isAllowed();
  if (shouldBeActive && !ctx.active) {
    ctx.active = true;
    attachListeners();
    mountFab();
    console.log('[ScrollLearn:notes] capture ACTIVE on', normalizeHost(location.hostname));
  } else if (!shouldBeActive && ctx.active) {
    ctx.active = false;
    detachListeners();
    unmountFab();
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
