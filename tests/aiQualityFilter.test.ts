import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  computeAiConfigHash,
  computeTextHash,
  buildReviewPrompt,
  handleAiQualityReview,
  _setApiCallerForTests,
  _setPickerForTests,
  _setRecordSuccessForTests,
  _setMarkRateLimitedForTests,
  _resetCacheForTests,
} from '../src/background/aiQualityReview';
import type { ApiResult } from '../src/common/gemini/api';
import { DEFAULT_SETTINGS, STORAGE_KEYS, type GeminiApiModelId } from '../src/common/types';

// Minimal chrome.storage.local + chrome.runtime stub. The handler only touches
// chrome.storage.local (cache persistence) plus storage.getSettings (which goes
// through the same wrapper).
function installChromeStub(geminiApiKey: string) {
  const store: Record<string, unknown> = {
    [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, geminiApiKey },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | Record<string, unknown>) => {
          const ks = typeof keys === 'string'
            ? [keys]
            : Array.isArray(keys)
              ? keys
              : Object.keys(keys);
          const out: Record<string, unknown> = {};
          for (const k of ks) {
            if (k in store) out[k] = store[k];
          }
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const ks = Array.isArray(keys) ? keys : [keys];
          for (const k of ks) delete store[k];
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { id: 'test', lastError: undefined },
  };
  return store;
}

const baseConfig = {
  hideAiSlop: true,
  hideSpam: true,
  hideSalesAds: true,
  hideLowQuality: true,
  extraInstructions: '',
};

function installPickerStub(initialModel: GeminiApiModelId = 'gemini-3.1-flash-lite-preview') {
  const cooldowns = new Set<GeminiApiModelId>();
  const order: GeminiApiModelId[] = [
    'gemini-3.1-flash-lite-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ];
  _setPickerForTests(async () => {
    const start = order.indexOf(initialModel);
    for (let i = 0; i < order.length; i++) {
      const m = order[(start + i) % order.length];
      if (!cooldowns.has(m)) return m;
    }
    return null;
  });
  _setRecordSuccessForTests(async () => { /* no-op */ });
  _setMarkRateLimitedForTests(async (m) => { cooldowns.add(m); });
  return { cooldowns };
}

afterEach(() => {
  _resetCacheForTests();
  _setApiCallerForTests(null);
  _setPickerForTests(null);
  _setRecordSuccessForTests(null);
  _setMarkRateLimitedForTests(null);
  vi.restoreAllMocks();
});

describe('computeAiConfigHash', () => {
  it('produces stable hashes for identical configs', () => {
    const a = computeAiConfigHash(baseConfig);
    const b = computeAiConfigHash({ ...baseConfig });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('differs when any category toggle flips', () => {
    const a = computeAiConfigHash(baseConfig);
    const flipped = computeAiConfigHash({ ...baseConfig, hideSpam: false });
    expect(a).not.toBe(flipped);
  });

  it('differs by extraInstructions content but ignores surrounding whitespace', () => {
    const empty = computeAiConfigHash(baseConfig);
    const filled = computeAiConfigHash({ ...baseConfig, extraInstructions: 'hide crypto' });
    const padded = computeAiConfigHash({ ...baseConfig, extraInstructions: '  hide crypto  ' });
    expect(filled).not.toBe(empty);
    expect(filled).toBe(padded);
  });
});

describe('computeTextHash', () => {
  it('is whitespace- and case-insensitive', () => {
    const a = computeTextHash('Hello   WORLD');
    const b = computeTextHash('hello world');
    expect(a).toBe(b);
  });

  it('changes when text content changes', () => {
    expect(computeTextHash('one')).not.toBe(computeTextHash('two'));
  });
});

describe('buildReviewPrompt', () => {
  it('includes only enabled criteria lines', () => {
    const prompt = buildReviewPrompt('post text here', {
      ...baseConfig,
      hideSpam: false,
      hideLowQuality: false,
    });
    expect(prompt).toContain('"ai_slop"');
    expect(prompt).toContain('"ai_sales"');
    expect(prompt).not.toContain('"ai_spam"');
    expect(prompt).not.toContain('"ai_low_quality"');
    expect(prompt).toContain('post text here');
  });

  it('appends extra instructions when provided', () => {
    const prompt = buildReviewPrompt('x', { ...baseConfig, extraInstructions: '  no crypto  ' });
    expect(prompt).toContain('"ai_custom"');
    expect(prompt).toContain('no crypto');
  });

  it('asks for the reason field in the response JSON', () => {
    const prompt = buildReviewPrompt('y', baseConfig);
    expect(prompt).toContain('"reason"');
    expect(prompt).toMatch(/ai_slop.*ai_spam.*ai_sales.*ai_low_quality.*ai_custom/s);
  });
});

describe('handleAiQualityReview', () => {
  beforeEach(() => {
    _resetCacheForTests();
    installPickerStub();
  });

  it('returns hide:false when no API key is set', async () => {
    installChromeStub('');
    const calls: number[] = [];
    _setApiCallerForTests(async (): Promise<ApiResult> => {
      calls.push(1);
      return { ok: true, text: '{"hide":true,"reason":"ai_spam"}' };
    });
    const r = await handleAiQualityReview({
      type: 'ai_quality_review',
      text: 'whatever',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data?.hide).toBe(false);
      expect(r.data?.cached).toBe(false);
      expect(r.data?.reason).toBeUndefined();
    }
    expect(calls.length).toBe(0);
  });

  it('returns hide:true with reason and caches the verdict', async () => {
    installChromeStub('key-123');
    let calls = 0;
    _setApiCallerForTests(async (): Promise<ApiResult> => {
      calls++;
      return { ok: true, text: '{"hide": true, "reason": "ai_sales"}' };
    });

    const msg = {
      type: 'ai_quality_review' as const,
      text: 'sample post',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    };

    const first = await handleAiQualityReview(msg);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.data?.hide).toBe(true);
      expect(first.data?.cached).toBe(false);
      expect(first.data?.reason).toBe('ai_sales');
    }

    const second = await handleAiQualityReview(msg);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.data?.hide).toBe(true);
      expect(second.data?.cached).toBe(true);
      expect(second.data?.reason).toBe('ai_sales');
    }

    expect(calls).toBe(1);
  });

  it('coerces unknown reason values to ai_custom', async () => {
    installChromeStub('key-123');
    _setApiCallerForTests(async (): Promise<ApiResult> => ({
      ok: true,
      text: '{"hide": true, "reason": "weird_unknown_value"}',
    }));
    const r = await handleAiQualityReview({
      type: 'ai_quality_review',
      text: 'mystery',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    });
    if (r.ok) expect(r.data?.reason).toBe('ai_custom');
  });

  it('returns hide:false and caches when model says keep', async () => {
    installChromeStub('key-123');
    let calls = 0;
    _setApiCallerForTests(async (): Promise<ApiResult> => {
      calls++;
      return { ok: true, text: '```json\n{"hide": false}\n```' };
    });

    const msg = {
      type: 'ai_quality_review' as const,
      text: 'fine post',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    };

    const first = await handleAiQualityReview(msg);
    if (first.ok) {
      expect(first.data?.hide).toBe(false);
      expect(first.data?.reason).toBeUndefined();
    }
    const second = await handleAiQualityReview(msg);
    if (second.ok) {
      expect(second.data?.hide).toBe(false);
      expect(second.data?.cached).toBe(true);
      expect(second.data?.reason).toBeUndefined();
    }
    expect(calls).toBe(1);
  });

  it('does not cache malformed model output (transient failure)', async () => {
    installChromeStub('key-123');
    let calls = 0;
    _setApiCallerForTests(async (): Promise<ApiResult> => {
      calls++;
      return { ok: true, text: 'no json at all' };
    });
    const msg = {
      type: 'ai_quality_review' as const,
      text: 'whatever',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    };
    const first = await handleAiQualityReview(msg);
    if (first.ok) {
      expect(first.data?.hide).toBe(false);
      expect(first.data?.cached).toBe(false);
    }
    const second = await handleAiQualityReview(msg);
    if (second.ok) expect(second.data?.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it('rotates models on rate-limit and never caches the failure', async () => {
    installChromeStub('key-123');
    let calls = 0;
    _setApiCallerForTests(async (): Promise<ApiResult> => {
      calls++;
      return { ok: false, code: 'rate_limit', error: 'quota' };
    });
    const msg = {
      type: 'ai_quality_review' as const,
      text: 'whatever',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    };
    const r = await handleAiQualityReview(msg);
    if (r.ok) expect(r.data).toEqual({ hide: false, cached: false });
    // Every model marked rate-limited; loop tries each exactly once.
    expect(calls).toBe(4);
    // Second handler call: every model in cooldown, picker returns null,
    // apiCaller is not invoked again; verdict still uncached.
    const r2 = await handleAiQualityReview(msg);
    if (r2.ok) expect(r2.data?.cached).toBe(false);
    expect(calls).toBe(4);
  });

  it('re-queries when configHash changes (cache key differs)', async () => {
    installChromeStub('key-123');
    let calls = 0;
    _setApiCallerForTests(async (): Promise<ApiResult> => {
      calls++;
      return { ok: true, text: '{"hide":true}' };
    });
    const text = 'shared post';
    const c1 = computeAiConfigHash(baseConfig);
    const c2 = computeAiConfigHash({ ...baseConfig, hideSpam: false });
    await handleAiQualityReview({ type: 'ai_quality_review', text, configHash: c1, promptConfig: baseConfig });
    await handleAiQualityReview({
      type: 'ai_quality_review',
      text,
      configHash: c2,
      promptConfig: { ...baseConfig, hideSpam: false },
    });
    expect(calls).toBe(2);
  });

  // Flush enough microtasks for the handler to walk past chrome.storage.local
  // and the slot acquisition before the test asserts on call counts.
  async function flushMicrotasks() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  // Yield a macrotask. Needed to drain microtasks between sub-test phases
  // when a single flush isn't enough.
  function nextTick() {
    return new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  it('shares one fetch across concurrent calls for the same key', async () => {
    installChromeStub('key-123');
    let calls = 0;
    let resolveApi: ((r: ApiResult) => void) | null = null;
    _setApiCallerForTests((): Promise<ApiResult> => {
      calls++;
      return new Promise<ApiResult>(resolve => { resolveApi = resolve; });
    });

    const msg = {
      type: 'ai_quality_review' as const,
      text: 'concurrent',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    };
    const p1 = handleAiQualityReview(msg);
    const p2 = handleAiQualityReview(msg);
    await flushMicrotasks();
    expect(calls).toBe(1);
    resolveApi!({ ok: true, text: '{"hide":true,"reason":"ai_slop"}' });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok) {
      expect(r1.data?.hide).toBe(true);
      expect(r1.data?.reason).toBe('ai_slop');
    }
    if (r2.ok) {
      expect(r2.data?.hide).toBe(true);
      expect(r2.data?.reason).toBe('ai_slop');
    }
  });

  it('records success on the picked model so the usage panel updates', async () => {
    installChromeStub('key-123');
    const recorded: GeminiApiModelId[] = [];
    _setRecordSuccessForTests(async (m) => { recorded.push(m); });
    _setApiCallerForTests(async (): Promise<ApiResult> => ({
      ok: true,
      text: '{"hide": false}',
    }));
    await handleAiQualityReview({
      type: 'ai_quality_review',
      text: 'fresh',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    });
    expect(recorded).toEqual(['gemini-3.1-flash-lite-preview']);
  });

  it('falls back to a flagship model after lite-pool rate-limits', async () => {
    installChromeStub('key-123');
    let calls = 0;
    const seen: GeminiApiModelId[] = [];
    _setApiCallerForTests(async (spec): Promise<ApiResult> => {
      calls++;
      seen.push(spec.model);
      if (spec.model === 'gemini-3.1-flash-lite-preview') {
        return { ok: false, code: 'rate_limit', error: '429' };
      }
      return { ok: true, text: '{"hide":true,"reason":"ai_slop"}' };
    });
    const r = await handleAiQualityReview({
      type: 'ai_quality_review',
      text: 'fall-through',
      configHash: computeAiConfigHash(baseConfig),
      promptConfig: baseConfig,
    });
    expect(calls).toBe(2);
    expect(seen[0]).toBe('gemini-3.1-flash-lite-preview');
    expect(seen[1]).toBe('gemini-3-flash-preview');
    if (r.ok) {
      expect(r.data?.hide).toBe(true);
      expect(r.data?.reason).toBe('ai_slop');
    }
  });

  it('caps concurrent in-flight API calls', async () => {
    installChromeStub('key-123');
    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    _setApiCallerForTests(() => {
      active++;
      if (active > peak) peak = active;
      return new Promise<ApiResult>(resolve => {
        pending.push(() => {
          active--;
          resolve({ ok: true, text: '{"hide":false}' });
        });
      });
    });

    const cfg = computeAiConfigHash(baseConfig);
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 8; i++) {
      promises.push(handleAiQualityReview({
        type: 'ai_quality_review',
        text: `post-${i}`,
        configHash: cfg,
        promptConfig: baseConfig,
      }));
    }

    // Drain one entry at a time so the cap can be checked between cascades.
    for (let safety = 0; safety < 200; safety++) {
      await nextTick();
      expect(peak).toBeLessThanOrEqual(3);
      if (pending.length === 0 && active === 0) break;
      if (pending.length > 0) pending.shift()!();
    }
    await Promise.all(promises);
    expect(peak).toBeLessThanOrEqual(3);
  });
});
