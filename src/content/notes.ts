// Notes content script: on allowlisted regular sites, mounts the shared
// pluck mode so the user can hold Option (Alt) and hover/click to capture
// text into bookmarks. The whole capture UX (listeners, hover outline,
// toast, save_note round-trip, sidebar FAB) lives in `src/common/pluckMode.ts`
// so it can also be reused from the dashboard / sidebar -- Chrome blocks
// content scripts from injecting into chrome-extension:// pages, so the
// dashboard mounts pluck mode itself rather than going through this file.
//
// This file's only job is the host-allowlist gate: load settings, decide if
// pluck should be active on this hostname, and mount/unmount accordingly
// when the allowlist changes.
//
// Local files (file://): Chrome only injects this script into file:// pages
// once the user enables "Allow access to file URLs". HTML/txt/md render as
// normal DOM, so pluck works directly (gated by `noteCaptureLocalFiles`).
// PDFs are rendered by Chrome's built-in out-of-process viewer, whose text is
// invisible to a content script, so instead of pluck we show a floating
// button that reopens the file in the in-extension PDF viewer.

import type { Settings } from '../common/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../common/types';
import { isHostAllowed } from '../common/allowlist';
import { mountPluckMode, type PluckHandle } from '../common/pluckMode';

const ctx: { settings: Settings; handle: PluckHandle | null } = {
  settings: { ...DEFAULT_SETTINGS },
  handle: null,
};

const PDF_BUTTON_ID = 'scrolllearn-open-pdf-viewer';

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^(www\.|m\.)/, '');
}

function isLocalFile(): boolean {
  return location.protocol === 'file:';
}

function isLocalPdf(): boolean {
  return isLocalFile() && /\.pdf$/i.test(location.pathname);
}

function isAllowed(): boolean {
  if (isLocalFile()) {
    // file:// pages have an empty hostname, so the regular host allowlist can
    // never match. Gate purely on the local-files opt-in instead. Chrome only
    // runs us here at all when file URL access is granted.
    return ctx.settings.noteCaptureLocalFiles;
  }
  const host = normalizeHost(location.hostname);
  if (!host) return false;
  // The extension's own host (chrome.runtime.id) is implicitly allowed by
  // isHostAllowed so the user never has to add the volatile extension id by
  // hand. In practice this never matters here because Chrome doesn't inject
  // content scripts into chrome-extension:// at all, but we thread the id
  // through for parity with the popup status indicator.
  return isHostAllowed(
    ctx.settings.noteCaptureAllowlist,
    host,
    chrome?.runtime?.id ?? null,
    ctx.settings.noteCaptureAllSites,
  );
}

// Floating "Open in ScrollLearn PDF viewer" button for local PDFs. Chrome's
// native viewer hides the text, so this is the entry point into our own
// viewer where selection + pluck work.
function showPdfButton() {
  if (document.getElementById(PDF_BUTTON_ID)) return;
  if (!document.body) return;

  const btn = document.createElement('button');
  btn.id = PDF_BUTTON_ID;
  btn.type = 'button';
  btn.textContent = 'Open with ScrollLearn';
  btn.style.cssText = [
    'all: initial',
    'position: fixed',
    'right: 16px',
    'bottom: 16px',
    'z-index: 2147483647',
    'display: inline-flex',
    'align-items: center',
    'gap: 6px',
    'padding: 10px 14px',
    'border-radius: 999px',
    'background: #c96442',
    'color: #ffffff',
    "font: 600 13px/1.2 'Segoe UI', system-ui, -apple-system, sans-serif",
    'box-shadow: 0 8px 22px rgba(0,0,0,0.28)',
    'cursor: pointer',
  ].join(';');

  btn.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ type: 'open_pdf_viewer', fileUrl: location.href });
    } catch (err) {
      console.warn('[ScrollLearn:notes] open_pdf_viewer failed:', err);
    }
  });

  document.body.appendChild(btn);
}

function removePdfButton() {
  document.getElementById(PDF_BUTTON_ID)?.remove();
}

function applyState() {
  // Local PDFs never get pluck (native viewer hides the text). Offer the
  // in-extension viewer button instead, gated by the same local-files opt-in.
  if (isLocalPdf()) {
    if (ctx.handle) {
      ctx.handle.unmount();
      ctx.handle = null;
    }
    if (ctx.settings.noteCaptureLocalFiles) {
      showPdfButton();
    } else {
      removePdfButton();
    }
    return;
  }

  const shouldBeActive = isAllowed();
  if (shouldBeActive && !ctx.handle) {
    ctx.handle = mountPluckMode();
    console.log('[ScrollLearn:notes] capture ACTIVE on', normalizeHost(location.hostname) || location.protocol);
  } else if (!shouldBeActive && ctx.handle) {
    ctx.handle.unmount();
    ctx.handle = null;
    console.log('[ScrollLearn:notes] capture INACTIVE on', normalizeHost(location.hostname) || location.protocol);
  } else if (!shouldBeActive) {
    console.log(
      '[ScrollLearn:notes] capture inactive - host not allowlisted',
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
