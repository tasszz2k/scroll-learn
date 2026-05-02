import { describe, it, expect } from 'vitest';
import {
  bucketUtcDay,
  bucketUtcMinute,
  hasCapacity,
  MODEL_QUOTAS,
  pickModelFromUsage,
  type GeminiApiUsage,
} from '../src/common/gemini/quota';
import type { GeminiApiModelId } from '../src/common/types';

const T0 = Date.UTC(2026, 4, 2, 12, 0, 0); // 2026-05-02 12:00 UTC

describe('bucket helpers', () => {
  it('formats UTC day as YYYY-MM-DD', () => {
    expect(bucketUtcDay(Date.UTC(2026, 0, 5, 23, 59, 0))).toBe('2026-01-05');
    expect(bucketUtcDay(Date.UTC(2024, 11, 31, 23, 59, 0))).toBe('2024-12-31');
  });

  it('rolls UTC minute on the next 60-second boundary', () => {
    const a = bucketUtcMinute(Date.UTC(2026, 4, 2, 12, 0, 30));
    const b = bucketUtcMinute(Date.UTC(2026, 4, 2, 12, 1, 5));
    expect(b - a).toBe(1);
  });
});

describe('hasCapacity', () => {
  it('returns false when dayCount has reached RPD', () => {
    const id: GeminiApiModelId = 'gemini-3-flash-preview';
    const entry = {
      dayBucket: bucketUtcDay(T0),
      dayCount: MODEL_QUOTAS[id].rpd,
      minuteBucket: bucketUtcMinute(T0),
      minuteCount: 0,
    };
    expect(hasCapacity(id, entry, T0)).toBe(false);
  });

  it('returns false when minuteCount has reached RPM', () => {
    const id: GeminiApiModelId = 'gemini-3.1-flash-lite-preview';
    const entry = {
      dayBucket: bucketUtcDay(T0),
      dayCount: 0,
      minuteBucket: bucketUtcMinute(T0),
      minuteCount: MODEL_QUOTAS[id].rpm,
    };
    expect(hasCapacity(id, entry, T0)).toBe(false);
  });

  it('returns false while a cooldown is in the future', () => {
    const id: GeminiApiModelId = 'gemini-2.5-flash';
    const entry = {
      dayBucket: bucketUtcDay(T0),
      dayCount: 0,
      minuteBucket: bucketUtcMinute(T0),
      minuteCount: 0,
      cooldownUntil: T0 + 30_000,
    };
    expect(hasCapacity(id, entry, T0)).toBe(false);
  });

  it('returns true under quota and outside cooldown', () => {
    const id: GeminiApiModelId = 'gemini-3-flash-preview';
    const entry = {
      dayBucket: bucketUtcDay(T0),
      dayCount: 1,
      minuteBucket: bucketUtcMinute(T0),
      minuteCount: 0,
    };
    expect(hasCapacity(id, entry, T0)).toBe(true);
  });
});

describe('pickModelFromUsage with auto strategies', () => {
  it("'volume' picks gemini-3.1-flash-lite first when fresh", () => {
    expect(pickModelFromUsage('auto', 'volume', {}, T0)).toBe('gemini-3.1-flash-lite-preview');
  });

  it("'quality' picks gemini-3-flash first when fresh", () => {
    expect(pickModelFromUsage('auto', 'quality', {}, T0)).toBe('gemini-3-flash-preview');
  });

  it("'volume' falls through to gemini-3-flash when the lite pool is exhausted", () => {
    const usage: GeminiApiUsage = {
      'gemini-3.1-flash-lite-preview': {
        dayBucket: bucketUtcDay(T0),
        dayCount: MODEL_QUOTAS['gemini-3.1-flash-lite-preview'].rpd,
        minuteBucket: bucketUtcMinute(T0),
        minuteCount: 0,
      },
    };
    expect(pickModelFromUsage('auto', 'volume', usage, T0)).toBe('gemini-3-flash-preview');
  });

  it("'quality' falls through past flagships into the lite pool", () => {
    const usage: GeminiApiUsage = {};
    for (const id of ['gemini-3-flash-preview', 'gemini-2.5-flash'] as const) {
      usage[id] = {
        dayBucket: bucketUtcDay(T0),
        dayCount: MODEL_QUOTAS[id].rpd,
        minuteBucket: bucketUtcMinute(T0),
        minuteCount: 0,
      };
    }
    expect(pickModelFromUsage('auto', 'quality', usage, T0)).toBe('gemini-3.1-flash-lite-preview');
  });

  it('skips models in cooldown', () => {
    const usage: GeminiApiUsage = {
      'gemini-3.1-flash-lite-preview': {
        dayBucket: bucketUtcDay(T0),
        dayCount: 0,
        minuteBucket: bucketUtcMinute(T0),
        minuteCount: 0,
        cooldownUntil: T0 + 30_000,
      },
    };
    expect(pickModelFromUsage('auto', 'volume', usage, T0)).toBe('gemini-3-flash-preview');
  });

  it('returns null when every model is exhausted', () => {
    const usage: GeminiApiUsage = {};
    for (const id of Object.keys(MODEL_QUOTAS) as GeminiApiModelId[]) {
      usage[id] = {
        dayBucket: bucketUtcDay(T0),
        dayCount: MODEL_QUOTAS[id].rpd,
        minuteBucket: bucketUtcMinute(T0),
        minuteCount: 0,
      };
    }
    expect(pickModelFromUsage('auto', 'volume', usage, T0)).toBeNull();
    expect(pickModelFromUsage('auto', 'quality', usage, T0)).toBeNull();
  });
});

describe('pickModelFromUsage with explicit pins', () => {
  it('returns the pinned model when it has capacity', () => {
    expect(pickModelFromUsage('gemini-3-flash-preview', 'volume', {}, T0)).toBe('gemini-3-flash-preview');
  });

  it('returns null for an exhausted pin (router falls through to web)', () => {
    const id: GeminiApiModelId = 'gemini-3-flash-preview';
    const usage: GeminiApiUsage = {
      [id]: {
        dayBucket: bucketUtcDay(T0),
        dayCount: MODEL_QUOTAS[id].rpd,
        minuteBucket: bucketUtcMinute(T0),
        minuteCount: 0,
      },
    };
    expect(pickModelFromUsage(id, 'volume', usage, T0)).toBeNull();
  });

  it('rolls a stale day bucket forward so yesterday cap does not bleed in', () => {
    const id: GeminiApiModelId = 'gemini-3-flash-preview';
    const yesterday = T0 - 24 * 60 * 60 * 1000;
    const usage: GeminiApiUsage = {
      [id]: {
        dayBucket: bucketUtcDay(yesterday),
        dayCount: MODEL_QUOTAS[id].rpd,
        minuteBucket: bucketUtcMinute(yesterday),
        minuteCount: 0,
      },
    };
    expect(pickModelFromUsage(id, 'volume', usage, T0)).toBe(id);
  });
});
