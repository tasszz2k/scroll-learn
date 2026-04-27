import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Card, Deck, Grade, Settings } from '@/common/types';
import { gradeAnswer } from '@/common/grading';
import EditorialHeader from '../EditorialHeader';
import QuizCard from './QuizCard';
import { shuffleArray } from './utils';
import AnswerFeedback from './AnswerFeedback';

type SessionState = 'loading' | 'answering' | 'feedback' | 'complete';
type Outcome = 'right' | 'wrong';

interface SessionStats {
  reviewed: number;
  correct: number;
  incorrect: number;
  streak: number;
}

interface StudySessionProps {
  decks: Deck[];
  cards: Card[];
  settings: Settings;
  onDataChange: () => Promise<void>;
  onSaveSettings: (settings: Partial<Settings>) => Promise<unknown>;
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function shortKind(kind: Card['kind']): string {
  switch (kind) {
    case 'mcq-single': return 'mcq';
    case 'mcq-multi': return 'mcq+';
    case 'cloze': return 'cloze';
    case 'audio': return 'audio';
    default: return 'text';
  }
}

function getDueCountsByDeck(cards: Card[]): Map<string, number> {
  const now = Date.now();
  const map = new Map<string, number>();
  for (const card of cards) {
    if (card.due <= now) map.set(card.deckId, (map.get(card.deckId) || 0) + 1);
  }
  return map;
}

export default function StudySession({ decks, cards, settings, onDataChange, onSaveSettings }: StudySessionProps) {
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [sessionStats, setSessionStats] = useState<SessionStats>({ reviewed: 0, correct: 0, incorrect: 0, streak: 0 });
  const [lastGrade, setLastGrade] = useState<Grade>(0);
  const [lastAnswer, setLastAnswer] = useState<string | number | number[]>('');
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [initialDue, setInitialDue] = useState<number | null>(null);
  const autoStarted = useRef<boolean | null>(null);

  const activeDeckId = settings.activeDeckId || '';
  const activeDeck = useMemo(() => decks.find(d => d.id === activeDeckId) ?? null, [decks, activeDeckId]);
  const dueByDeck = useMemo(() => getDueCountsByDeck(cards), [cards]);
  let totalDue = 0;
  for (const c of dueByDeck.values()) totalDue += c;
  const filteredDue = activeDeckId ? (dueByDeck.get(activeDeckId) || 0) : totalDue;

  // Lock the rail length to the count we started with — fires exactly once
  // per session, gated by `initialDue == null`.
  useEffect(() => {
    if (initialDue == null && (sessionState === 'answering' || sessionState === 'feedback')) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot lock of rail length
      setInitialDue(Math.max(filteredDue + sessionStats.reviewed, 1));
    }
  }, [initialDue, sessionState, filteredDue, sessionStats.reviewed]);

  // Tick once a second for elapsed display
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const fetchNextCard = useCallback(async (deckId?: string) => {
    setSessionState('loading');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'get_next_study_card',
        deckId: deckId || undefined,
      });
      if (response.ok && response.data) {
        const card = response.data as Card;
        setCurrentCard(card);
        if ((card.kind === 'mcq-single' || card.kind === 'mcq-multi') && card.options) {
          setShuffledIndices(shuffleArray(card.options.map((_: string, i: number) => i)));
        } else {
          setShuffledIndices([]);
        }
        setSessionState('answering');
      } else {
        setSessionState('complete');
      }
    } catch {
      setSessionState('complete');
    }
  }, []);

  useEffect(() => {
    if (autoStarted.current != null) return;
    autoStarted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async card fetch on mount, no Suspense bridge for chrome.runtime
    fetchNextCard(activeDeckId || undefined);
  }, [fetchNextCard, activeDeckId]);

  async function handleDeckChange(deckId: string) {
    await onSaveSettings({ activeDeckId: deckId || null });
    setSessionStats({ reviewed: 0, correct: 0, incorrect: 0, streak: 0 });
    setOutcomes([]);
    setInitialDue(null);
    setStartedAt(Date.now());
    fetchNextCard(deckId || undefined);
  }

  async function handleAnswer(userAnswer: string | number | number[]) {
    if (!currentCard) return;
    const grade = gradeAnswer(currentCard, userAnswer, settings);
    setLastGrade(grade);
    setLastAnswer(userAnswer);

    try {
      await chrome.runtime.sendMessage({
        type: 'card_answered',
        cardId: currentCard.id,
        grade,
        responseTimeMs: 0,
      });
    } catch {
      // background may be unavailable
    }

    const ok = grade >= 2;
    setOutcomes(prev => [...prev, ok ? 'right' : 'wrong']);
    setSessionStats(prev => ({
      reviewed: prev.reviewed + 1,
      correct: prev.correct + (ok ? 1 : 0),
      incorrect: prev.incorrect + (ok ? 0 : 1),
      streak: ok ? prev.streak + 1 : 0,
    }));
    setSessionState('feedback');
  }

  async function handleSkip() {
    if (!currentCard) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'skip_card',
        cardId: currentCard.id,
        snoozeMinutes: 10,
      });
    } catch { /* noop */ }
    fetchNextCard(activeDeckId || undefined);
  }

  async function handleNext() {
    await onDataChange();
    fetchNextCard(activeDeckId || undefined);
  }

  function handleEdit() {
    if (!currentCard) return;
    chrome.storage.local.set({
      editCardId: currentCard.id,
      editDeckId: currentCard.deckId,
    }).then(() => { window.location.hash = '#decks'; });
  }

  async function handleDelete() {
    if (!currentCard) return;
    if (!confirm('Delete this card?')) return;
    try {
      await chrome.runtime.sendMessage({ type: 'delete_card', cardId: currentCard.id });
      await onDataChange();
      fetchNextCard(activeDeckId || undefined);
    } catch { /* noop */ }
  }

  function handleEndSession() {
    setSessionState('complete');
  }

  // Derived ----------------------------------------------------------------

  const accuracy = sessionStats.reviewed > 0
    ? Math.round((sessionStats.correct / sessionStats.reviewed) * 100)
    : 0;
  const elapsed = formatElapsed(now - startedAt);
  const railLen = initialDue ?? Math.max(filteredDue, 1);
  const position = sessionStats.reviewed + (sessionState === 'answering' ? 1 : sessionState === 'feedback' ? 1 : 0);
  const positionLabel = `${String(Math.min(position, railLen)).padStart(2, '0')} / ${String(railLen).padStart(2, '0')}`;

  // ASCII session bars
  const right = sessionStats.correct;
  const wrong = sessionStats.incorrect;
  const left = Math.max(0, railLen - sessionStats.reviewed - (sessionState === 'answering' || sessionState === 'feedback' ? 1 : 0));
  const asciiBar = (n: number, max: number) => {
    const total = 19;
    const filled = max > 0 ? Math.round((n / max) * total) : 0;
    return '█'.repeat(filled) + '░'.repeat(Math.max(0, total - filled));
  };
  const denom = Math.max(railLen, 1);

  // Section title (matches design — italic clay accent)
  const sectionTitle: React.ReactNode = filteredDue === 0 && sessionStats.reviewed === 0 ? (
    <>Nothing due. <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>Quiet shelves.</span></>
  ) : (
    <>
      {railLen === 1
        ? <>One card</>
        : railLen < 20
          ? <>{({2:'Two',3:'Three',4:'Four',5:'Five',6:'Six',7:'Seven',8:'Eight',9:'Nine',10:'Ten',11:'Eleven',12:'Twelve',13:'Thirteen',14:'Fourteen',15:'Fifteen',16:'Sixteen',17:'Seventeen',18:'Eighteen',19:'Nineteen'} as Record<number,string>)[railLen] ?? railLen} cards</>
          : <>{railLen} cards</>}
      {' '}for <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>this sitting</span>.
    </>
  );

  // Deck strip (replaces the old deck dropdown — single line at the top)
  const deckSelectorRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        marginBottom: 24,
        background: 'var(--card)',
        border: '1px solid var(--rule)',
        borderRadius: 12,
      }}
    >
      <span className="eyebrow" style={{ whiteSpace: 'nowrap' }}>Active deck</span>
      <select
        value={activeDeckId}
        onChange={e => handleDeckChange(e.target.value)}
        className="input-editorial"
        style={{ flex: 1, padding: '8px 12px', fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 500 }}
      >
        <option value="">All decks ({totalDue} due)</option>
        {decks.map(deck => {
          const due = dueByDeck.get(deck.id) || 0;
          return <option key={deck.id} value={deck.id}>{deck.name} ({due} due)</option>;
        })}
      </select>
      <span className={'pill' + (filteredDue > 0 ? ' pill-clay' : '')} style={{ whiteSpace: 'nowrap' }}>
        {filteredDue} due
      </span>
    </div>
  );

  // Empty / complete state ------------------------------------------------
  if (sessionState === 'complete' || (sessionState === 'loading' && sessionStats.reviewed === 0 && filteredDue === 0)) {
    return (
      <div>
        {deckSelectorRow}
        <EditorialHeader
          kicker="01 · Study"
          title={sessionStats.reviewed === 0
            ? <>No cards due. <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>Quiet shelves.</span></>
            : <>Session complete. <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>Well done.</span></>}
          sub={sessionStats.reviewed === 0
            ? 'All caught up. Come back when more cards are due — or import new ones.'
            : 'A small batch of cards put back into the schedule. Come back tomorrow.'}
        />
        {sessionStats.reviewed > 0 && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
          }}>
            {([
              ['Reviewed', String(sessionStats.reviewed)],
              ['Accuracy', `${accuracy}%`],
              ['Best streak', String(sessionStats.streak)],
            ] as const).map(([k, v], i) => (
              <div key={k} style={{
                padding: '24px 24px 24px 0',
                paddingLeft: i > 0 ? 24 : 0,
                borderRight: i < 2 ? '1px solid var(--rule)' : 'none',
              }}>
                <div className="eyebrow">{k}</div>
                <div className="stat-num" style={{ marginTop: 8 }}>{v}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Loading state ---------------------------------------------------------
  if (sessionState === 'loading' && !currentCard) {
    return (
      <div>
        {deckSelectorRow}
        <div className="eyebrow animate-pulse">Loading next card…</div>
      </div>
    );
  }

  // Active study view -----------------------------------------------------
  return (
    <div>
      {deckSelectorRow}

      <EditorialHeader
        kicker="01 · Study"
        title={sectionTitle}
        sub="One card at a time. The scheduler picks the most overdue. Press enter to commit."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={handleSkip}>Pause</button>
            <button type="button" className="btn btn-dark" onClick={handleEndSession}>End session</button>
          </div>
        }
      />

      {/* Session header strip — 4 cells */}
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr',
        borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)',
      }}>
        <div style={{ padding: '18px 24px 18px 0', borderRight: '1px solid var(--rule)', minWidth: 0 }}>
          <div className="eyebrow">Active deck</div>
          <div className="serif" style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {activeDeck?.name ?? currentCard?.deckName ?? 'All decks'}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {(activeDeck?.description ?? '').trim() || `${cards.length} cards · ${totalDue} due`}
          </div>
        </div>
        <div style={{ padding: '18px 24px', borderRight: '1px solid var(--rule)' }}>
          <div className="eyebrow">Position</div>
          <div className="display" style={{ fontSize: 32, marginTop: 4 }}>
            {positionLabel.split(' / ')[0]}
            {' '}<span style={{ color: 'var(--ink-3)', fontSize: 18 }}>/ {positionLabel.split(' / ')[1]}</span>
          </div>
        </div>
        <div style={{ padding: '18px 24px', borderRight: '1px solid var(--rule)' }}>
          <div className="eyebrow">Correct</div>
          <div className="display" style={{ fontSize: 32, marginTop: 4, color: 'var(--moss)' }}>
            {String(sessionStats.correct).padStart(2, '0')}
          </div>
        </div>
        <div style={{ padding: '18px 0 18px 24px' }}>
          <div className="eyebrow">Elapsed</div>
          <div className="display" style={{ fontSize: 32, marginTop: 4 }}>{elapsed}</div>
        </div>
      </div>

      {/* Progress rail */}
      <div style={{
        marginTop: 18,
        display: 'grid',
        gridTemplateColumns: `repeat(${railLen}, 1fr)`,
        gap: 3,
      }}>
        {Array.from({ length: railLen }).map((_, i) => {
          let bg = 'var(--rule)';
          if (i < outcomes.length) {
            bg = outcomes[i] === 'right' ? 'var(--moss)' : 'var(--rose)';
          } else if (i === outcomes.length && (sessionState === 'answering' || sessionState === 'feedback')) {
            bg = 'var(--clay)';
          }
          return <div key={i} style={{ height: 6, background: bg, borderRadius: 1 }} />;
        })}
      </div>

      {/* Two-up: card + side rail */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 320px', gap: 48, marginTop: 36 }}>
        <div>
          <div className="eyebrow">
            A · Card {String(position).padStart(2, '0')}
            {currentCard && <> · {shortKind(currentCard.kind)}</>}
          </div>
          <div className="card-flat" style={{ marginTop: 12, padding: '32px 36px' }}>
            {sessionState === 'answering' && currentCard && (
              <QuizCard
                card={currentCard}
                shuffledIndices={shuffledIndices}
                onSubmit={handleAnswer}
                onSkip={handleSkip}
                onEdit={handleEdit}
                onDelete={handleDelete}
                disabled={false}
                settings={settings}
              />
            )}

            {sessionState === 'feedback' && currentCard && (
              <div className="space-y-6">
                <div
                  style={{
                    fontFamily: "'Source Serif 4', Georgia, serif",
                    fontWeight: 500,
                    fontSize: 22,
                    lineHeight: 1.35,
                    color: 'var(--ink)',
                    paddingBottom: 16,
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  {currentCard.kind === 'cloze'
                    ? currentCard.front.split(/(\{\{[^}]+\}\})/g).map((part, i) =>
                        part.startsWith('{{') && part.endsWith('}}')
                          ? <span key={i} style={{ padding: '0 6px', margin: '0 2px', borderBottom: '2px solid var(--clay)', color: 'var(--clay-deep)', fontWeight: 600 }}>{part.slice(2, -2)}</span>
                          : <span key={i}>{part}</span>
                      )
                    : currentCard.front}
                </div>

                <AnswerFeedback
                  card={currentCard}
                  grade={lastGrade}
                  userAnswer={lastAnswer}
                  shuffledIndices={shuffledIndices}
                  onNext={handleNext}
                />
              </div>
            )}
          </div>

          {/* Inline meta row under the card */}
          {currentCard && (
            <div className="mono" style={{
              display: 'flex', gap: 14, marginTop: 14,
              fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em', textTransform: 'uppercase',
            }}>
              <span>EASE {(currentCard.ease ?? 2.5).toFixed(1)}</span>
              <span>· REPS {currentCard.repetitions ?? 0}</span>
              {currentCard.deckName && <span>· {currentCard.deckName}</span>}
            </div>
          )}
        </div>

        {/* Side rail */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* B · Queue (compact session log) */}
          <div>
            <div className="eyebrow">B · Queue</div>
            <div className="card-flat" style={{ marginTop: 12 }}>
              {outcomes.length === 0 && sessionState === 'answering' && (
                <div style={{ padding: '14px 18px', textAlign: 'center' }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    + {Math.max(railLen - 1, 0)} CARDS PENDING
                  </span>
                </div>
              )}
              {outcomes.slice(-5).map((o, i, arr) => {
                const idx = outcomes.length - arr.length + i + 1;
                const isCorrect = o === 'right';
                return (
                  <div key={idx} style={{
                    padding: '10px 18px',
                    borderBottom: '1px solid var(--rule)',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', width: 22 }}>
                      {String(idx).padStart(2, '0')}
                    </span>
                    <span className="serif" style={{ fontSize: 13, color: 'var(--ink-3)', flex: 1 }}>
                      reviewed · {isCorrect ? 'good' : 'again'}
                    </span>
                    <span className="mono" style={{
                      fontSize: 10,
                      color: isCorrect ? 'var(--moss)' : 'var(--rose)',
                      textTransform: 'uppercase',
                      letterSpacing: '.08em',
                    }}>
                      {isCorrect ? 'right' : 'wrong'}
                    </span>
                  </div>
                );
              })}
              {currentCard && (sessionState === 'answering' || sessionState === 'feedback') && (
                <div style={{
                  padding: '12px 18px',
                  background: 'var(--clay-wash)',
                  borderLeft: '3px solid var(--clay)',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--clay-deep)', width: 22 }}>
                    {String(position).padStart(2, '0')}
                  </span>
                  <span className="serif" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {currentCard.front.replace(/\{\{|\}\}/g, '')}
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--clay-deep)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                    current
                  </span>
                </div>
              )}
              {railLen - outcomes.length - 1 > 0 && (
                <div style={{ padding: '10px 18px', textAlign: 'center', borderTop: outcomes.length > 0 ? '1px solid var(--rule)' : 'none' }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.08em' }}>
                    + {railLen - outcomes.length - 1} MORE
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* C · This session */}
          <div>
            <div className="eyebrow">C · This session</div>
            <div className="card-flat" style={{ padding: 18, marginTop: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Accuracy</div>
                  <div className="display" style={{ fontSize: 30, marginTop: 2 }}>{accuracy}%</div>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10 }}>Streak</div>
                  <div className="display" style={{ fontSize: 30, marginTop: 2 }}>{sessionStats.streak}</div>
                </div>
              </div>
              <hr className="rule-thin" style={{ margin: '14px 0' }} />
              <pre className="ascii" style={{ fontSize: 11, lineHeight: 1.5, margin: 0 }}>
{`right ${asciiBar(right, denom)} ${String(right).padStart(2, '0')}
wrong ${asciiBar(wrong, denom)} ${String(wrong).padStart(2, '0')}
left  ${asciiBar(left,  denom)} ${String(left ).padStart(2, '0')}`}
              </pre>
            </div>
          </div>

          {/* D · Hint */}
          {currentCard && (
            <div>
              <div className="eyebrow">D · Hint</div>
              <div className="card-flat" style={{ padding: '14px 16px', marginTop: 12, background: 'var(--paper-2)' }}>
                <div className="serif" style={{ fontSize: 13, color: 'var(--ink-2)', fontStyle: 'italic' }}>
                  {currentCard.kind === 'cloze'
                    ? <>Fill the highlighted blank. Press <span className="mono" style={{ fontStyle: 'normal', fontSize: 11, background: 'var(--card)', padding: '1px 5px', border: '1px solid var(--rule)' }}>↵</span> to commit.</>
                    : currentCard.kind === 'mcq-single'
                      ? <>Choose one. Number keys <span className="mono" style={{ fontStyle: 'normal', fontSize: 11, background: 'var(--card)', padding: '1px 5px', border: '1px solid var(--rule)' }}>1–{currentCard.options?.length ?? 4}</span> select.</>
                      : currentCard.kind === 'mcq-multi'
                        ? <>Several may be correct. Toggle with <span className="mono" style={{ fontStyle: 'normal', fontSize: 11, background: 'var(--card)', padding: '1px 5px', border: '1px solid var(--rule)' }}>1–n</span>.</>
                        : currentCard.kind === 'audio'
                          ? <>Play the audio, then type what you heard.</>
                          : <>Type the answer. Fuzzy matching tolerates typos.</>}
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
