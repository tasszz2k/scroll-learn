import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  Stats as StatsType,
  Deck,
  Card,
  Grade,
  Note,
  DailyStats,
  Settings,
  AiHideStats,
  AiReason,
} from '../../common/types';
import { AI_REASONS, STORAGE_KEYS, emptyAiHideStats } from '../../common/types';
import EditorialHeader from './EditorialHeader';
import { calculateRetentionRate } from '../../background/scheduler';
import {
  dailySessionMs,
  monthWindow,
  reviewsByDow,
  reviewsByHour,
  sessionMsInWindow,
  todayWindow,
  weekWindow,
  type SessionWindow,
} from '../../common/sessionTime';

interface StatsProps {
  stats: StatsType;
  decks: Deck[];
  cards: Card[];
  notes: Note[];
  settings: Settings | null;
}

const DAY_MS = 86_400_000;

const numberFmt = new Intl.NumberFormat('en-US').format;

type Range = '30d' | 'quarter' | 'all';

function rangeDays(range: Range): number {
  if (range === '30d') return 30;
  if (range === 'quarter') return 90;
  return 365;
}

function rangeWindow(range: Range, now: number): SessionWindow {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(end.getDate() - rangeDays(range) + 1);
  start.setHours(0, 0, 0, 0);
  return { from: start.getTime(), to: end.getTime() + 1 };
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
}

function fmtMinutes(ms: number): string {
  if (ms <= 0) return '0 min';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function fmtSecondsToMin(sec: number): string {
  return fmtMinutes(sec * 1000);
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Filter dailyStats entries whose date falls inside [from, to). The date
// field is local YYYY-MM-DD, so we anchor at noon for an unambiguous compare.
function dailyInWindow(daily: DailyStats[], window: SessionWindow): DailyStats[] {
  return daily.filter(d => {
    const ts = new Date(`${d.date}T12:00:00`).getTime();
    return ts >= window.from && ts < window.to;
  });
}

function partOfDay(idx: number): string {
  if (idx < 5 || idx >= 22) return 'late at night';
  if (idx < 12) return 'in the morning';
  if (idx < 17) return 'in the afternoon';
  return 'in the evening';
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface RecapAgg {
  reviews: number;
  correct: number;
  practiceMs: number;
}

function aggregate(entries: DailyStats[]): RecapAgg {
  let reviews = 0, correct = 0, practiceMs = 0;
  for (const d of entries) {
    reviews += d.reviews;
    correct += d.correct;
    practiceMs += d.practiceMs ?? 0;
  }
  return { reviews, correct, practiceMs };
}

function deltaLabel(current: number, prior: number, unit: string): string {
  if (prior === 0 && current === 0) return 'Start your streak today.';
  if (prior === 0) return `+${numberFmt(current)} ${unit} (new)`;
  const diff = current - prior;
  const pct = Math.round((diff / prior) * 100);
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${numberFmt(diff)} ${unit} (${sign}${pct}% vs prior period)`;
}

type KeywordView = 'all' | 'by-group';

const AI_REASON_LABELS: Record<AiReason, string> = {
  ai_slop: 'AI slop',
  ai_spam: 'Spam',
  ai_sales: 'Sales / Ads',
  ai_low_quality: 'Low quality',
  ai_custom: 'Custom rule',
};

export default function Stats({ stats, decks, cards, notes, settings }: StatsProps) {
  const [range, setRange] = useState<Range>('30d');
  const [keywordView, setKeywordView] = useState<KeywordView>('by-group');
  const [now] = useState(() => Date.now());

  // AI quality filter stats. Loaded via message and kept live via
  // chrome.storage.onChanged so the panel ticks up while the user scrolls a
  // social feed in another tab.
  const [aiHideStats, setAiHideStats] = useState<AiHideStats>(() => emptyAiHideStats());
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'get_ai_hide_stats' });
        if (cancelled) return;
        if (resp?.ok && resp.data) setAiHideStats(resp.data as AiHideStats);
      } catch {
        // SW asleep -- leave defaults; live-sync will fill in.
      }
    }
    void load();
    function onChanged(changes: { [key: string]: chrome.storage.StorageChange }, area: string) {
      if (area !== 'local') return;
      if (!(STORAGE_KEYS.AI_HIDE_STATS in changes)) return;
      const next = changes[STORAGE_KEYS.AI_HIDE_STATS]?.newValue as AiHideStats | undefined;
      if (next) setAiHideStats({ total: { ...emptyAiHideStats().total, ...next.total }, daily: next.daily ?? [] });
    }
    try {
      chrome.storage.onChanged.addListener(onChanged);
    } catch {
      // chrome.storage unavailable in some test contexts.
    }
    return () => {
      cancelled = true;
      try { chrome.storage.onChanged.removeListener(onChanged); } catch { /* ignore */ }
    };
  }, []);

  // ----- Big numbers --------------------------------------------------------
  const totalCards = cards.length;
  const totalReviews = stats.totalReviews;
  const accuracyPct = Math.round(stats.averageAccuracy * 100);
  const currentStreak = stats.currentStreak;
  const bestStreak = stats.longestStreak;

  const cardsThisWeek = useMemo(
    () => cards.filter(c => (c.createdAt ?? 0) > now - 7 * DAY_MS).length,
    [cards, now],
  );

  // Retention is the share of recent reviews graded >= 2. We can't derive it
  // from per-card `repetitions` because that field resets to 0 on each lapse,
  // making a deck-level `1 - lapses/repetitions` arithmetically broken.
  const retentionWindowDays = 30;
  const recentReviewsCount = useMemo(() => {
    const cutoff = now - retentionWindowDays * DAY_MS;
    return stats.reviewHistory.filter(r => r.timestamp >= cutoff).length;
  }, [stats.reviewHistory, now]);
  const retentionRate = useMemo(
    () => calculateRetentionRate(stats.reviewHistory, retentionWindowDays),
    [stats.reviewHistory],
  );
  const retentionPct = Math.round(retentionRate * 100);
  const totalReps = recentReviewsCount;

  // ----- Range window for sections that follow it ---------------------------
  const window = useMemo(() => rangeWindow(range, now), [range, now]);

  // Time studied across the selected range. Prefer the live reviewHistory
  // (clusters reflect actual session shape) and fall back to dailyStats.practiceMs
  // for days outside the 1000-record history cap.
  const timeStudiedMs = useMemo(() => {
    const fromHistory = sessionMsInWindow(stats.reviewHistory, window);
    if (fromHistory > 0) return fromHistory;
    let ms = 0;
    for (const d of dailyInWindow(stats.dailyStats, window)) ms += d.practiceMs ?? 0;
    return ms;
  }, [stats.reviewHistory, stats.dailyStats, window]);

  // ----- Recap windows (always today / week / month) ------------------------
  const recap = useMemo(() => {
    const today = todayWindow(now);
    const week = weekWindow(now);
    const month = monthWindow(now);
    const priorWeek: SessionWindow = { from: week.from - (week.to - week.from), to: week.from };
    const priorMonth: SessionWindow = { from: month.from - (month.to - month.from), to: month.from };

    const todayKey = localDateKey(new Date(now));
    const todayDaily = stats.dailyStats.find(d => d.date === todayKey);
    const todayAgg: RecapAgg = {
      reviews: todayDaily?.reviews ?? 0,
      correct: todayDaily?.correct ?? 0,
      practiceMs: todayDaily?.practiceMs ?? sessionMsInWindow(stats.reviewHistory, today),
    };
    const weekAgg = aggregate(dailyInWindow(stats.dailyStats, week));
    const monthAgg = aggregate(dailyInWindow(stats.dailyStats, month));
    const priorWeekAgg = aggregate(dailyInWindow(stats.dailyStats, priorWeek));
    const priorMonthAgg = aggregate(dailyInWindow(stats.dailyStats, priorMonth));

    // Prefer history-based session ms when available so empty-history days
    // don't undercount on devices that just gained the practiceMs field.
    weekAgg.practiceMs = Math.max(weekAgg.practiceMs, sessionMsInWindow(stats.reviewHistory, week));
    monthAgg.practiceMs = Math.max(monthAgg.practiceMs, sessionMsInWindow(stats.reviewHistory, month));

    return { todayAgg, weekAgg, monthAgg, priorWeekAgg, priorMonthAgg };
  }, [stats.reviewHistory, stats.dailyStats, now]);

  // ----- Review history bars (existing) -------------------------------------
  const days = useMemo(() => {
    const out: { date: string; reviews: number; isToday: boolean }[] = [];
    const map = new Map<string, number>();
    for (const d of stats.dailyStats) map.set(d.date, d.reviews);
    const today = new Date();
    const n = rangeDays(range);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = localDateKey(d);
      out.push({ date: key, reviews: map.get(key) ?? 0, isToday: i === 0 });
    }
    return out;
  }, [stats.dailyStats, range]);

  const maxReviews = Math.max(...days.map(d => d.reviews), 1);
  const startLabel = useMemo(() => {
    if (days.length === 0) return '';
    return new Date(days[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }, [days]);
  const midLabel = useMemo(() => {
    if (days.length < 2) return '';
    return new Date(days[Math.floor(days.length / 2)].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }, [days]);
  const endLabel = useMemo(() => {
    if (days.length === 0) return '';
    return new Date(days[days.length - 1].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }, [days]);

  // ----- Time-on-task daily bars (selected range) ---------------------------
  const timeOnTask = useMemo(() => {
    const sessions = dailySessionMs(stats.reviewHistory, window);
    const out: { date: string; ms: number; isToday: boolean }[] = [];
    const today = new Date();
    const n = rangeDays(range);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = localDateKey(d);
      const ms = sessions.get(key) ?? 0;
      out.push({ date: key, ms, isToday: i === 0 });
    }
    return out;
  }, [stats.reviewHistory, window, range]);

  const maxMs = Math.max(...timeOnTask.map(d => d.ms), 60_000);

  // ----- Hour of day & day of week (selected range) -------------------------
  const hourBuckets = useMemo(() => reviewsByHour(stats.reviewHistory, window), [stats.reviewHistory, window]);
  const dowBuckets = useMemo(() => reviewsByDow(stats.reviewHistory, window), [stats.reviewHistory, window]);
  const peakHour = useMemo(() => {
    let max = 0, idx = -1;
    for (let i = 0; i < hourBuckets.length; i++) {
      if (hourBuckets[i] > max) { max = hourBuckets[i]; idx = i; }
    }
    return idx;
  }, [hourBuckets]);
  const peakDow = useMemo(() => {
    let max = 0, idx = -1;
    for (let i = 0; i < dowBuckets.length; i++) {
      if (dowBuckets[i] > max) { max = dowBuckets[i]; idx = i; }
    }
    return idx;
  }, [dowBuckets]);
  const maxHour = Math.max(...hourBuckets, 1);
  const maxDow = Math.max(...dowBuckets, 1);

  // ----- Retention by deck (extended) ---------------------------------------
  const lastReviewByDeck = useMemo(() => {
    const map = new Map<string, { ts: number; reviews: number }>();
    for (const r of stats.reviewHistory) {
      const cur = map.get(r.deckId);
      if (cur) {
        cur.reviews++;
        if (r.timestamp > cur.ts) cur.ts = r.timestamp;
      } else {
        map.set(r.deckId, { ts: r.timestamp, reviews: 1 });
      }
    }
    return map;
  }, [stats.reviewHistory]);

  const reviewsByDeckId = useMemo(() => {
    const map = new Map<string, { grade: Grade; timestamp: number }[]>();
    for (const r of stats.reviewHistory) {
      const list = map.get(r.deckId);
      if (list) list.push({ grade: r.grade, timestamp: r.timestamp });
      else map.set(r.deckId, [{ grade: r.grade, timestamp: r.timestamp }]);
    }
    return map;
  }, [stats.reviewHistory]);

  const deckRetention = useMemo(() => {
    return decks.map(deck => {
      const reviews = reviewsByDeckId.get(deck.id) ?? [];
      const r = calculateRetentionRate(reviews, retentionWindowDays);
      const meta = lastReviewByDeck.get(deck.id);
      return {
        deck,
        retention: r,
        hasReviews: reviews.length > 0,
        recentReviews: meta?.reviews ?? 0,
        lastReviewedAt: meta?.ts ?? 0,
      };
    });
  }, [decks, reviewsByDeckId, lastReviewByDeck]);

  // ----- Annual heatmap (existing) ------------------------------------------
  const heatmap = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of stats.dailyStats) map.set(d.date, d.reviews);
    const cells: { reviews: number; key: string; level: 0 | 1 | 2 | 3 | 4; date: Date }[] = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - 52 * 7 + 1);
    for (let w = 0; w < 52; w++) {
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(start);
        d.setDate(start.getDate() + w * 7 + dow);
        if (d.getTime() > today.getTime()) {
          cells.push({ reviews: -1, key: '', level: 0, date: d });
          continue;
        }
        const key = localDateKey(d);
        const r = map.get(key) ?? 0;
        const level: 0 | 1 | 2 | 3 | 4 =
          r === 0 ? 0
          : r < 4 ? 1
          : r < 10 ? 2
          : r < 20 ? 3
          : 4;
        cells.push({ reviews: r, key, level, date: d });
      }
    }
    return cells;
  }, [stats.dailyStats]);

  const heatmapStartLabel = monthLabel(heatmap[0]?.date ?? new Date());
  const heatmapEndLabel = monthLabel(new Date());

  // ----- Practice panels: shadow + conversation (last 7 days) ---------------
  const last7 = useMemo(() => {
    const today = new Date();
    const out: DailyStats[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = localDateKey(d);
      const found = stats.dailyStats.find(x => x.date === key);
      out.push(found ?? { date: key, reviews: 0, correct: 0, incorrect: 0, averageEase: 0 });
    }
    return out;
  }, [stats.dailyStats]);

  const shadowSecTotal = stats.dailyStats.reduce((s, d) => s + (d.shadowSec ?? 0), 0);
  const shadowSessionsTotal = stats.dailyStats.reduce(
    (s, d) => s + (d.shadowSec && d.shadowSec > 0 ? 1 : 0),
    0,
  );
  const conversationTotal = stats.dailyStats.reduce((s, d) => s + (d.conversationCount ?? 0), 0);
  const last7ShadowMax = Math.max(...last7.map(d => d.shadowSec ?? 0), 1);
  const last7ConvoMax = Math.max(...last7.map(d => d.conversationCount ?? 0), 1);

  const pronCheckRunsTotal = stats.dailyStats.reduce((s, d) => s + (d.pronCheckRuns ?? 0), 0);
  const pronCheckBestEver = stats.dailyStats.reduce(
    (best, d) => Math.max(best, d.pronCheckBestScore ?? 0),
    0,
  );
  // Lifetime average is a weighted mean across days (each day's running mean
  // weighted by its run count).
  const pronCheckAvgLifetime = (() => {
    let runs = 0;
    let weighted = 0;
    for (const d of stats.dailyStats) {
      const r = d.pronCheckRuns ?? 0;
      if (r > 0 && typeof d.pronCheckAvgScore === 'number') {
        runs += r;
        weighted += d.pronCheckAvgScore * r;
      }
    }
    return runs > 0 ? weighted / runs : 0;
  })();
  const last7PronMax = Math.max(...last7.map(d => d.pronCheckRuns ?? 0), 1);

  // ----- Render --------------------------------------------------------------

  const motivational = (() => {
    if (currentStreak >= 2) {
      return `${currentStreak}-day streak — one more keeps it alive.`;
    }
    if (currentStreak === 1) {
      return 'Day 1 down. Show up tomorrow to start a streak.';
    }
    if (totalReviews === 0) {
      return 'Nothing logged yet. A first session begins the ledger.';
    }
    return 'Streak reset. The clock starts again with the next review.';
  })();

  return (
    <div>
      <EditorialHeader
        kicker="06 · Statistics"
        title={
          <>
            A reading of{' '}
            <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>
              {numberFmt(totalReviews)}
            </span>{' '}
            reviews across the season.
          </>
        }
        sub="A monthly ledger of how knowledge accrues. No leaderboards, no streak shaming."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setRange('30d')}
              className={range === '30d' ? 'btn btn-dark' : 'btn btn-ghost'}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              30d
            </button>
            <button
              type="button"
              onClick={() => setRange('quarter')}
              className={range === 'quarter' ? 'btn btn-dark' : 'btn btn-ghost'}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              Quarter
            </button>
            <button
              type="button"
              onClick={() => setRange('all')}
              className={range === 'all' ? 'btn btn-dark' : 'btn btn-ghost'}
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              All-time
            </button>
          </div>
        }
      />

      {/* 0 · Recap strip */}
      <div className="eyebrow" style={{ marginTop: 8 }}>Recap · today / this week / this month</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 16,
          marginTop: 12,
        }}
      >
        <RecapCard
          label="Today"
          reviews={recap.todayAgg.reviews}
          correct={recap.todayAgg.correct}
          practiceMs={recap.todayAgg.practiceMs}
          subline={motivational}
        />
        <RecapCard
          label="This week"
          reviews={recap.weekAgg.reviews}
          correct={recap.weekAgg.correct}
          practiceMs={recap.weekAgg.practiceMs}
          subline={deltaLabel(recap.weekAgg.reviews, recap.priorWeekAgg.reviews, 'reviews')}
        />
        <RecapCard
          label="This month"
          reviews={recap.monthAgg.reviews}
          correct={recap.monthAgg.correct}
          practiceMs={recap.monthAgg.practiceMs}
          subline={deltaLabel(recap.monthAgg.reviews, recap.priorMonthAgg.reviews, 'reviews')}
        />
      </div>

      {/* 1 · Big numbers — 6 cells */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
          marginTop: 32,
        }}
      >
        {([
          ['Total cards', numberFmt(totalCards), cardsThisWeek > 0 ? `+${cardsThisWeek} this week` : `${decks.length} decks`],
          ['Reviews',     numberFmt(totalReviews), totalReviews > 0 ? `${accuracyPct}% accuracy` : 'no reviews yet'],
          ['Streak',      `${currentStreak} d`, bestStreak > currentStreak ? `best · ${bestStreak} d` : 'best · today'],
          ['Retention',   totalReps > 0 ? `${retentionPct}%` : '—', totalReps > 0 ? `${numberFmt(totalReps)} reps counted` : 'awaiting reviews'],
          ['Time studied', fmtMinutes(timeStudiedMs), `over ${range === 'all' ? '365 days' : range === 'quarter' ? '90 days' : '30 days'}`],
          ['Notes captured', numberFmt(notes.length), notes.length > 0 ? 'across all captures' : 'nothing captured'],
        ] as const).map(([k, v, sub], i) => (
          <div
            key={k}
            style={{
              padding: i === 0 ? '24px 24px 24px 0' : '24px',
              borderRight: i < 5 ? '1px solid var(--rule)' : 'none',
            }}
          >
            <div className="eyebrow">{k}</div>
            <div className="stat-num" style={{ marginTop: 8 }}>{v}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* 2 · Time-on-task + Review history */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 48, marginTop: 40 }}>
        <div>
          <div className="eyebrow">A · Review history · {range === '30d' ? '30 days' : range === 'quarter' ? '90 days' : 'all time'}</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            {totalReviews === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No reviews yet. Begin a session to start the ledger.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200 }}>
                  {days.map((day, idx) => {
                    const h = (day.reviews / maxReviews) * 100;
                    return (
                      <div
                        key={idx}
                        title={`${day.date}: ${day.reviews} reviews`}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          height: '100%',
                        }}
                      >
                        <div
                          style={{
                            height: `${Math.max(day.reviews > 0 ? 2 : 0, h)}%`,
                            background: day.isToday ? 'var(--clay)' : 'var(--ink)',
                            borderRadius: '2px 2px 0 0',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <hr className="rule-thin" style={{ margin: '10px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{startLabel}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{midLabel}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{endLabel}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow">A&prime; · Time on task · daily minutes</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            {timeStudiedMs === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No measurable time yet.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200 }}>
                  {timeOnTask.map((day, idx) => {
                    const h = (day.ms / maxMs) * 100;
                    return (
                      <div
                        key={idx}
                        title={`${day.date}: ${fmtMinutes(day.ms)}`}
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          height: '100%',
                        }}
                      >
                        <div
                          style={{
                            height: `${Math.max(day.ms > 0 ? 2 : 0, h)}%`,
                            background: day.isToday ? 'var(--clay)' : 'var(--moss)',
                            borderRadius: '2px 2px 0 0',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <hr className="rule-thin" style={{ margin: '10px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-3)' }}>
                  <span>Total · {fmtMinutes(timeStudiedMs)}</span>
                  <span>Peak day · {fmtMinutes(maxMs)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 3 · Hour of day + Day of week */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 48, marginTop: 40 }}>
        <div>
          <div className="eyebrow">D · Hour of day</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            {peakHour < 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No reviews in this range.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 140 }}>
                  {hourBuckets.map((n, h) => {
                    const pct = (n / maxHour) * 100;
                    return (
                      <div
                        key={h}
                        title={`${String(h).padStart(2, '0')}:00 · ${n} reviews`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
                      >
                        <div
                          style={{
                            height: `${Math.max(n > 0 ? 2 : 0, pct)}%`,
                            background: h === peakHour ? 'var(--clay)' : 'var(--ink)',
                            borderRadius: '2px 2px 0 0',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <hr className="rule-thin" style={{ margin: '10px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-4)' }} className="mono">
                  <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-2)' }}>
                  You mostly study {partOfDay(peakHour)} — peak at{' '}
                  <span className="mono" style={{ color: 'var(--ink)' }}>{String(peakHour).padStart(2, '0')}:00</span>.
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow">E · Day of week</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            {peakDow < 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No reviews in this range.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
                  {dowBuckets.map((n, d) => {
                    const pct = (n / maxDow) * 100;
                    return (
                      <div
                        key={d}
                        title={`${DOW_LABELS[d]}: ${n} reviews`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}
                      >
                        <div
                          style={{
                            height: `${Math.max(n > 0 ? 2 : 0, pct)}%`,
                            background: d === peakDow ? 'var(--clay)' : 'var(--ink)',
                            borderRadius: '2px 2px 0 0',
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <hr className="rule-thin" style={{ margin: '10px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-4)' }} className="mono">
                  {DOW_LABELS.map(l => <span key={l}>{l.toUpperCase()}</span>)}
                </div>
                <div style={{ marginTop: 12, fontSize: 13, color: 'var(--ink-2)' }}>
                  Strongest day · <span className="mono" style={{ color: 'var(--ink)' }}>{DOW_LABELS[peakDow]}</span>.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 4 · Retention by deck (extended) */}
      <div style={{ marginTop: 40 }}>
        <div className="eyebrow">B · Retention by deck</div>
        <div className="card-flat" style={{ padding: '8px 24px', marginTop: 12 }}>
          {deckRetention.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
              No decks yet.
            </div>
          ) : (
            deckRetention.map(({ deck, retention, hasReviews, recentReviews, lastReviewedAt }) => {
              const pct = Math.round(retention * 100);
              const lastLabel = lastReviewedAt > 0
                ? new Date(lastReviewedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '—';
              return (
                <div key={deck.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--rule)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span className="serif" style={{ fontSize: 15, color: 'var(--ink)' }}>{deck.name}</span>
                    <span className="mono" style={{ fontSize: 13, color: hasReviews ? 'var(--ink-2)' : 'var(--ink-4)' }}>
                      {hasReviews ? `${pct}%` : '—'}
                    </span>
                  </div>
                  <div className="bar">
                    <i style={{
                      width: `${pct}%`,
                      background: pct > 85 ? 'var(--moss)' : pct > 75 ? 'var(--clay)' : 'var(--gold)',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }} className="mono">
                    <span>{numberFmt(recentReviews)} recent reviews</span>
                    <span>last · {lastLabel}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 5 · Annual heatmap (existing) */}
      <div style={{ marginTop: 40 }}>
        <div className="eyebrow">C · A year of reviewing — annual heat map</div>
        <div className="card-flat" style={{ padding: 24, marginTop: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(52, 1fr)', gap: 3 }}>
            {(() => {
              const byDow: typeof heatmap[number][][] = [[], [], [], [], [], [], []];
              for (let i = 0; i < heatmap.length; i++) {
                const dow = i % 7;
                byDow[dow].push(heatmap[i]);
              }
              const colors = [
                'var(--rule)',
                'var(--clay-tint)',
                '#E8B89A',
                '#D88660',
                'var(--clay)',
              ];
              const out: ReactElement[] = [];
              for (let w = 0; w < 52; w++) {
                for (let dow = 0; dow < 7; dow++) {
                  const cell = byDow[dow][w];
                  if (!cell) continue;
                  if (cell.reviews < 0) {
                    out.push(<div key={`${w}-${dow}`} style={{ aspectRatio: '1' }} />);
                    continue;
                  }
                  out.push(
                    <div
                      key={`${w}-${dow}`}
                      title={`${cell.key}: ${cell.reviews} reviews`}
                      style={{ aspectRatio: '1', background: colors[cell.level], borderRadius: 1 }}
                    />
                  );
                }
              }
              return out;
            })()}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{heatmapStartLabel}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>LESS</span>
              {['var(--rule)', 'var(--clay-tint)', '#E8B89A', '#D88660', 'var(--clay)'].map(c => (
                <div key={c} style={{ width: 10, height: 10, background: c, borderRadius: 1 }} />
              ))}
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>MORE</span>
            </div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{heatmapEndLabel}</span>
          </div>
        </div>
      </div>

      {/* 6 · Practice panels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32, marginTop: 40 }}>
        <div>
          <div className="eyebrow">F · Shadow practice (English)</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            {shadowSecTotal === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No shadowing logged yet. The Shadow tab tracks time once a session ends.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div className="stat-num">{fmtSecondsToMin(shadowSecTotal)}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                      across {numberFmt(shadowSessionsTotal)} session{shadowSessionsTotal === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Sparkline values={last7.map(d => d.shadowSec ?? 0)} max={last7ShadowMax} accent="var(--moss)" />
                </div>
                <div className="mono" style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-4)' }}>
                  LAST 7 DAYS
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow">G · Conversation practice</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            {conversationTotal === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No tutor conversations yet. Open the side panel and ask a question to start.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div className="stat-num">{numberFmt(conversationTotal)}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                      tutor turn{conversationTotal === 1 ? '' : 's'} sent
                    </div>
                  </div>
                  <Sparkline values={last7.map(d => d.conversationCount ?? 0)} max={last7ConvoMax} accent="var(--clay)" />
                </div>
                <div className="mono" style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-4)' }}>
                  LAST 7 DAYS
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="eyebrow">H · AI pronunciation check</div>
          <div className="card-flat" style={{ padding: 24, marginTop: 12 }}>
            {pronCheckRunsTotal === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No graded reads yet. The Shadow tab logs each saved AI pronunciation check here.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div>
                    <div className="stat-num">{numberFmt(pronCheckRunsTotal)}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                      graded run{pronCheckRunsTotal === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Sparkline values={last7.map(d => d.pronCheckRuns ?? 0)} max={last7PronMax} accent="var(--clay)" />
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 12, fontSize: 12, color: 'var(--ink-2)' }}>
                  <span>
                    avg <span className="mono" style={{ color: 'var(--clay-deep, #b1502d)', fontWeight: 600 }}>{Math.round(pronCheckAvgLifetime)}</span> / 100
                  </span>
                  <span>
                    best <span className="mono" style={{ color: 'var(--clay-deep, #b1502d)', fontWeight: 600 }}>{Math.round(pronCheckBestEver)}</span> / 100
                  </span>
                </div>
                <div className="mono" style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
                  LAST 7 DAYS
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* I -- AI content review */}
      <section style={{ marginTop: 48 }}>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #888)' }}>
            I · AI content review
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3, #777)' }}>
            {numberFmt(AI_REASONS.reduce((sum, r) => sum + (aiHideStats.total[r] ?? 0), 0))} blocked all-time
          </span>
        </div>
        <AiContentReviewPanel stats={aiHideStats} />
      </section>

      {/* Keyword blocks -- toggle between an aggregated all-keywords ledger
          and a per-group breakdown. The per-group view shows an Ungrouped
          bucket for stray hits whose keywords are no longer in any group
          (e.g. legacy hits surviving a rename); the all view folds those
          strays into a single ranked table. */}
      <section style={{ marginTop: 48 }}>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #888)' }}>
            {keywordView === 'all' ? 'Keyword blocks · all keywords' : 'Keyword blocks by topic'}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
            {settings && settings.keywordGroups.length > 0 && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3, #777)' }}>
                {settings.keywordGroups.length} groups · {numberFmt(Object.values(settings.keywordHits).reduce((a, b) => a + b, 0))} blocked
              </span>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setKeywordView('all')}
                className={keywordView === 'all' ? 'btn btn-dark' : 'btn btn-ghost'}
                style={{ padding: '4px 12px', fontSize: 11 }}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setKeywordView('by-group')}
                className={keywordView === 'by-group' ? 'btn btn-dark' : 'btn btn-ghost'}
                style={{ padding: '4px 12px', fontSize: 11 }}
              >
                By group
              </button>
            </div>
          </div>
        </div>
        {!settings || settings.keywordGroups.length === 0 ? (
          <div className="card-flat" style={{ padding: '20px 28px', fontSize: 13, color: 'var(--text-muted, #888)' }}>
            No groups configured -- create one in Settings.
          </div>
        ) : (
          (() => {
            // Stray hits: keywords with a count but not present in any group.
            const grouped = new Set<string>();
            for (const g of settings.keywordGroups) {
              for (const kw of g.keywords) grouped.add(kw.toLowerCase());
            }
            const strays = Object.entries(settings.keywordHits)
              .filter(([kw, count]) => count > 0 && !grouped.has(kw.toLowerCase()));

            if (keywordView === 'all') {
              // Build one ranked ledger across every group, plus strays. Each
              // row remembers its first group membership so the user can see
              // which bucket a keyword belongs to without leaving the all-view.
              type Row = { keyword: string; group: string; enabled: boolean; hits: number };
              const rows: Row[] = [];
              const seen = new Set<string>();
              for (const g of settings.keywordGroups) {
                for (const kw of g.keywords) {
                  const key = kw.toLowerCase();
                  if (seen.has(key)) continue;
                  seen.add(key);
                  rows.push({
                    keyword: kw,
                    group: g.label,
                    enabled: g.enabled,
                    hits: settings.keywordHits[kw] ?? 0,
                  });
                }
              }
              for (const [kw, n] of strays) {
                const key = kw.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                rows.push({ keyword: kw, group: 'Ungrouped (historic)', enabled: false, hits: n });
              }
              rows.sort((a, b) => b.hits - a.hits);
              const totalHits = rows.reduce((a, r) => a + r.hits, 0);

              return (
                <div className="card-flat" style={{ borderRadius: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      padding: '12px 24px',
                      borderBottom: '1px solid var(--rule, #eee)',
                    }}
                  >
                    <span className="serif" style={{ fontSize: 15, fontWeight: 600 }}>
                      All keywords
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3, #777)' }}>
                      {rows.length} kw · {numberFmt(totalHits)} blocked
                    </span>
                  </div>
                  {rows.length === 0 ? (
                    <div style={{ padding: '12px 24px', fontSize: 12, color: 'var(--text-muted, #888)' }}>
                      No keywords configured yet.
                    </div>
                  ) : (
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th style={{ paddingLeft: 24 }}>Keyword</th>
                          <th>Group</th>
                          <th style={{ textAlign: 'right', paddingRight: 24 }}>Hidden (all time)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.keyword} style={{ opacity: r.enabled ? 1 : 0.55 }}>
                            <td style={{ paddingLeft: 24 }}>{r.keyword}</td>
                            <td style={{ color: 'var(--ink-3, #777)' }}>
                              {r.group}
                              {!r.enabled && (
                                <span
                                  className="mono"
                                  style={{
                                    marginLeft: 8,
                                    fontSize: 10,
                                    color: 'var(--ink-4, #999)',
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  muted
                                </span>
                              )}
                            </td>
                            <td style={{ textAlign: 'right', paddingRight: 24 }}>
                              {numberFmt(r.hits)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            }

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {settings.keywordGroups.map(group => {
                  const subtotal = group.keywords.reduce((sum, kw) => sum + (settings.keywordHits[kw] ?? 0), 0);
                  return (
                    <div
                      key={group.id}
                      className="card-flat"
                      style={{
                        borderRadius: 0,
                        opacity: group.enabled ? 1 : 0.65,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          padding: '12px 24px',
                          borderBottom: '1px solid var(--rule, #eee)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                          <span
                            className="serif"
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              textDecoration: group.enabled ? 'none' : 'line-through',
                            }}
                          >
                            {group.label}
                          </span>
                          {!group.enabled && (
                            <span
                              className="mono"
                              style={{
                                fontSize: 10,
                                color: 'var(--ink-3, #777)',
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                              }}
                            >
                              muted
                            </span>
                          )}
                        </div>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3, #777)' }}>
                          {group.keywords.length} kw · {numberFmt(subtotal)} blocked
                        </span>
                      </div>
                      {group.keywords.length === 0 ? (
                        <div style={{ padding: '12px 24px', fontSize: 12, color: 'var(--text-muted, #888)' }}>
                          No keywords in this group.
                        </div>
                      ) : (
                        <table className="dtable">
                          <thead>
                            <tr>
                              <th style={{ paddingLeft: 24 }}>Keyword</th>
                              <th style={{ textAlign: 'right', paddingRight: 24 }}>Hidden (all time)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...group.keywords]
                              .sort((a, b) => (settings.keywordHits[b] ?? 0) - (settings.keywordHits[a] ?? 0))
                              .map(kw => (
                                <tr key={kw}>
                                  <td style={{ paddingLeft: 24 }}>{kw}</td>
                                  <td style={{ textAlign: 'right', paddingRight: 24 }}>
                                    {numberFmt(settings.keywordHits[kw] ?? 0)}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
                {strays.length > 0 && (
                  <div className="card-flat" style={{ borderRadius: 0, opacity: 0.75 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        padding: '12px 24px',
                        borderBottom: '1px solid var(--rule, #eee)',
                      }}
                    >
                      <span className="serif" style={{ fontSize: 15, fontWeight: 600, fontStyle: 'italic' }}>Ungrouped (historic)</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3, #777)' }}>
                        {strays.length} kw · {numberFmt(strays.reduce((a, [, n]) => a + n, 0))} blocked
                      </span>
                    </div>
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th style={{ paddingLeft: 24 }}>Keyword</th>
                          <th style={{ textAlign: 'right', paddingRight: 24 }}>Hidden (all time)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {strays
                          .sort((a, b) => b[1] - a[1])
                          .map(([kw, n]) => (
                            <tr key={kw}>
                              <td style={{ paddingLeft: 24 }}>{kw}</td>
                              <td style={{ textAlign: 'right', paddingRight: 24 }}>{numberFmt(n)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()
        )}
      </section>
    </div>
  );
}

// AI content review breakdown. Renders three columns: today, 7-day, total,
// each broken down per reason (slop / spam / sales / low-quality / custom).
// Empty state when no posts have been logged yet.
function AiContentReviewPanel({ stats }: { stats: AiHideStats }) {
  const todayKey = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();

  const last7Keys = (() => {
    const keys: string[] = [];
    const d = new Date();
    for (let i = 6; i >= 0; i--) {
      const dd = new Date(d);
      dd.setDate(d.getDate() - i);
      const y = dd.getFullYear();
      const m = String(dd.getMonth() + 1).padStart(2, '0');
      const day = String(dd.getDate()).padStart(2, '0');
      keys.push(`${y}-${m}-${day}`);
    }
    return keys;
  })();

  const dailyMap = new Map(stats.daily.map(d => [d.date, d.counts]));

  const todayCounts = dailyMap.get(todayKey) ?? {};
  const last7Counts: Partial<Record<AiReason, number>> = {};
  for (const k of last7Keys) {
    const c = dailyMap.get(k);
    if (!c) continue;
    for (const r of AI_REASONS) {
      last7Counts[r] = (last7Counts[r] ?? 0) + (c[r] ?? 0);
    }
  }

  const total = AI_REASONS.reduce((s, r) => s + (stats.total[r] ?? 0), 0);

  if (total === 0) {
    return (
      <div className="card-flat" style={{ padding: '20px 28px', fontSize: 13, color: 'var(--text-muted, #888)' }}>
        No AI-reviewed posts hidden yet. Enable the filter under Settings &rarr; Keyword filters &rarr; "AI content review".
      </div>
    );
  }

  // Build last-7-day total trend for the sparkline (sum across reasons per day).
  const sparkValues = last7Keys.map(k => {
    const c = dailyMap.get(k);
    if (!c) return 0;
    return AI_REASONS.reduce((s, r) => s + (c[r] ?? 0), 0);
  });
  const sparkMax = Math.max(1, ...sparkValues);

  return (
    <div className="card-flat" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div className="stat-num">{numberFmt(total)}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
            post{total === 1 ? '' : 's'} hidden by AI review
          </div>
        </div>
        <Sparkline values={sparkValues} max={sparkMax} accent="var(--clay)" />
      </div>
      <div className="mono" style={{ marginBottom: 8, fontSize: 11, color: 'var(--ink-4)' }}>
        LAST 7 DAYS &mdash; trend
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--rule-2)' }}>
            <th style={{ textAlign: 'left', padding: '8px 12px 8px 0', fontWeight: 600, color: 'var(--ink-3)' }}>Reason</th>
            <th style={{ textAlign: 'right', padding: 8, fontWeight: 600, color: 'var(--ink-3)' }}>Today</th>
            <th style={{ textAlign: 'right', padding: 8, fontWeight: 600, color: 'var(--ink-3)' }}>7-day</th>
            <th style={{ textAlign: 'right', padding: '8px 0 8px 8px', fontWeight: 600, color: 'var(--ink-3)' }}>All-time</th>
          </tr>
        </thead>
        <tbody>
          {AI_REASONS.map(reason => {
            const today = todayCounts[reason] ?? 0;
            const week = last7Counts[reason] ?? 0;
            const all = stats.total[reason] ?? 0;
            if (all === 0) return null;
            return (
              <tr key={reason} style={{ borderBottom: '1px solid var(--rule-3, rgba(0,0,0,0.05))' }}>
                <td style={{ padding: '10px 12px 10px 0' }}>{AI_REASON_LABELS[reason]}</td>
                <td className="mono" style={{ textAlign: 'right', padding: 10, color: today > 0 ? 'var(--clay-deep, #b1502d)' : 'var(--ink-4)' }}>{numberFmt(today)}</td>
                <td className="mono" style={{ textAlign: 'right', padding: 10 }}>{numberFmt(week)}</td>
                <td className="mono" style={{ textAlign: 'right', padding: '10px 0 10px 8px', fontWeight: 600 }}>{numberFmt(all)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface RecapCardProps {
  label: string;
  reviews: number;
  correct: number;
  practiceMs: number;
  subline: string;
}

function RecapCard({ label, reviews, correct, practiceMs, subline }: RecapCardProps) {
  const accuracyPct = reviews > 0 ? Math.round((correct / reviews) * 100) : 0;
  return (
    <div className="card-flat" style={{ padding: 20 }}>
      <div className="eyebrow">{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 10 }}>
        <span className="stat-num">{numberFmt(reviews)}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>reviews</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: 'var(--ink-2)' }}>
        <span>{reviews > 0 ? `${accuracyPct}% accuracy` : 'no reviews'}</span>
        <span className="mono">{fmtMinutes(practiceMs)}</span>
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
        {subline}
      </div>
    </div>
  );
}

interface SparklineProps {
  values: number[];
  max: number;
  accent: string;
}

function Sparkline({ values, max, accent }: SparklineProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 48, width: 140 }}>
      {values.map((v, i) => {
        const pct = max > 0 ? (v / max) * 100 : 0;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(v > 0 ? 6 : 0, pct)}%`,
              background: v > 0 ? accent : 'var(--rule)',
              borderRadius: '2px 2px 0 0',
            }}
          />
        );
      })}
    </div>
  );
}
