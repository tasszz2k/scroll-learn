// Local tracker for the user's daily ZeroGPU quota on Hugging Face Spaces.
//
// Hugging Face does NOT publish an authenticated endpoint for "minutes
// remaining today" -- the only programmatic signal is rate-limit headers on
// 429 responses (see https://huggingface.co/docs/hub/rate-limits) which
// only fire AFTER you're already throttled. The official quota for free
// accounts is 3.5 GPU minutes/day with the daily window resetting exactly
// 24 hours after first use
// (https://huggingface.co/docs/hub/en/spaces-zerogpu#usage-tiers).
//
// We mirror that policy locally:
//   * record per-call wall-clock time on every successful kokoro-api job
//   * roll over the day when (now - firstUseAt) >= 24h
//   * mark the quota exhausted immediately when a generation fails with a
//     "quota exceeded" message, so the UI doesn't keep advertising stale
//     "X min remaining" after the user has actually been cut off
//
// Estimates are deliberately approximate: ZeroGPU charges wall-clock time
// inside @spaces.GPU, which is roughly the audio duration for Kokoro
// (real-time on H200). We don't decode the WAV to read the precise length;
// `text.length / 25` is the "characters spoken per second" rule of thumb
// used in the kokoro-js README and matches observed Space output within
// ~10%.

// Free HF account. PRO is 25 min/day; bump this when we add a setting for it.
export const DEFAULT_DAILY_QUOTA_SEC = 3.5 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

interface QuotaState {
  firstUseAt: number; // ms epoch; 0 means "not started"
  consumedSec: number;
}

export interface ZeroGpuQuotaInfo {
  remainingSec: number;
  consumedSec: number;
  dailyQuotaSec: number;
  resetAt: number; // ms epoch; equals now when firstUseAt is 0
  exceeded: boolean;
}

const STORAGE_KEY = 'zeroGpuQuota';

async function readState(): Promise<QuotaState> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { firstUseAt: 0, consumedSec: 0 };
  }
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const raw = r[STORAGE_KEY];
    if (raw && typeof raw === 'object') {
      const s = raw as Partial<QuotaState>;
      return {
        firstUseAt: typeof s.firstUseAt === 'number' ? s.firstUseAt : 0,
        consumedSec: typeof s.consumedSec === 'number' ? s.consumedSec : 0,
      };
    }
  } catch {
    /* fall through to default */
  }
  return { firstUseAt: 0, consumedSec: 0 };
}

async function writeState(state: QuotaState): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  } catch {
    /* ignore -- storage is a soft dependency, nothing else fails when it's missing */
  }
}

function rolledOver(state: QuotaState, now: number): QuotaState {
  if (state.firstUseAt === 0) return state;
  return now - state.firstUseAt >= DAY_MS ? { firstUseAt: 0, consumedSec: 0 } : state;
}

function info(state: QuotaState, dailyQuotaSec: number, now: number): ZeroGpuQuotaInfo {
  const remainingSec = Math.max(0, dailyQuotaSec - state.consumedSec);
  const resetAt = state.firstUseAt > 0 ? state.firstUseAt + DAY_MS : now;
  return {
    remainingSec,
    consumedSec: state.consumedSec,
    dailyQuotaSec,
    resetAt,
    exceeded: remainingSec === 0 && state.firstUseAt > 0,
  };
}

export async function getZeroGpuQuotaInfo(
  dailyQuotaSec: number = DEFAULT_DAILY_QUOTA_SEC,
): Promise<ZeroGpuQuotaInfo> {
  const now = Date.now();
  const cur = rolledOver(await readState(), now);
  return info(cur, dailyQuotaSec, now);
}

export async function recordZeroGpuUsage(
  seconds: number,
  dailyQuotaSec: number = DEFAULT_DAILY_QUOTA_SEC,
): Promise<ZeroGpuQuotaInfo> {
  const now = Date.now();
  const cur = rolledOver(await readState(), now);
  const next: QuotaState = {
    firstUseAt: cur.firstUseAt || now,
    consumedSec: cur.consumedSec + Math.max(0, seconds),
  };
  await writeState(next);
  return info(next, dailyQuotaSec, now);
}

// Used when we see a "quota exceeded" error from the Space -- the user is
// definitely out, so clamp consumedSec to the cap. Doesn't re-arm
// firstUseAt unless this is the first call of the day.
export async function markZeroGpuExceeded(
  dailyQuotaSec: number = DEFAULT_DAILY_QUOTA_SEC,
): Promise<ZeroGpuQuotaInfo> {
  const now = Date.now();
  const cur = rolledOver(await readState(), now);
  const next: QuotaState = {
    firstUseAt: cur.firstUseAt || now,
    consumedSec: dailyQuotaSec,
  };
  await writeState(next);
  return info(next, dailyQuotaSec, now);
}

// Approximate the GPU seconds a synthesis call will consume, before sending
// the request. Kokoro generates ~25 characters/sec of audio at speed=1, and
// ZeroGPU charges wall-clock time inside @spaces.GPU which on Kokoro on H200
// is roughly real-time. Add a 0.5 sec floor so single-word lines aren't
// charged 0.
export function estimateGpuSecondsForText(text: string): number {
  return Math.max(0.5, text.length / 25);
}
