import { useMemo, useState } from 'react';
import type { PronCheckRun } from '../../../common/types';

interface PronCheckHistoryProps {
  runs: PronCheckRun[];
}

const COLORS = {
  pronunciation: 'var(--clay, #C96442)',
  naturalness: 'var(--ok, #2e7d32)',
  fluency: '#3a6ea5',
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export default function PronCheckHistory({ runs }: PronCheckHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const recent = useMemo(() => runs.slice(-12), [runs]);

  if (runs.length < 1) return null;

  // 100x30 viewBox; each metric polyline plotted as 0 (top) -> 30 (bottom).
  // Y is inverted relative to the score so high = top.
  const points = (key: 'pronunciation' | 'naturalness' | 'fluency') => {
    if (recent.length === 0) return '';
    if (recent.length === 1) {
      const v = recent[0].report.scores[key];
      const y = 30 - (v / 100) * 30;
      return `0,${y.toFixed(2)} 100,${y.toFixed(2)}`;
    }
    return recent
      .map((r, i) => {
        const x = (i / (recent.length - 1)) * 100;
        const y = 30 - (r.report.scores[key] / 100) * 30;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  };

  return (
    <div
      style={{
        marginBottom: 14,
        padding: '10px 12px',
        background: 'var(--card)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.12em' }}>
          PROGRESS · {runs.length} RUN{runs.length === 1 ? '' : 'S'}
        </span>
        <svg
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
          style={{ width: 200, height: 30, flexShrink: 0 }}
          aria-label="Score history sparkline"
        >
          <polyline fill="none" stroke={COLORS.pronunciation} strokeWidth={1.2} points={points('pronunciation')} />
          <polyline fill="none" stroke={COLORS.naturalness} strokeWidth={1.2} points={points('naturalness')} />
          <polyline fill="none" stroke={COLORS.fluency} strokeWidth={1.2} points={points('fluency')} />
          {recent.map((r, i) => {
            const x = recent.length === 1 ? 50 : (i / (recent.length - 1)) * 100;
            return (
              <g key={r.id}>
                <circle cx={x} cy={30 - (r.report.scores.pronunciation / 100) * 30} r={1.2} fill={COLORS.pronunciation}>
                  <title>
                    {formatDate(r.createdAt)} · pron {r.report.scores.pronunciation} / nat {r.report.scores.naturalness} / flu {r.report.scores.fluency}
                  </title>
                </circle>
              </g>
            );
          })}
        </svg>
        <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 11, color: 'var(--ink-3)' }}>
          <LegendDot color={COLORS.pronunciation} label="Pronunciation" />
          <LegendDot color={COLORS.naturalness} label="Naturalness" />
          <LegendDot color={COLORS.fluency} label="Fluency" />
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="btn btn-ghost"
          style={{ padding: '2px 10px', fontSize: 11 }}
        >
          {expanded ? 'Hide' : 'Show all'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-4)' }}>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>When</th>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Pron</th>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Nat</th>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Flu</th>
                <th style={{ padding: '4px 6px', fontWeight: 500 }}>Length</th>
              </tr>
            </thead>
            <tbody>
              {[...runs].reverse().map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--rule)' }}>
                  <td className="mono" style={{ padding: '4px 6px', color: 'var(--ink-3)' }}>{formatDate(r.createdAt)}</td>
                  <td className="mono" style={{ padding: '4px 6px', color: COLORS.pronunciation }}>{r.report.scores.pronunciation}</td>
                  <td className="mono" style={{ padding: '4px 6px', color: COLORS.naturalness }}>{r.report.scores.naturalness}</td>
                  <td className="mono" style={{ padding: '4px 6px', color: COLORS.fluency }}>{r.report.scores.fluency}</td>
                  <td className="mono" style={{ padding: '4px 6px', color: 'var(--ink-4)' }}>{r.durationSec}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: color }} />
      {label}
    </span>
  );
}
