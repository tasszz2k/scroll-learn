import type { PronCheckReport, ShadowScript } from '../../../common/types';

interface PronCheckReportProps {
  script: ShadowScript;
  report: PronCheckReport;
  onDrillPhoneme?: (symbol: string) => void;
}

function scoreBadge(label: string, value: number, color: string) {
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 14px',
        background: 'var(--paper-2, #f0eada)',
        border: `1px solid ${color}`,
        borderRadius: 10,
        minWidth: 92,
      }}
    >
      <span className="mono" style={{ fontSize: 10, letterSpacing: '.12em', color: 'var(--ink-4)' }}>
        {label.toUpperCase()}
      </span>
      <span className="serif" style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.1 }}>
        {value}
      </span>
      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>/ 100</span>
    </div>
  );
}

export default function PronCheckReportView({ script, report, onDrillPhoneme }: PronCheckReportProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {scoreBadge('Pronunciation', report.scores.pronunciation, 'var(--clay, #C96442)')}
        {scoreBadge('Naturalness', report.scores.naturalness, 'var(--ok, #2e7d32)')}
        {scoreBadge('Fluency', report.scores.fluency, '#3a6ea5')}
      </div>

      {report.summary && (
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--card)',
            border: '1px solid var(--rule)',
            borderRadius: 8,
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--ink-2)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {report.summary}
        </div>
      )}

      {report.lines.length > 0 && (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {report.lines.map((note, i) => {
            // The model emits 1-based idx; map back to script.lines[idx-1].
            // Tolerate 0-based too in case a model accidentally uses it.
            const scriptLine = script.lines[note.idx - 1] ?? script.lines[note.idx];
            return (
              <li
                key={i}
                style={{
                  padding: '12px 14px',
                  marginBottom: 8,
                  background: 'var(--card)',
                  border: '1px solid var(--rule)',
                  borderRadius: 8,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 6 }}>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'var(--paper-2, #f0eada)',
                      border: '1px solid var(--rule)',
                      color: 'var(--ink-3)',
                      letterSpacing: '.04em',
                    }}
                  >
                    Line {note.idx}
                  </span>
                  {scriptLine && (
                    <span className="serif" style={{ fontSize: 14, color: 'var(--ink)', flex: 1 }}>
                      {scriptLine.text}
                    </span>
                  )}
                </div>

                {note.said && (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                    Heard: <span className="mono" style={{ color: 'var(--ink-2)' }}>"{note.said}"</span>
                  </div>
                )}

                {note.problemWords.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {note.problemWords.map((pw, j) => (
                      <span
                        key={j}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 8px',
                          fontSize: 12,
                          background: 'rgba(201, 100, 66, 0.08)',
                          border: '1px solid var(--clay, #C96442)',
                          borderRadius: 999,
                          color: 'var(--clay-deep, #b1502d)',
                        }}
                        title={pw.reason || undefined}
                      >
                        <span style={{ fontWeight: 600 }}>{pw.word}</span>
                        {pw.phonemes.map(sym => (
                          <button
                            key={sym}
                            type="button"
                            onClick={() => onDrillPhoneme?.(sym)}
                            className="mono"
                            title={onDrillPhoneme ? `Drill /${sym}/ in the Foundation tab` : `/${sym}/`}
                            style={{
                              padding: '0 4px',
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
                    ))}
                  </div>
                )}

                {note.tip && (
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                    {note.tip}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
