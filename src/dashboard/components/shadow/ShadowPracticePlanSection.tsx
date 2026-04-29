// Cross-script Practice Plan view. Aggregates problem words and phonemes
// across every saved AI pronunciation-check run so the learner sees their
// overall weak points, independent of which conversation they're on.

import { useEffect, useMemo, useState } from 'react';
import { getAllPronCheckHistory } from '../../../common/shadowPronHistory';
import type { PronCheckRun } from '../../../common/types';
import {
  aggregateProblemPhonemes,
  aggregateProblemWords,
} from './pronCheckAggregate';

interface ShadowPracticePlanSectionProps {
  onDrillPhoneme: (symbol: string) => void;
}

function formatDate(ms: number | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function lastSeenAt(run: PronCheckRun | undefined): number | undefined {
  return run?.createdAt;
}

export default function ShadowPracticePlanSection({
  onDrillPhoneme,
}: ShadowPracticePlanSectionProps) {
  const [runs, setRuns] = useState<PronCheckRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const all = await getAllPronCheckHistory();
      if (!cancelled) {
        setRuns(all);
        setLoading(false);
      }
    })();
    // Reload when storage changes (e.g. a new run lands or a script is deleted).
    function onStorage(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area !== 'local') return;
      if (!('scrolllearn_shadow_pron_history' in changes)) return;
      void (async () => {
        const all = await getAllPronCheckHistory();
        if (!cancelled) setRuns(all);
      })();
    }
    chrome.storage.onChanged.addListener(onStorage);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onStorage);
    };
  }, []);

  // Words: aggregateProblemWords already sorts by count desc + recency.
  // We keep all of them in the table and let the table sort/scroll.
  const words = useMemo(() => aggregateProblemWords(runs), [runs]);
  const phonemes = useMemo(() => aggregateProblemPhonemes(runs), [runs]);

  const totals = useMemo(() => {
    let problemFlags = 0;
    for (const r of runs) {
      for (const line of r.report.lines) {
        problemFlags += line.problemWords.length;
      }
    }
    return { problemFlags };
  }, [runs]);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h3 className="serif" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px' }}>
          What to drill, across every conversation.
        </h3>
        <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.6, maxWidth: 720, margin: 0 }}>
          Every AI pronunciation-check run on every saved script feeds this list.
          It surfaces the words and phonemes that have hurt you the most, so when you sit down to drill
          you start with what actually moves the score.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <SummaryTile
          label="Saved runs"
          value={runs.length}
          hint="Every saved pronunciation check across every script."
        />
        <SummaryTile
          label="Problem flags"
          value={totals.problemFlags}
          hint="Words flagged across all those runs."
        />
        <SummaryTile
          label="Distinct sounds"
          value={phonemes.length}
          hint="Unique IPA phonemes that have come up at least once."
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--ink-4)', padding: '48px 0' }}>
          Loading...
        </div>
      ) : runs.length === 0 ? (
        <div
          className="card-flat"
          style={{
            padding: 32,
            textAlign: 'center',
            color: 'var(--ink-3)',
            fontSize: 14,
          }}
        >
          No AI pronunciation checks yet. Open a script in Practice · Shadow, hit{' '}
          <strong>Check pronunciation</strong>, record a take and you'll start filling this up.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, alignItems: 'start' }}>
          <section className="card-flat" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Top problem words ({words.length})
            </div>
            {words.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
                No problem words flagged yet across {runs.length} run{runs.length === 1 ? '' : 's'}.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--ink-4)' }}>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}>Word</th>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}>×</th>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}>Phonemes</th>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {words.map(w => (
                      <tr key={w.word} style={{ borderTop: '1px solid var(--rule)' }}>
                        <td style={{ padding: '6px 8px', fontWeight: 600, color: 'var(--ink)' }}>
                          {w.word}
                        </td>
                        <td className="mono" style={{ padding: '6px 8px', color: 'var(--clay-deep, #b1502d)', fontWeight: 600 }}>
                          {w.count}×
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          {w.phonemes.length === 0 ? (
                            <span style={{ color: 'var(--ink-4)' }}>—</span>
                          ) : (
                            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                              {w.phonemes.map(sym => (
                                <button
                                  key={sym}
                                  type="button"
                                  onClick={() => onDrillPhoneme(sym)}
                                  className="mono"
                                  title={`Drill /${sym}/ in the Foundation tab`}
                                  style={{
                                    padding: '0 6px',
                                    fontSize: 11,
                                    background: 'transparent',
                                    border: '1px solid var(--clay, #C96442)',
                                    borderRadius: 999,
                                    color: 'var(--clay-deep, #b1502d)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  /{sym}/
                                </button>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="mono" style={{ padding: '6px 8px', color: 'var(--ink-3)', fontSize: 12 }}>
                          {formatDate(lastSeenAt(runs[w.lastRunIndex]))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card-flat" style={{ padding: 18 }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Top problem phonemes ({phonemes.length})
            </div>
            {phonemes.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
                No phoneme tags yet -- the model didn't pin specific sounds across these runs.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--ink-4)' }}>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}>Phoneme</th>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}>×</th>
                      <th style={{ padding: '6px 8px', fontWeight: 500 }}>Last seen</th>
                      <th style={{ padding: '6px 8px', fontWeight: 500, textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {phonemes.map(p => (
                      <tr key={p.symbol} style={{ borderTop: '1px solid var(--rule)' }}>
                        <td className="mono" style={{ padding: '6px 8px', fontSize: 16, fontWeight: 700, color: 'var(--clay-deep, #b1502d)' }}>
                          /{p.symbol}/
                        </td>
                        <td className="mono" style={{ padding: '6px 8px', color: 'var(--clay-deep, #b1502d)', fontWeight: 600 }}>
                          {p.count}×
                        </td>
                        <td className="mono" style={{ padding: '6px 8px', color: 'var(--ink-3)', fontSize: 12 }}>
                          {formatDate(lastSeenAt(runs[p.lastRunIndex]))}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => onDrillPhoneme(p.symbol)}
                            className="btn btn-ghost"
                            style={{ padding: '2px 12px', fontSize: 12 }}
                            title={`Drill /${p.symbol}/ in the Foundation tab`}
                          >
                            Drill
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

interface SummaryTileProps {
  label: string;
  value: number;
  hint: string;
}

function SummaryTile({ label, value, hint }: SummaryTileProps) {
  return (
    <div className="card-flat" style={{ padding: 16 }}>
      <div className="eyebrow">{label}</div>
      <div className="stat-num" style={{ marginTop: 6, color: 'var(--clay-deep, #b1502d)' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.45 }}>
        {hint}
      </div>
    </div>
  );
}
