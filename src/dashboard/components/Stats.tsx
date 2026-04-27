import { useMemo, useState, type ReactElement } from 'react';
import type { Stats as StatsType, Deck, Card } from '../../common/types';
import EditorialHeader from './EditorialHeader';

interface StatsProps {
  stats: StatsType;
  decks: Deck[];
  cards: Card[];
}

const DAY_MS = 86_400_000;

const numberFmt = new Intl.NumberFormat('en-US').format;

type Range = '30d' | 'quarter' | 'all';

function rangeDays(range: Range): number {
  if (range === '30d') return 30;
  if (range === 'quarter') return 90;
  return 365;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
}

export default function Stats({ stats, decks, cards }: StatsProps) {
  const [range, setRange] = useState<Range>('30d');
  // Anchor "now" once per mount; the stats view is short-lived.
  const [now] = useState(() => Date.now());

  // Big numbers ----------------------------------------------------------
  const totalCards = cards.length;
  const totalReviews = stats.totalReviews;
  const accuracyPct = Math.round(stats.averageAccuracy * 100);
  const currentStreak = stats.currentStreak;
  const bestStreak = stats.longestStreak;

  // Cards added this week (best-effort: createdAt within 7 days)
  const cardsThisWeek = useMemo(
    () => cards.filter(c => (c.createdAt ?? 0) > now - 7 * DAY_MS).length,
    [cards, now],
  );

  // Retention: 1 - lapses / max(reviews, 1)
  const totalReps = cards.reduce((s, c) => s + (c.repetitions ?? 0), 0);
  const totalLapses = cards.reduce((s, c) => s + (c.lapses ?? 0), 0);
  const retentionPct = totalReps > 0
    ? Math.round((1 - totalLapses / totalReps) * 100)
    : 0;

  // Retention delta vs prior 30 days — synthetic from streak trend; if no
  // history, leave the delta line empty.
  // (We don't have monthly retention history, so this stays heuristic.)

  // Review history bars --------------------------------------------------
  const days = useMemo(() => {
    const out: { date: string; reviews: number; isToday: boolean }[] = [];
    const map = new Map<string, number>();
    for (const d of stats.dailyStats) map.set(d.date, d.reviews);
    const today = new Date();
    const n = rangeDays(range);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push({ date: key, reviews: map.get(key) ?? 0, isToday: i === 0 });
    }
    return out;
  }, [stats.dailyStats, range]);

  const maxReviews = Math.max(...days.map(d => d.reviews), 1);
  const startLabel = useMemo(() => {
    if (days.length === 0) return '';
    const d = new Date(days[0].date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }, [days]);
  const midLabel = useMemo(() => {
    if (days.length < 2) return '';
    const d = new Date(days[Math.floor(days.length / 2)].date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }, [days]);
  const endLabel = useMemo(() => {
    if (days.length === 0) return '';
    const d = new Date(days[days.length - 1].date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }, [days]);

  // Retention by deck ----------------------------------------------------
  const deckRetention = useMemo(() => {
    return decks.map(deck => {
      const list = cards.filter(c => c.deckId === deck.id);
      const reps = list.reduce((s, c) => s + (c.repetitions ?? 0), 0);
      const lapses = list.reduce((s, c) => s + (c.lapses ?? 0), 0);
      const r = reps > 0 ? Math.max(0, Math.min(1, 1 - lapses / reps)) : 0;
      return { deck, retention: r, hasReviews: reps > 0 };
    });
  }, [decks, cards]);

  // Annual heatmap (52 weeks × 7 days) -----------------------------------
  // Buckets: 0 / 1-3 / 4-9 / 10-19 / 20+
  const heatmap = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of stats.dailyStats) map.set(d.date, d.reviews);
    const cells: { reviews: number; key: string; level: 0 | 1 | 2 | 3 | 4; date: Date }[] = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    // Start 52 weeks ago, aligned to Sunday
    const start = new Date(today);
    start.setDate(today.getDate() - 52 * 7 + 1);
    // Walk the Sundays
    for (let w = 0; w < 52; w++) {
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(start);
        d.setDate(start.getDate() + w * 7 + dow);
        if (d.getTime() > today.getTime()) {
          cells.push({ reviews: -1, key: '', level: 0, date: d });
          continue;
        }
        const key = d.toISOString().slice(0, 10);
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

  // Render ---------------------------------------------------------------

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

      {/* 4-cell big numbers strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          borderTop: '1px solid var(--rule)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        {([
          ['Total cards', numberFmt(totalCards), cardsThisWeek > 0 ? `+${cardsThisWeek} this week` : `${decks.length} decks`],
          ['Reviews',     numberFmt(totalReviews), totalReviews > 0 ? `${accuracyPct}% accuracy` : 'no reviews yet'],
          ['Streak',      `${currentStreak} d`, bestStreak > currentStreak ? `best · ${bestStreak} d` : 'best · today'],
          ['Retention',   totalReps > 0 ? `${retentionPct}%` : '—', totalReps > 0 ? `${numberFmt(totalReps)} reviews counted` : 'awaiting reviews'],
        ] as const).map(([k, v, sub], i) => (
          <div
            key={k}
            style={{
              padding: i === 0 ? '24px 24px 24px 0' : '24px',
              borderRight: i < 3 ? '1px solid var(--rule)' : 'none',
            }}
          >
            <div className="eyebrow">{k}</div>
            <div className="stat-num" style={{ marginTop: 8 }}>{v}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Two-up: review history + retention by deck */}
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
          <div className="eyebrow">B · Retention by deck</div>
          <div className="card-flat" style={{ padding: '8px 24px', marginTop: 12 }}>
            {deckRetention.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '32px 0' }}>
                No decks yet.
              </div>
            ) : (
              deckRetention.map(({ deck, retention, hasReviews }) => {
                const pct = Math.round(retention * 100);
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
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Annual heatmap */}
      <div style={{ marginTop: 40 }}>
        <div className="eyebrow">C · A year of reviewing — annual heat map</div>
        <div className="card-flat" style={{ padding: 24, marginTop: 12, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(52, 1fr)', gap: 3 }}>
            {(() => {
              // Cells are stored row-major by week; heatmap[w*7+dow]. Reshape to
              // grid by displaying day rows instead of weekday rows.
              // But we want a 7-row × 52-col layout. Build by dow.
              const byDow: typeof heatmap[number][][] = [[], [], [], [], [], [], []];
              for (let i = 0; i < heatmap.length; i++) {
                const dow = i % 7;
                byDow[dow].push(heatmap[i]);
              }
              const colors = [
                'var(--rule)',     // 0 — none
                'var(--clay-tint)',// 1 — light
                '#E8B89A',         // 2
                '#D88660',         // 3
                'var(--clay)',     // 4 — heavy
              ];
              // Render column-major: 52 columns of 7 cells
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
    </div>
  );
}
