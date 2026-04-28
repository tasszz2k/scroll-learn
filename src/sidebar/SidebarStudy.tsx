import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, Deck, Grade, Settings } from '@/common/types';
import { gradeAnswer } from '@/common/grading';
import AnswerFeedback from '../dashboard/components/study/AnswerFeedback';
import QuizCard from '../dashboard/components/study/QuizCard';
import { shuffleArray } from '../dashboard/components/study/utils';

type SessionState = 'loading' | 'answering' | 'feedback' | 'complete';

interface SidebarStudyProps {
  decks: Deck[];
  cards: Card[];
  settings: Settings;
  onDataChange: () => Promise<void> | void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<unknown>;
}

function getDueCount(cards: Card[], deckId: string | null): number {
  const now = Date.now();
  let n = 0;
  for (const c of cards) {
    if (deckId && c.deckId !== deckId) continue;
    if (c.due <= now) n++;
  }
  return n;
}

export default function SidebarStudy({
  decks,
  cards,
  settings,
  onDataChange,
  onSaveSettings,
}: SidebarStudyProps) {
  const [sessionState, setSessionState] = useState<SessionState>('loading');
  const [currentCard, setCurrentCard] = useState<Card | null>(null);
  const [shuffledIndices, setShuffledIndices] = useState<number[]>([]);
  const [lastGrade, setLastGrade] = useState<Grade>(0);
  const [lastAnswer, setLastAnswer] = useState<string | number | number[]>('');
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const autoStarted = useRef(false);

  const activeDeckId = settings.activeDeckId || '';
  const activeDeck = useMemo(
    () => decks.find(d => d.id === activeDeckId) ?? null,
    [decks, activeDeckId],
  );
  const dueCount = useMemo(
    () => getDueCount(cards, activeDeckId || null),
    [cards, activeDeckId],
  );

  const fetchNext = useCallback(async (deckId?: string) => {
    setSessionState('loading');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'get_next_study_card',
        deckId: deckId || undefined,
      });
      if (response?.ok && response.data) {
        const card = response.data as Card;
        setCurrentCard(card);
        if ((card.kind === 'mcq-single' || card.kind === 'mcq-multi') && card.options) {
          setShuffledIndices(shuffleArray(card.options.map((_, i) => i)));
        } else {
          setShuffledIndices([]);
        }
        setSessionState('answering');
      } else {
        setCurrentCard(null);
        setSessionState('complete');
      }
    } catch {
      setSessionState('complete');
    }
  }, []);

  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async card fetch on mount, no Suspense bridge for chrome.runtime
    void fetchNext(activeDeckId || undefined);
  }, [fetchNext, activeDeckId]);

  async function handleDeckChange(deckId: string) {
    await onSaveSettings({ activeDeckId: deckId || null });
    setReviewed(0);
    setCorrect(0);
    void fetchNext(deckId || undefined);
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
    } catch { /* background may be unavailable */ }

    setReviewed(n => n + 1);
    if (grade >= 2) setCorrect(n => n + 1);
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
    void fetchNext(activeDeckId || undefined);
  }

  async function handleNext() {
    await onDataChange();
    void fetchNext(activeDeckId || undefined);
  }

  function handleEdit() {
    if (!currentCard) return;
    void chrome.storage.local.set({
      editCardId: currentCard.id,
      editDeckId: currentCard.deckId,
    }).then(() =>
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html#decks') }),
    );
  }

  async function handleDelete() {
    if (!currentCard) return;
    if (!confirm('Delete this card?')) return;
    try {
      await chrome.runtime.sendMessage({ type: 'delete_card', cardId: currentCard.id });
      await onDataChange();
      void fetchNext(activeDeckId || undefined);
    } catch { /* noop */ }
  }

  async function handleRestart() {
    setReviewed(0);
    setCorrect(0);
    void fetchNext(activeDeckId || undefined);
  }

  const accuracy = reviewed > 0 ? Math.round((correct / reviewed) * 100) : 0;

  return (
    <div className="sidebar-study">
      <div className="sidebar-study-meta">
        <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>
          Active deck
        </label>
        <select
          className="sidebar-study-deck"
          value={activeDeckId}
          onChange={e => void handleDeckChange(e.target.value)}
        >
          <option value="">Auto-select (most overdue)</option>
          {decks.map(d => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <div className="sidebar-study-stats mono">
          <span>
            <strong>{dueCount}</strong> due
          </span>
          <span>·</span>
          <span>
            <strong>{reviewed}</strong> reviewed
          </span>
          {reviewed > 0 && (
            <>
              <span>·</span>
              <span>
                <strong>{accuracy}%</strong> right
              </span>
            </>
          )}
        </div>
      </div>

      {sessionState === 'loading' && !currentCard && (
        <div className="eyebrow animate-pulse" style={{ padding: '40px 0', textAlign: 'center' }}>
          Loading next card...
        </div>
      )}

      {sessionState === 'complete' && (
        <div className="sidebar-study-complete">
          <div className="serif" style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            {reviewed === 0 ? 'No cards due.' : 'Session complete.'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>
            {reviewed === 0
              ? activeDeck
                ? `Nothing due in "${activeDeck.name}". Pick another deck above or come back later.`
                : 'All caught up. Come back when more cards are due.'
              : `Reviewed ${reviewed} card${reviewed === 1 ? '' : 's'} (${accuracy}% right). Well done.`}
          </div>
          <button
            type="button"
            className="btn btn-clay"
            style={{ padding: '8px 14px', fontSize: 13 }}
            onClick={() => void handleRestart()}
          >
            Check for more
          </button>
        </div>
      )}

      {sessionState === 'answering' && currentCard && (
        <div className="sidebar-study-card card-flat">
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
        </div>
      )}

      {sessionState === 'feedback' && currentCard && (
        <div className="sidebar-study-card card-flat">
          <div
            style={{
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontWeight: 500,
              fontSize: 18,
              lineHeight: 1.35,
              color: 'var(--ink)',
              paddingBottom: 14,
              marginBottom: 14,
              borderBottom: '1px solid var(--rule)',
            }}
          >
            {currentCard.kind === 'cloze'
              ? currentCard.front
                  .split(/(\{\{[^}]+\}\})/g)
                  .map((part, i) =>
                    part.startsWith('{{') && part.endsWith('}}') ? (
                      <span
                        key={i}
                        style={{
                          padding: '0 4px',
                          margin: '0 2px',
                          borderBottom: '2px solid var(--clay)',
                          color: 'var(--clay-deep)',
                          fontWeight: 600,
                        }}
                      >
                        {part.slice(2, -2)}
                      </span>
                    ) : (
                      <span key={i}>{part}</span>
                    ),
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
  );
}
