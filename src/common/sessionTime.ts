// Pure derivations from the Stats.reviewHistory log. Used by Stats.tsx and
// covered by tests/sessionTime.test.ts. No chrome.* APIs, no React.
//
// "Session" model: cluster review timestamps that arrive within a 5-minute
// idle gap. Each cluster's duration is (last - first) plus a 30-second tail
// so a session containing a single review still counts. This is a pragmatic
// stand-in for time-on-task: each ReviewRecord already carries the per-card
// responseTimeMs, but cumulative responseTimeMs underestimates engagement
// because it excludes the time between cards (reading the back, deciding
// the grade, etc.). Idle-gap clustering captures that interstitial time.

import type { ReviewRecord } from './types';

const IDLE_GAP_MS = 5 * 60 * 1000;
const SINGLE_REVIEW_TAIL_MS = 30 * 1000;

export interface SessionWindow {
  from: number; // inclusive Unix ms
  to: number;   // exclusive Unix ms
}

function inWindow(ts: number, w: SessionWindow): boolean {
  return ts >= w.from && ts < w.to;
}

// Sort timestamps ascending without mutating the input.
function sortedTimestamps(history: ReviewRecord[]): number[] {
  const ts: number[] = new Array(history.length);
  for (let i = 0; i < history.length; i++) ts[i] = history[i].timestamp;
  ts.sort((a, b) => a - b);
  return ts;
}

// Total session ms across clusters whose first timestamp falls inside the
// window. A session anchored before the window is not counted (it belongs to
// the prior period).
export function sessionMsInWindow(
  history: ReviewRecord[],
  window: SessionWindow,
): number {
  const ts = sortedTimestamps(history);
  if (ts.length === 0) return 0;

  let total = 0;
  let clusterStart = ts[0];
  let clusterLast = ts[0];

  const flush = () => {
    if (!inWindow(clusterStart, window)) return;
    const span = clusterLast === clusterStart
      ? SINGLE_REVIEW_TAIL_MS
      : (clusterLast - clusterStart) + SINGLE_REVIEW_TAIL_MS;
    total += span;
  };

  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    if (t - clusterLast > IDLE_GAP_MS) {
      flush();
      clusterStart = t;
      clusterLast = t;
    } else {
      clusterLast = t;
    }
  }
  flush();
  return total;
}

// Window presets. All anchored to the local timezone of the running browser.
export function todayWindow(now: number): SessionWindow {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const from = d.getTime();
  return { from, to: from + 24 * 60 * 60 * 1000 };
}

// ISO week (Monday-anchored). getDay(): 0=Sun..6=Sat -> Mon offset is
// (day + 6) % 7.
export function weekWindow(now: number): SessionWindow {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const monOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - monOffset);
  const from = d.getTime();
  return { from, to: from + 7 * 24 * 60 * 60 * 1000 };
}

export function monthWindow(now: number): SessionWindow {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
  return { from, to };
}

export function yearWindow(now: number): SessionWindow {
  const d = new Date(now);
  const from = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
  const to = new Date(d.getFullYear() + 1, 0, 1, 0, 0, 0, 0).getTime();
  return { from, to };
}

// 24-bucket histogram of reviews by hour-of-day (0..23, local time).
export function reviewsByHour(
  history: ReviewRecord[],
  window: SessionWindow,
): number[] {
  const out = new Array<number>(24).fill(0);
  for (const r of history) {
    if (!inWindow(r.timestamp, window)) continue;
    const h = new Date(r.timestamp).getHours();
    out[h]++;
  }
  return out;
}

// 7-bucket histogram of reviews by day-of-week, Monday-first (Mon..Sun).
export function reviewsByDow(
  history: ReviewRecord[],
  window: SessionWindow,
): number[] {
  const out = new Array<number>(7).fill(0);
  for (const r of history) {
    if (!inWindow(r.timestamp, window)) continue;
    const idx = (new Date(r.timestamp).getDay() + 6) % 7;
    out[idx]++;
  }
  return out;
}

function localDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Per-day session minutes, keyed by local YYYY-MM-DD. A session that crosses
// midnight is attributed to the day it started in.
export function dailySessionMs(
  history: ReviewRecord[],
  window: SessionWindow,
): Map<string, number> {
  const out = new Map<string, number>();
  const ts = sortedTimestamps(history);
  if (ts.length === 0) return out;

  let clusterStart = ts[0];
  let clusterLast = ts[0];

  const flush = () => {
    if (!inWindow(clusterStart, window)) return;
    const span = clusterLast === clusterStart
      ? SINGLE_REVIEW_TAIL_MS
      : (clusterLast - clusterStart) + SINGLE_REVIEW_TAIL_MS;
    const key = localDateKey(clusterStart);
    out.set(key, (out.get(key) ?? 0) + span);
  };

  for (let i = 1; i < ts.length; i++) {
    const t = ts[i];
    if (t - clusterLast > IDLE_GAP_MS) {
      flush();
      clusterStart = t;
      clusterLast = t;
    } else {
      clusterLast = t;
    }
  }
  flush();
  return out;
}
