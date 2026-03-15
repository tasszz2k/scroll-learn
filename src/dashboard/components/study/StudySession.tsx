import { useState, useCallback, useRef } from 'react';
import type { Card, Deck, Grade, Settings } from '@/common/types';
import { gradeAnswer } from '@/common/grading';
import QuizCard from './QuizCard';
import { shuffleArray } from './utils';
import AnswerFeedback from './AnswerFeedback';

type SessionState = 'loading' | 'answering' | 'feedback' | 'complete';

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

function getDueCountsByDeck(cards: Card[]): Map<string, number> {
  const now = Date.now();
  const map = new Map<string, number>();
  for (const card of cards) {
    if (card.due <= now) {
      map.set(card.deckId, (map.get(card.deckId) || 0) + 1);
    }
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
  const autoStarted = useRef<boolean | null>(null);

  const activeDeckId = settings.activeDeckId || '';

  // Count due cards per deck
  const dueByDeck = getDueCountsByDeck(cards);
  let totalDue = 0;
  for (const count of dueByDeck.values()) totalDue += count;
  const filteredDue = activeDeckId ? (dueByDeck.get(activeDeckId) || 0) : totalDue;

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

  // Auto-start: fetch the first card on mount
  if (autoStarted.current == null) {
    autoStarted.current = true;
    fetchNextCard(activeDeckId || undefined);
  }

  async function handleDeckChange(deckId: string) {
    await onSaveSettings({ activeDeckId: deckId || null });
    // Reset session and fetch from the new deck
    setSessionStats({ reviewed: 0, correct: 0, incorrect: 0, streak: 0 });
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
      // Background may be unavailable
    }

    setSessionStats(prev => ({
      reviewed: prev.reviewed + 1,
      correct: prev.correct + (grade >= 2 ? 1 : 0),
      incorrect: prev.incorrect + (grade < 2 ? 1 : 0),
      streak: grade >= 2 ? prev.streak + 1 : 0,
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
    } catch {
      // Background may be unavailable
    }
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
    }).then(() => {
      window.location.hash = '#decks';
    });
  }

  async function handleDelete() {
    if (!currentCard) return;
    if (!confirm('Delete this card?')) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'delete_card',
        cardId: currentCard.id,
      });
      await onDataChange();
      fetchNextCard(activeDeckId || undefined);
    } catch {
      // Background may be unavailable
    }
  }

  // Session score
  const sessionScore = sessionStats.correct - sessionStats.incorrect;
  const accuracy = sessionStats.reviewed > 0
    ? Math.round((sessionStats.correct / sessionStats.reviewed) * 100)
    : 0;

  // Deck selector — always visible at the top
  const deckSelector = (
    <div className="max-w-2xl mx-auto mb-6">
      <div className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-violet-50 to-blue-50 dark:from-violet-900/20 dark:to-blue-900/20 border border-violet-200/60 dark:border-violet-800/40">
        <label className="text-sm font-bold text-violet-600 dark:text-violet-400 whitespace-nowrap">
          Active Deck
        </label>
        <select
          value={activeDeckId}
          onChange={e => handleDeckChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="">All decks ({totalDue} due)</option>
          {decks.map(deck => {
            const due = dueByDeck.get(deck.id) || 0;
            return (
              <option key={deck.id} value={deck.id}>
                {deck.name} ({due} due)
              </option>
            );
          })}
        </select>
        <span className="px-3 py-1 rounded-full text-sm font-bold whitespace-nowrap bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
          {filteredDue} due
        </span>
      </div>
    </div>
  );

  // Loading view
  if (sessionState === 'loading') {
    return (
      <>
        {deckSelector}
        <div className="max-w-2xl mx-auto flex items-center justify-center py-16">
          <div className="animate-pulse text-surface-500 dark:text-surface-400">Loading next card...</div>
        </div>
      </>
    );
  }

  // Complete view — no more cards due
  if (sessionState === 'complete') {
    return (
      <>
        {deckSelector}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white dark:bg-surface-900 rounded-xl border border-surface-200 dark:border-surface-800 p-8 text-center space-y-6">
            <div>
              <svg className="w-16 h-16 mx-auto text-green-500 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
              <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-50">
                {sessionStats.reviewed === 0 ? 'No Cards Due' : 'Session Complete!'}
              </h2>
              <p className="text-surface-500 dark:text-surface-400 mt-2">
                {sessionStats.reviewed === 0
                  ? 'All caught up! Come back later for more reviews.'
                  : 'Great job reviewing your cards!'}
              </p>
            </div>

            {sessionStats.reviewed > 0 && (
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800">
                  <div className="text-2xl font-bold text-surface-900 dark:text-surface-100">{sessionStats.reviewed}</div>
                  <div className="text-sm text-surface-500 dark:text-surface-400">Reviewed</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">{accuracy}%</div>
                  <div className="text-sm text-surface-500 dark:text-surface-400">Accuracy</div>
                </div>
                <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800">
                  <div className="text-2xl font-bold text-primary-600 dark:text-primary-400">{sessionStats.streak}</div>
                  <div className="text-sm text-surface-500 dark:text-surface-400">Best Streak</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // Answering / Feedback view
  return (
    <>
      {deckSelector}
      <div className="max-w-2xl mx-auto">
        {/* Stats bar — matches content script pill colors */}
        <div className="flex items-center gap-2 mb-6 pb-4 border-b border-surface-200 dark:border-surface-700 flex-wrap">
          {currentCard?.deckName && (
            <span
              className="px-3.5 py-1.5 rounded-full text-xs font-medium max-w-[160px] truncate"
              style={{ backgroundColor: '#f3e8ff', color: '#7c3aed' }}
              title={`Current deck: ${currentCard.deckName}`}
            >
              {currentCard.deckName}
            </span>
          )}
          <span
            className="px-3.5 py-1.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: '#e0f2fe', color: '#0369a1' }}
            title={`${sessionStats.reviewed} questions answered (${sessionStats.correct} correct)`}
          >
            {sessionStats.reviewed} today
          </span>
          {sessionStats.reviewed > 0 && (
            <span
              className="px-3.5 py-1.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: '#dcfce7', color: '#15803d' }}
              title={`${accuracy}% of answers correct`}
            >
              {accuracy}%
            </span>
          )}
          <span
            className="px-3.5 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: sessionScore >= 0 ? '#ccfbf1' : '#fee2e2',
              color: sessionScore >= 0 ? '#0f766e' : '#b91c1c',
            }}
            title={`Session: ${sessionStats.correct} correct, ${sessionStats.incorrect} wrong`}
          >
            {sessionScore >= 0 ? '+' : ''}{sessionScore}
          </span>
          {sessionStats.streak > 0 && (
            <span
              className="px-3.5 py-1.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: '#ffedd5', color: '#c2410c' }}
              title={`${sessionStats.streak} correct in a row!`}
            >
              {sessionStats.streak} streak
            </span>
          )}
        </div>

        {/* Quiz card container */}
        <div className="bg-white dark:bg-surface-900 rounded-xl border-2 border-primary-100 dark:border-primary-900/40 p-6 shadow-sm">
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
              <div className="text-lg font-medium text-surface-900 dark:text-surface-100 pb-4 border-b border-surface-200 dark:border-surface-700">
                {currentCard.kind === 'cloze'
                  ? currentCard.front.split(/(\{\{[^}]+\}\})/g).map((part, i) =>
                      part.startsWith('{{') && part.endsWith('}}')
                        ? <span key={i} className="px-2 py-0.5 mx-0.5 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-semibold">{part.slice(2, -2)}</span>
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
      </div>
    </>
  );
}
