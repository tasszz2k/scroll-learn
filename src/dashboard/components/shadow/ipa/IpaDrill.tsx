import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speakWordWithIpa } from '../../../../common/speak';
import { PHONEMES, PHONEME_BY_SYMBOL, type Phoneme } from './phonemes';
import { useIpaProgress } from './useIpaProgress';

interface IpaDrillProps {
  // When set, the drill scopes itself to a single phoneme until cleared. Used
  // by the deep-link path from the player IPA chips.
  focusPhoneme?: string | null;
  onClearFocus?: () => void;
}

interface ActiveQuestion {
  // The phoneme being tested.
  phoneme: Phoneme;
  // The minimal pair currently in play.
  pair: [string, string];
  // 0 or 1 -- which member of the pair was actually spoken.
  spokenIdx: number;
}

// Pick a random minimal pair from the phoneme. Falls back to ['',''] if the
// phoneme has none -- shouldn't happen for the curated list but defensive.
function pickPair(phoneme: Phoneme): [string, string] {
  if (phoneme.minimalPairs.length === 0) return [phoneme.exampleWords[0] ?? '?', '?'];
  const idx = Math.floor(Math.random() * phoneme.minimalPairs.length);
  return phoneme.minimalPairs[idx];
}

interface SessionState {
  attempts: number;
  correct: number;
  // Per-phoneme attempts in this session (separate from the persisted total).
  perPhoneme: Record<string, { correct: number; total: number }>;
}

const EMPTY_SESSION: SessionState = { attempts: 0, correct: 0, perPhoneme: {} };

export default function IpaDrill({ focusPhoneme, onClearFocus }: IpaDrillProps) {
  const { recordAnswer, getWeakPhonemes, pickWeightedPhoneme, totalAnswers } = useIpaProgress();
  const [active, setActive] = useState<ActiveQuestion | null>(null);
  const [feedback, setFeedback] = useState<null | { correct: boolean; spoken: string }>(null);
  const [session, setSession] = useState<SessionState>(EMPTY_SESSION);

  // Candidate phonemes: scoped to the focusPhoneme when set, otherwise all
  // phonemes that have at least one minimal pair (effectively every entry).
  const candidates = useMemo(() => {
    if (focusPhoneme) return [focusPhoneme];
    return PHONEMES.filter(p => p.minimalPairs.length > 0).map(p => p.symbol);
  }, [focusPhoneme]);

  // Stable refs for picker functions (they're stable from useIpaProgress but
  // declaring them as deps would still re-fire effects unnecessarily).
  const pickRef = useRef(pickWeightedPhoneme);
  useEffect(() => { pickRef.current = pickWeightedPhoneme; }, [pickWeightedPhoneme]);

  const startNext = useCallback(() => {
    const symbol = pickRef.current(candidates) ?? candidates[0];
    if (!symbol) {
      setActive(null);
      return;
    }
    const phoneme = PHONEME_BY_SYMBOL[symbol];
    if (!phoneme) {
      setActive(null);
      return;
    }
    const pair = pickPair(phoneme);
    const spokenIdx = Math.random() < 0.5 ? 0 : 1;
    setActive({ phoneme, pair, spokenIdx });
    setFeedback(null);
    // Speak after a tick so the UI mounts the question first.
    window.setTimeout(() => {
      speakWordWithIpa(pair[spokenIdx]);
    }, 60);
  }, [candidates]);

  // Bootstrap a question once on mount and whenever the candidate set changes
  // (e.g. focusPhoneme switched).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot drill bootstrap; resets on candidate-set change
    startNext();
  }, [startNext]);

  function repeat() {
    if (!active) return;
    speakWordWithIpa(active.pair[active.spokenIdx]);
  }

  function answer(idx: number) {
    if (!active || feedback) return;
    const correct = idx === active.spokenIdx;
    const phonemeSym = active.phoneme.symbol;
    recordAnswer(phonemeSym, correct);
    setFeedback({ correct, spoken: active.pair[active.spokenIdx] });
    setSession(prev => {
      const slot = prev.perPhoneme[phonemeSym] ?? { correct: 0, total: 0 };
      return {
        attempts: prev.attempts + 1,
        correct: prev.correct + (correct ? 1 : 0),
        perPhoneme: {
          ...prev.perPhoneme,
          [phonemeSym]: {
            correct: slot.correct + (correct ? 1 : 0),
            total: slot.total + 1,
          },
        },
      };
    });
  }

  const accuracy = session.attempts > 0 ? Math.round((session.correct / session.attempts) * 100) : 0;
  const weak = getWeakPhonemes(5);

  return (
    <div className="card-flat" style={{ padding: 24, background: 'var(--card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="eyebrow">Minimal-pair drill</div>
          {focusPhoneme && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
              Focused on <strong style={{ color: 'var(--clay)' }}>/{focusPhoneme}/</strong>
              {onClearFocus && (
                <button
                  type="button"
                  onClick={onClearFocus}
                  className="btn btn-ghost"
                  style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
                >
                  All sounds
                </button>
              )}
            </div>
          )}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {session.attempts > 0
            ? `${session.correct}/${session.attempts} (${accuracy}%) THIS SESSION`
            : 'PICK WHICH WORD YOU HEAR'}
          {totalAnswers > 0 && (
            <span style={{ marginLeft: 12, color: 'var(--ink-4)' }}>
              {totalAnswers} ANSWERS ALL-TIME
            </span>
          )}
        </div>
      </div>

      {active ? (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
            {active.pair.map((word, idx) => {
              const isAnswer = feedback != null && idx === active.spokenIdx;
              const isWrong = feedback != null && !feedback.correct && idx !== active.spokenIdx;
              return (
                <button
                  key={`${word}-${idx}`}
                  type="button"
                  disabled={feedback != null}
                  onClick={() => answer(idx)}
                  className="btn btn-clay"
                  style={{
                    flex: 1,
                    padding: '18px 12px',
                    fontSize: 18,
                    background: isAnswer
                      ? 'var(--ok-bg, #e8f5e9)'
                      : isWrong
                        ? 'var(--err-bg, #ffebee)'
                        : undefined,
                    border: isAnswer
                      ? '1px solid var(--ok, #2e7d32)'
                      : isWrong
                        ? '1px solid var(--err, #c62828)'
                        : undefined,
                    color: feedback != null ? 'var(--ink)' : undefined,
                  }}
                >
                  {word}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" onClick={repeat} className="btn btn-ghost" style={{ fontSize: 12 }}>
              Repeat
            </button>
            <button
              type="button"
              onClick={startNext}
              className="btn btn-dark"
              style={{ fontSize: 12 }}
              disabled={feedback == null && session.attempts === 0}
            >
              Next →
            </button>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              Target: /{active.phoneme.symbol}/ · {active.phoneme.name}
            </span>
          </div>

          {feedback && (
            <div
              style={{
                marginTop: 14,
                padding: '10px 12px',
                background: feedback.correct ? 'var(--ok-bg, #e8f5e9)' : 'var(--err-bg, #ffebee)',
                border: '1px solid ' + (feedback.correct ? 'var(--ok, #2e7d32)' : 'var(--err, #c62828)'),
                borderRadius: 6,
                fontSize: 13,
                color: 'var(--ink)',
              }}
            >
              {feedback.correct
                ? `Correct. The word was "${feedback.spoken}".`
                : `Not quite. The word was "${feedback.spoken}". Listen to /${active.phoneme.symbol}/ vs the contrast and try again.`}
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-2)' }}>
                {active.phoneme.mouthHint}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: 'var(--ink-3)', fontSize: 14 }}>Loading…</div>
      )}

      {weak.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Your weakest sounds</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {weak.map(sym => (
              <span
                key={sym}
                className="mono"
                style={{
                  padding: '2px 8px',
                  fontSize: 12,
                  background: 'var(--paper-2, #f0eada)',
                  border: '1px solid var(--rule)',
                  borderRadius: 999,
                  color: 'var(--clay-deep, #b1502d)',
                }}
                title={PHONEME_BY_SYMBOL[sym]?.name}
              >
                /{sym}/
              </span>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6 }}>
            These will be over-represented in the drill until accuracy climbs.
          </div>
        </div>
      )}
    </div>
  );
}
