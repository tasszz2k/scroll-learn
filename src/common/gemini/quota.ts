// Free-tier rate-limit bookkeeping for the Gemini API path.
//
// MODEL_QUOTAS captures the per-minute (RPM) and per-day (RPD) ceilings that
// Google AI Studio applies to a free-tier project. The numbers below were read
// from the user's actual project view (ai.google.dev/gemini-api/docs/rate-limits)
// and are HAND-CURATED -- do NOT regenerate from a model. Wrong numbers here
// silently strand learners on the slow web fallback even when the API still has
// capacity, or burn through quotas in ways that get the project flagged.
//
// Quotas are per-model, so a learner who switches across models can claim the
// SUM of per-day pools (~560 RPD across the four lite-flash entries below).
// The router's pickModel walks them in an order chosen by Settings ->
// "Auto strategy":
//   - 'volume' (default): biggest pool first (lite -> flagships) so the day's
//     budget lasts as long as possible.
//   - 'quality': flagships first (gemini-3-flash etc.) to spend the 20-RPD
//     pools on the day's first ~20 turns when the answer matters most, then
//     drop into the lite pool for the rest of the day.

import { STORAGE_KEYS, type GeminiApiModelId, type GeminiAutoStrategy, type GeminiModelChoice } from '../types';

export interface ModelQuota {
  label: string;
  rpm: number;
  rpd: number;
}

export const MODEL_QUOTAS: Record<GeminiApiModelId, ModelQuota> = {
  'gemini-3-flash-preview':        { label: 'gemini-3-flash-preview',        rpm: 5,  rpd: 20  },
  'gemini-2.5-flash':              { label: 'gemini-2.5-flash',              rpm: 5,  rpd: 20  },
  'gemini-2.5-flash-lite':         { label: 'gemini-2.5-flash-lite',         rpm: 10, rpd: 20  },
  'gemini-3.1-flash-lite-preview': { label: 'gemini-3.1-flash-lite-preview', rpm: 15, rpd: 500 },
};

// 'volume' burns the biggest daily pool first so the long-tail of a learner's
// day still has API capacity. 'quality' inverts that -- spend the flagships'
// 20 RPD on the early turns when an answer matters most, then drop into lite.
const AUTO_ORDER: Record<GeminiAutoStrategy, ReadonlyArray<GeminiApiModelId>> = {
  volume:  ['gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview',        'gemini-2.5-flash',              'gemini-2.5-flash-lite'],
  quality: ['gemini-3-flash-preview',        'gemini-2.5-flash',              'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite'],
};

export interface ModelUsageEntry {
  // YYYY-MM-DD UTC bucket. When a request arrives in a different bucket the
  // dayCount resets to 0.
  dayBucket: string;
  dayCount: number;
  // Unix-minute bucket (Math.floor(now / 60_000)). Resets minuteCount on roll.
  minuteBucket: number;
  minuteCount: number;
  // When set in the future, the model is in cooldown after a 429 (or a long
  // RetryInfo.retryDelay returned by the server).
  cooldownUntil?: number;
}

export type GeminiApiUsage = Partial<Record<GeminiApiModelId, ModelUsageEntry>>;

// Pure helpers exported so tests can pin bucket logic without touching storage.
export function bucketUtcDay(now: number): string {
  const d = new Date(now);
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function bucketUtcMinute(now: number): number {
  return Math.floor(now / 60_000);
}

function emptyEntry(now: number): ModelUsageEntry {
  return {
    dayBucket: bucketUtcDay(now),
    dayCount: 0,
    minuteBucket: bucketUtcMinute(now),
    minuteCount: 0,
  };
}

// Roll forward stale buckets so the caller never has to. Returns a fresh
// object so callers can mutate without aliasing storage.
function rollEntry(entry: ModelUsageEntry | undefined, now: number): ModelUsageEntry {
  const day = bucketUtcDay(now);
  const minute = bucketUtcMinute(now);
  if (!entry) return emptyEntry(now);
  const next: ModelUsageEntry = { ...entry };
  if (next.dayBucket !== day) {
    next.dayBucket = day;
    next.dayCount = 0;
  }
  if (next.minuteBucket !== minute) {
    next.minuteBucket = minute;
    next.minuteCount = 0;
  }
  if (next.cooldownUntil != null && next.cooldownUntil <= now) {
    delete next.cooldownUntil;
  }
  return next;
}

async function readUsage(): Promise<GeminiApiUsage> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  const stored = await chrome.storage.local.get(STORAGE_KEYS.GEMINI_API_USAGE);
  const raw = stored[STORAGE_KEYS.GEMINI_API_USAGE] as unknown;
  if (!raw || typeof raw !== 'object') return {};
  return raw as GeminiApiUsage;
}

async function writeUsage(usage: GeminiApiUsage): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.GEMINI_API_USAGE]: usage });
}

// Public read used by the Settings panel "API usage today" tile. Rolls stale
// buckets forward so the displayed dayCount is always correct.
export async function getUsage(now: number = Date.now()): Promise<GeminiApiUsage> {
  const raw = await readUsage();
  const out: GeminiApiUsage = {};
  for (const id of Object.keys(MODEL_QUOTAS) as GeminiApiModelId[]) {
    out[id] = rollEntry(raw[id], now);
  }
  return out;
}

// Increment counters after a successful API call. Called by the router on a
// 200 response (before parsing) so a parse failure doesn't double-count.
export async function recordSuccess(model: GeminiApiModelId, now: number = Date.now()): Promise<void> {
  const raw = await readUsage();
  const entry = rollEntry(raw[model], now);
  entry.dayCount += 1;
  entry.minuteCount += 1;
  raw[model] = entry;
  await writeUsage(raw);
}

// Mark a model as rate-limited until either the server-supplied retryDelay
// elapses or a default 65s window. The 65s default is intentionally just over
// one minute so an RPM bounce always clears by the next bucket roll.
export async function markRateLimited(
  model: GeminiApiModelId,
  retryDelayMs?: number,
  now: number = Date.now(),
): Promise<void> {
  const raw = await readUsage();
  const entry = rollEntry(raw[model], now);
  const cooldownMs = Math.max(retryDelayMs ?? 0, 65_000);
  entry.cooldownUntil = now + cooldownMs;
  raw[model] = entry;
  await writeUsage(raw);
}

// True if the model is below its RPM and RPD ceilings AND not currently in
// cooldown. Pure -- callers pass an already-rolled entry.
export function hasCapacity(
  id: GeminiApiModelId,
  entry: ModelUsageEntry,
  now: number = Date.now(),
): boolean {
  const q = MODEL_QUOTAS[id];
  if (entry.cooldownUntil != null && entry.cooldownUntil > now) return false;
  if (entry.dayCount >= q.rpd) return false;
  if (entry.minuteCount >= q.rpm) return false;
  return true;
}

// Pure variant used by tests so they don't have to mock chrome.storage.
export function pickModelFromUsage(
  preferred: GeminiModelChoice,
  strategy: GeminiAutoStrategy,
  usage: GeminiApiUsage,
  now: number = Date.now(),
): GeminiApiModelId | null {
  // A stale stored setting from an older version may carry a model id we no
  // longer recognise (e.g. an obsolete preview slug). Treat unknown ids as
  // 'auto' so the user isn't stranded on the slow web fallback after an
  // upgrade. The Settings dropdown will re-pin their choice next time they
  // touch the field.
  const known = preferred === 'auto' || (preferred in MODEL_QUOTAS);
  const effective: GeminiModelChoice = known ? preferred : 'auto';

  if (effective === 'auto') {
    for (const id of AUTO_ORDER[strategy]) {
      const entry = rollEntry(usage[id], now);
      if (hasCapacity(id, entry, now)) return id;
    }
    return null;
  }
  // Explicit pin: respect it iff still under quota; otherwise null so the
  // router falls through to web instead of silently switching models on the
  // learner.
  const entry = rollEntry(usage[effective], now);
  return hasCapacity(effective, entry, now) ? effective : null;
}

// Async wrapper used by the router. Reads storage once per call.
export async function pickModel(
  preferred: GeminiModelChoice,
  strategy: GeminiAutoStrategy,
  now: number = Date.now(),
): Promise<GeminiApiModelId | null> {
  const usage = await readUsage();
  return pickModelFromUsage(preferred, strategy, usage, now);
}
