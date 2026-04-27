import type { UpdateInfo, Response } from '../common/types';
import { STORAGE_KEYS } from '../common/types';
import { buildUpdateInfo, NATIVE_HOST_NAME } from '../common/updater';

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
  if (!force && existing && Date.now() - existing.checkedAt < sixHours) {
    return existing;
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
    setTimeout(() => chrome.runtime.reload(), 500);
    return { ok: true, data: { version: response.installed_version || info.latestVersion } };
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
