import type { UpdateInfo, Response } from '../common/types';
import { STORAGE_KEYS } from '../common/types';
import { buildUpdateInfo, compareVersions, getCurrentVersion, NATIVE_HOST_NAME } from '../common/updater';

export const ALARM_CHECK_UPDATE = 'check_for_update';

export async function getStoredUpdateInfo(): Promise<UpdateInfo | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.UPDATE_INFO);
  return (result[STORAGE_KEYS.UPDATE_INFO] as UpdateInfo) || null;
}

async function saveUpdateInfo(info: UpdateInfo): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.UPDATE_INFO]: info });
}

function setBadgeForUpdate(updateAvailable: boolean): void {
  if (!chrome.action) return;
  if (updateAvailable) {
    chrome.action.setBadgeText({ text: '!' }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: '#C96442' }).catch(() => {});
  } else {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  }
}

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const existing = await getStoredUpdateInfo();
  const sixHours = 6 * 60 * 60 * 1000;
  const liveVersion = getCurrentVersion();
  // Cached entries are still valid only if they were taken on the same
  // installed version. After an in-place update or a manual reload, the
  // cached `updateAvailable` flag becomes a lie, and a stale banner reappears.
  if (
    !force
    && existing
    && Date.now() - existing.checkedAt < sixHours
    && existing.currentVersion === liveVersion
  ) {
    return existing;
  }
  // Reconcile the cache against the current manifest before going to the
  // network: if the cache was for an older version and the latest release
  // it knew about is now installed (or older), we can clear the banner
  // immediately without waiting on the GitHub API.
  if (existing && existing.currentVersion !== liveVersion && existing.latestVersion) {
    if (compareVersions(existing.latestVersion, liveVersion) <= 0) {
      const reconciled: UpdateInfo = {
        ...existing,
        currentVersion: liveVersion,
        updateAvailable: false,
      };
      await saveUpdateInfo(reconciled);
      setBadgeForUpdate(false);
    }
  }
  const info = await buildUpdateInfo();
  await saveUpdateInfo(info);
  setBadgeForUpdate(info.updateAvailable);
  return info;
}

interface NativeHostResponse {
  ok: boolean;
  error?: string;
  installed_version?: string;
}

function sendNativeMessage(payload: object): Promise<NativeHostResponse> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response as NativeHostResponse);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function installUpdate(): Promise<Response<{ version: string }>> {
  const info = await getStoredUpdateInfo();
  if (!info?.downloadUrl || !info.latestVersion) {
    return { ok: false, error: 'No update download URL available. Run check first.' };
  }

  try {
    const response = await sendNativeMessage({
      action: 'install',
      download_url: info.downloadUrl,
      version: info.latestVersion,
    });
    if (!response?.ok) {
      return { ok: false, error: response?.error || 'Native helper returned no response. Is the helper installed?' };
    }
    setBadgeForUpdate(false);
    // Mark the stored info as up to date so the post-reload startup check
    // doesn't briefly resurface the "update available" banner from cache.
    const installedVersion = response.installed_version || info.latestVersion;
    await saveUpdateInfo({
      ...info,
      currentVersion: installedVersion,
      updateAvailable: false,
      checkedAt: Date.now(),
    });
    setTimeout(() => chrome.runtime.reload(), 500);
    return { ok: true, data: { version: installedVersion } };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('Specified native messaging host not found') || msg.includes('not found')) {
      return { ok: false, error: 'Native helper not installed. Run scripts/updater/install.sh first.' };
    }
    return { ok: false, error: msg };
  }
}

export function setupUpdateAlarm(): void {
  chrome.alarms.create(ALARM_CHECK_UPDATE, {
    periodInMinutes: 60 * 6,
    delayInMinutes: 1,
  });
}

export async function handleUpdateAlarm(): Promise<void> {
  try {
    await checkForUpdate();
  } catch (err) {
    console.error('[ScrollLearn] Update check failed:', err);
  }
}
