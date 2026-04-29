import { describe, expect, it } from 'vitest';
import {
  dailySessionMs,
  monthWindow,
  reviewsByDow,
  reviewsByHour,
  sessionMsInWindow,
  todayWindow,
  weekWindow,
  yearWindow,
  type SessionWindow,
} from '../src/common/sessionTime';
import type { ReviewRecord } from '../src/common/types';

function rec(timestamp: number): ReviewRecord {
  return { cardId: 'c1', deckId: 'd1', timestamp, grade: 2, responseTimeMs: 0 };
}

const HOUR = 3_600_000;
const MIN = 60_000;
const SEC = 1_000;

const wideOpen: SessionWindow = { from: 0, to: Number.MAX_SAFE_INTEGER };

describe('sessionMsInWindow', () => {
  it('returns 0 for empty history', () => {
    expect(sessionMsInWindow([], wideOpen)).toBe(0);
  });

  it('counts a single review as 30 seconds', () => {
    const t = Date.UTC(2026, 3, 15, 10, 0, 0);
    expect(sessionMsInWindow([rec(t)], wideOpen)).toBe(30 * SEC);
  });

  it('clusters two reviews 1 minute apart into one session', () => {
    const t = Date.UTC(2026, 3, 15, 10, 0, 0);
    const ms = sessionMsInWindow([rec(t), rec(t + 60 * SEC)], wideOpen);
    // span 60s + 30s tail
    expect(ms).toBe(60 * SEC + 30 * SEC);
  });

  it('splits two reviews 30 minutes apart into two sessions', () => {
    const t = Date.UTC(2026, 3, 15, 10, 0, 0);
    const ms = sessionMsInWindow([rec(t), rec(t + 30 * MIN)], wideOpen);
    // 30s + 30s
    expect(ms).toBe(60 * SEC);
  });

  it('excludes sessions whose start falls outside the window', () => {
    const inside = Date.UTC(2026, 3, 15, 10, 0, 0);
    const outside = inside - 24 * HOUR;
    const window: SessionWindow = { from: inside - HOUR, to: inside + HOUR };
    const ms = sessionMsInWindow([rec(outside), rec(inside)], window);
    expect(ms).toBe(30 * SEC);
  });

  it('treats reviews exactly 5 minutes apart as one session (boundary)', () => {
    const t = Date.UTC(2026, 3, 15, 10, 0, 0);
    const ms = sessionMsInWindow([rec(t), rec(t + 5 * MIN)], wideOpen);
    expect(ms).toBe(5 * MIN + 30 * SEC);
  });

  it('does not mutate the input array order', () => {
    const t = Date.UTC(2026, 3, 15, 10, 0, 0);
    const history = [rec(t + 60 * SEC), rec(t)];
    const snapshot = history.map(r => r.timestamp);
    sessionMsInWindow(history, wideOpen);
    expect(history.map(r => r.timestamp)).toEqual(snapshot);
  });
});

describe('reviewsByHour / reviewsByDow', () => {
  it('buckets boundary times correctly', () => {
    // Local time fields drive the buckets, so we build dates with the
    // running browser's local TZ.
    const midnight = new Date(2026, 3, 15, 0, 0, 0).getTime();    // Wednesday
    const lastSec = new Date(2026, 3, 15, 23, 59, 59).getTime();
    const sunday = new Date(2026, 3, 19, 12, 0, 0).getTime();
    const monday = new Date(2026, 3, 20, 12, 0, 0).getTime();

    const hours = reviewsByHour(
      [rec(midnight), rec(lastSec), rec(sunday), rec(monday)],
      wideOpen,
    );
    expect(hours).toHaveLength(24);
    expect(hours[0]).toBe(1);
    expect(hours[23]).toBe(1);
    expect(hours[12]).toBe(2);

    const dow = reviewsByDow([rec(sunday), rec(monday)], wideOpen);
    expect(dow).toHaveLength(7);
    // Mon-first: [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
    expect(dow[0]).toBe(1); // monday
    expect(dow[6]).toBe(1); // sunday
  });

  it('respects the window', () => {
    const t = new Date(2026, 3, 15, 10, 0, 0).getTime();
    const window: SessionWindow = { from: t - HOUR, to: t + HOUR };
    const hours = reviewsByHour(
      [rec(t), rec(t - 24 * HOUR), rec(t + 24 * HOUR)],
      window,
    );
    expect(hours.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('dailySessionMs', () => {
  it('keys are local YYYY-MM-DD', () => {
    const t = new Date(2026, 3, 15, 10, 0, 0).getTime();
    const map = dailySessionMs([rec(t)], wideOpen);
    const expectedKey = `2026-04-15`;
    expect([...map.keys()]).toEqual([expectedKey]);
    expect(map.get(expectedKey)).toBe(30 * SEC);
  });

  it('attributes a session to its starting day even if reviews cross midnight', () => {
    const start = new Date(2026, 3, 15, 23, 58, 0).getTime();
    const end = start + 3 * MIN; // crosses midnight
    const map = dailySessionMs([rec(start), rec(end)], wideOpen);
    expect([...map.keys()]).toEqual(['2026-04-15']);
    expect(map.get('2026-04-15')).toBe(3 * MIN + 30 * SEC);
  });

  it('returns an empty map for empty history', () => {
    expect(dailySessionMs([], wideOpen).size).toBe(0);
  });
});

describe('window presets', () => {
  it('todayWindow covers exactly 24h from local midnight', () => {
    const now = new Date(2026, 3, 15, 14, 30, 0).getTime();
    const w = todayWindow(now);
    expect(w.to - w.from).toBe(24 * HOUR);
    expect(new Date(w.from).getHours()).toBe(0);
    expect(new Date(w.from).getDate()).toBe(15);
  });

  it('weekWindow is Monday-anchored, 7 days long', () => {
    // 2026-04-15 is a Wednesday in any TZ that has consistent Gregorian days.
    const now = new Date(2026, 3, 15, 14, 30, 0).getTime();
    const w = weekWindow(now);
    expect(w.to - w.from).toBe(7 * 24 * HOUR);
    expect(new Date(w.from).getDay()).toBe(1); // Monday
  });

  it('monthWindow spans the calendar month', () => {
    const now = new Date(2026, 3, 15, 14, 30, 0).getTime();
    const w = monthWindow(now);
    expect(new Date(w.from).getDate()).toBe(1);
    expect(new Date(w.from).getMonth()).toBe(3);
    expect(new Date(w.to).getMonth()).toBe(4);
    expect(new Date(w.to).getDate()).toBe(1);
  });

  it('yearWindow spans the calendar year', () => {
    const now = new Date(2026, 6, 15, 14, 30, 0).getTime();
    const w = yearWindow(now);
    expect(new Date(w.from).getFullYear()).toBe(2026);
    expect(new Date(w.from).getMonth()).toBe(0);
    expect(new Date(w.to).getFullYear()).toBe(2027);
  });
});
