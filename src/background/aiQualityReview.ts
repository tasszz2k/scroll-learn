// Second-stage content filter. Posts that survived the keyword filter are
// forwarded here from the content script; we ask Gemini whether to hide each
// one. Verdicts are cached in memory (mirrored to chrome.storage.local) keyed
// by `${configHash}|${textHash}` so a learner re-scrolling the same feed pays
// no API cost. Fail-open everywhere: any error path returns hide:false so the
// keyword filter remains the single source of truth on the safety side.
//
// Shares the quota bookkeeping in src/common/gemini/quota.ts with every other
// AI surface: every call increments the per-model RPD/RPM counters that the
// Settings -> "API usage today" tile displays, and a 429 marks the model in
// cooldown so the next call rotates to the next model in the volume order
// (lite first -> flagships). When every pool is exhausted we fail open
// (hide:false) so heavy scrolling can't ever block on a long retry.

import type {
  AiQualityReviewMessage,
  AiQualityReviewResultData,
  AiReason,
  Response,
} from '../common/types';
import { STORAGE_KEYS } from '../common/types';
import { runGeminiApi } from '../common/gemini/api';
import { markRateLimited, pickModel, recordSuccess } from '../common/gemini/quota';
import { extractJsonObjectBlock } from '../dashboard/components/keywordSuggestPrompt';
import * as storage from '../common/storage';

// 'volume' walks the 500-RPD lite pool first regardless of the user's
// geminiAutoStrategy. Filter decisions don't need flagship quality and we
// don't want a scroll session to torch the 20-RPD quality pools.
const AI_FILTER_STRATEGY = 'volume' as const;
const TEMPERATURE = 0.0;
const MAX_TEXT_CHARS = 1200;
const CACHE_CAP = 500;
const CONCURRENCY = 3;
const QUEUE_CAP = 20;

// 32-bit djb2 -> 8-char hex. Stable across processes (no Math.random),
// shared between the content script and this module so cache lookups line up.
export function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function computeAiConfigHash(cfg: {
  hideAiSlop: boolean;
  hideSpam: boolean;
  hideSalesAds: boolean;
  hideLowQuality: boolean;
  extraInstructions: string;
}): string {
  const canon = [
    cfg.hideAiSlop ? 'A' : '',
    cfg.hideSpam ? 'S' : '',
    cfg.hideSalesAds ? 'D' : '',
    cfg.hideLowQuality ? 'L' : '',
    cfg.extraInstructions.trim(),
  ].join('|');
  return djb2Hex(canon);
}

function normalizeText(raw: string): string {
  return raw.normalize('NFC').trim().slice(0, MAX_TEXT_CHARS).toLowerCase().replace(/\s+/g, ' ');
}

export function computeTextHash(raw: string): string {
  return djb2Hex(normalizeText(raw));
}

export function buildReviewPrompt(
  text: string,
  cfg: AiQualityReviewMessage['promptConfig'],
): string {
  const criteria: string[] = [];
  if (cfg.hideAiSlop)     criteria.push('- "ai_slop": looks machine-generated, low-effort, generic, padded with filler.');
  if (cfg.hideSpam)       criteria.push('- "ai_spam": repetitive, mass-posted, unrelated promotional or noise content.');
  if (cfg.hideSalesAds)   criteria.push('- "ai_sales": primary purpose is to sell or promote a product or service.');
  if (cfg.hideLowQuality) criteria.push('- "ai_low_quality": poorly written, substanceless, clickbait, rage-bait without value.');
  const extra = cfg.extraInstructions.trim();
  if (extra) criteria.push(`- "ai_custom": matches the user's custom criteria: ${extra}`);

  return [
    'You are a content-quality filter for a social media feed. Decide whether to hide ONE post.',
    '',
    'HIDE the post if it matches ANY enabled category below. Use the quoted id as the "reason":',
    ...criteria,
    '',
    'Otherwise KEEP the post (return hide:false, omit reason). When in doubt, KEEP.',
    '',
    'POST TEXT',
    '---',
    text,
    '---',
    '',
    'Return strict JSON of exactly the form {"hide": true, "reason": "<id>"} or {"hide": false}.',
    'The reason MUST be one of: ai_slop, ai_spam, ai_sales, ai_low_quality, ai_custom.',
    'No prose, no code fences.',
  ].join('\n');
}

const VALID_REASONS = new Set<AiReason>(['ai_slop', 'ai_spam', 'ai_sales', 'ai_low_quality', 'ai_custom']);

function coerceReason(raw: unknown): AiReason {
  if (typeof raw === 'string' && VALID_REASONS.has(raw as AiReason)) {
    return raw as AiReason;
  }
  return 'ai_custom';
}

// ---------------------------------------------------------------------------
// LRU cache
// ---------------------------------------------------------------------------

interface Verdict { hide: boolean; reason?: AiReason; }

// Map preserves insertion order; deleting + re-inserting on hit gives us LRU.
const cache = new Map<string, Verdict>();
let cacheLoaded = false;
let cacheLoadPromise: Promise<void> | null = null;

interface StoredEntry { key: string; hide: boolean; reason?: AiReason; }

async function ensureCacheLoaded(): Promise<void> {
  if (cacheLoaded) return;
  if (cacheLoadPromise) return cacheLoadPromise;
  cacheLoadPromise = (async () => {
    try {
      const raw = await chrome.storage.local.get(STORAGE_KEYS.AI_QUALITY_CACHE);
      const stored = raw[STORAGE_KEYS.AI_QUALITY_CACHE];
      if (Array.isArray(stored)) {
        for (const entry of stored as StoredEntry[]) {
          if (entry && typeof entry.key === 'string' && typeof entry.hide === 'boolean') {
            const v: Verdict = { hide: entry.hide };
            if (entry.hide) v.reason = coerceReason(entry.reason);
            cache.set(entry.key, v);
          }
        }
      }
    } catch {
      // chrome.storage unavailable (unit tests) -> start empty
    } finally {
      cacheLoaded = true;
    }
  })();
  return cacheLoadPromise;
}

async function persistCache(): Promise<void> {
  try {
    const list: StoredEntry[] = [];
    for (const [key, v] of cache) {
      const entry: StoredEntry = { key, hide: v.hide };
      if (v.reason) entry.reason = v.reason;
      list.push(entry);
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.AI_QUALITY_CACHE]: list });
  } catch {
    // ignore -- cache is best-effort persistence
  }
}

function cacheGet(key: string): Verdict | undefined {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key)!;
  cache.delete(key);
  cache.set(key, v);
  return v;
}

function cacheSet(key: string, verdict: Verdict): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, verdict);
  while (cache.size > CACHE_CAP) {
    const first = cache.keys().next();
    if (first.done) break;
    cache.delete(first.value);
  }
}

// Test-only resets.
export function _resetCacheForTests(): void {
  cache.clear();
  cacheLoaded = false;
  cacheLoadPromise = null;
  inFlight.clear();
  active = 0;
  queue.length = 0;
}

// ---------------------------------------------------------------------------
// Concurrency-limited dispatch
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<Verdict>>();
let active = 0;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (active < CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  active--;
  const next = queue.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// Single review call (uncached path)
// ---------------------------------------------------------------------------

// Dependency seam so unit tests can swap the API without touching fetch.
type ApiCaller = typeof runGeminiApi;
let apiCaller: ApiCaller = runGeminiApi;
export function _setApiCallerForTests(fn: ApiCaller | null): void {
  apiCaller = fn ?? runGeminiApi;
}

// Picker seam for tests. Production uses pickModel from quota.ts so the AI
// filter shares the per-model RPD/RPM counters with every other AI surface.
type Picker = typeof pickModel;
let pickerImpl: Picker = pickModel;
export function _setPickerForTests(fn: Picker | null): void {
  pickerImpl = fn ?? pickModel;
}

type RecordSuccessFn = typeof recordSuccess;
let recordSuccessImpl: RecordSuccessFn = recordSuccess;
export function _setRecordSuccessForTests(fn: RecordSuccessFn | null): void {
  recordSuccessImpl = fn ?? recordSuccess;
}

type MarkRateLimitedFn = typeof markRateLimited;
let markRateLimitedImpl: MarkRateLimitedFn = markRateLimited;
export function _setMarkRateLimitedForTests(fn: MarkRateLimitedFn | null): void {
  markRateLimitedImpl = fn ?? markRateLimited;
}

async function callGemini(
  apiKey: string,
  text: string,
  cfg: AiQualityReviewMessage['promptConfig'],
): Promise<{ ok: true; verdict: Verdict } | { ok: false }> {
  const prompt = buildReviewPrompt(text, cfg);

  // Rotate through every model with remaining quota. Each 429 marks the
  // model in cooldown and the next pickerImpl call skips it, so a single
  // bounce-and-rotate clears within one loop without blocking on retry.
  while (true) {
    const model = await pickerImpl('auto', AI_FILTER_STRATEGY);
    if (!model) return { ok: false };

    const result = await apiCaller({
      apiKey,
      model,
      prompt,
      temperature: TEMPERATURE,
    });

    if (result.ok) {
      await recordSuccessImpl(model);
      const block = extractJsonObjectBlock(result.text);
      if (!block) return { ok: false };
      try {
        const parsed = JSON.parse(block) as { hide?: unknown; reason?: unknown };
        const hide = parsed.hide === true;
        const verdict: Verdict = { hide };
        if (hide) verdict.reason = coerceReason(parsed.reason);
        return { ok: true, verdict };
      } catch {
        return { ok: false };
      }
    }

    if (result.code === 'rate_limit') {
      await markRateLimitedImpl(model, result.retryDelayMs);
      continue;
    }
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

export async function handleAiQualityReview(
  message: AiQualityReviewMessage,
): Promise<Response<AiQualityReviewResultData>> {
  try {
    await ensureCacheLoaded();

    const settings = await storage.getSettings();
    const apiKey = settings.geminiApiKey?.trim();
    if (!apiKey) {
      return { ok: true, data: { hide: false, cached: false } };
    }

    const text = message.text.normalize('NFC').trim().slice(0, MAX_TEXT_CHARS);
    if (!text) {
      return { ok: true, data: { hide: false, cached: false } };
    }

    const textHash = djb2Hex(normalizeText(text));
    const key = `${message.configHash}|${textHash}`;

    const cached = cacheGet(key);
    if (cached !== undefined) {
      return {
        ok: true,
        data: { hide: cached.hide, cached: true, reason: cached.reason },
      };
    }

    const existing = inFlight.get(key);
    if (existing) {
      const v = await existing;
      return { ok: true, data: { hide: v.hide, cached: true, reason: v.reason } };
    }

    if (queue.length >= QUEUE_CAP) {
      // Overflow -> fail open without caching so the next call can retry.
      return { ok: true, data: { hide: false, cached: false } };
    }

    const promise: Promise<Verdict> = (async () => {
      await acquireSlot();
      try {
        const r = await callGemini(apiKey, text, message.promptConfig);
        if (!r.ok) return { hide: false };
        cacheSet(key, r.verdict);
        void persistCache();
        return r.verdict;
      } finally {
        releaseSlot();
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, promise);

    const verdict = await promise;
    return {
      ok: true,
      data: { hide: verdict.hide, cached: false, reason: verdict.reason },
    };
  } catch (err) {
    console.warn('[aiQualityReview] handler error:', err);
    return { ok: true, data: { hide: false, cached: false } };
  }
}
