import { useMemo, useState } from 'react';
import type { PronCheckRun } from '../../../common/types';
import {
  aggregateProblemPhonemes,
  aggregateProblemWords,
} from './pronCheckAggregate';

interface PronCheckPracticePlanProps {
  runs: PronCheckRun[];
  onDrillPhoneme?: (symbol: string) => void;
}

const MAX_WORDS = 8;
const MAX_PHONEMES = 8;

function lastSeenLabel(lastRunIndex: number, totalRuns: number): string {
  const ago = totalRuns - 1 - lastRunIndex;
  if (ago === 0) return 'this run';
  if (ago === 1) return '1 run ago';
  return `${ago} runs ago`;
}

export default function PronCheckPracticePlan({ runs, onDrillPhoneme }: PronCheckPracticePlanProps) {
  const [open, setOpen] = useState(false);
  const words = useMemo(() => aggregateProblemWords(runs).slice(0, MAX_WORDS), [runs]);
  const phonemes = useMemo(() => aggregateProblemPhonemes(runs).slice(0, MAX_PHONEMES), [runs]);

  if (runs.length === 0) return null;
  if (words.length === 0 && phonemes.length === 0) return null;

  return (
    <div
      style={{
        marginBottom: 14,
        padding: '10px 14px',
        background: 'var(--card)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          textAlign: 'left',
        }}
        aria-expanded={open}
      >
        <span className="eyebrow" style={{ flex: 1 }}>
          Practice plan · what to drill next
        </span>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-4)',
            letterSpacing: '.08em',
          }}
        >
          {words.length} WORDS · {phonemes.length} PHONEMES
        </span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 150ms ease',
            color: 'var(--ink-3)',
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ▶
        </span>
      </button>

      {!open && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)' }}>
          {words.slice(0, 3).map(w => w.word).join(' · ')}
          {words.length > 3 ? ` · +${words.length - 3} more` : ''}
        </div>
      )}

      {open && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
        <section>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-4)', marginBottom: 6 }}>
            TOP PROBLEM WORDS
          </div>
          {words.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              No flagged words yet across the {runs.length} run{runs.length === 1 ? '' : 's'} for this script.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {words.map(w => (
                <li
                  key={w.word}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '4px 8px',
                    background: 'var(--paper-2, #f0eada)',
                    border: '1px solid var(--rule)',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{w.word}</span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {w.count}× · {lastSeenLabel(w.lastRunIndex, runs.length)}
                  </span>
                  {w.phonemes.length > 0 && (
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      {w.phonemes.map(sym => (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => onDrillPhoneme?.(sym)}
                          className="mono"
                          title={onDrillPhoneme ? `Drill /${sym}/ in the Foundation tab` : `/${sym}/`}
                          style={{
                            padding: '0 6px',
                            fontSize: 11,
                            background: 'transparent',
                            border: '1px solid var(--clay, #C96442)',
                            borderRadius: 999,
                            color: 'var(--clay-deep, #b1502d)',
                            cursor: onDrillPhoneme ? 'pointer' : 'default',
                          }}
                        >
                          /{sym}/
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-4)', marginBottom: 6 }}>
            TOP PROBLEM PHONEMES
          </div>
          {phonemes.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
              No phoneme tags yet — the model didn't pin specific sounds across these runs.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {phonemes.map(p => (
                <li
                  key={p.symbol}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 8px',
                    background: 'var(--paper-2, #f0eada)',
                    border: '1px solid var(--rule)',
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--clay-deep, #b1502d)' }}>
                    /{p.symbol}/
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                    {p.count}× · {lastSeenLabel(p.lastRunIndex, runs.length)}
                  </span>
                  <span style={{ flex: 1 }} />
                  {onDrillPhoneme && (
                    <button
                      type="button"
                      onClick={() => onDrillPhoneme(p.symbol)}
                      className="btn btn-ghost"
                      style={{ padding: '2px 10px', fontSize: 11 }}
                      title={`Drill /${p.symbol}/ in the Foundation tab`}
                    >
                      Drill
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      )}
    </div>
  );
}
