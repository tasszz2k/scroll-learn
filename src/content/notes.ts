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

import type { Settings } from '../common/types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from '../common/types';
import { isHostAllowed } from '../common/allowlist';
import { mountPluckMode, type PluckHandle } from '../common/pluckMode';

const ctx: { settings: Settings; handle: PluckHandle | null } = {
  settings: { ...DEFAULT_SETTINGS },
  handle: null,
};

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^(www\.|m\.)/, '');
}

function isAllowed(): boolean {
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
  );
}

function applyState() {
  const shouldBeActive = isAllowed();
  if (shouldBeActive && !ctx.handle) {
    ctx.handle = mountPluckMode({ fab: true });
    console.log('[ScrollLearn:notes] capture ACTIVE on', normalizeHost(location.hostname));
  } else if (!shouldBeActive && ctx.handle) {
    ctx.handle.unmount();
    ctx.handle = null;
    console.log('[ScrollLearn:notes] capture INACTIVE on', normalizeHost(location.hostname));
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
