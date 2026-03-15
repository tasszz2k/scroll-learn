import { useState, useRef, useEffect } from 'react';
import type { Card, Grade } from '@/common/types';
import { getGradeFeedback, getCorrectAnswerDisplay } from '@/common/grading';

interface AnswerFeedbackProps {
  card: Card;
  grade: Grade;
  userAnswer: string | number | number[];
  shuffledIndices: number[];
  onNext: () => void;
}

/** Generate inline diff spans comparing user answer vs correct answer */
function generateInlineDiff(userAnswer: string, correctAnswer: string): { user: string; correct: string; match: boolean }[] {
  const result: { user: string; correct: string; match: boolean }[] = [];
  const userLower = userAnswer.toLowerCase();
  const correctLower = correctAnswer.toLowerCase();
  const maxLen = Math.max(userLower.length, correctLower.length);

  for (let i = 0; i < maxLen; i++) {
    const uc = userAnswer[i] || '';
    const cc = correctAnswer[i] || '';
    result.push({
      user: uc,
      correct: cc,
      match: userLower[i] === correctLower[i],
    });
  }
  return result;
}

export default function AnswerFeedback({ card, grade, userAnswer, shuffledIndices, onNext }: AnswerFeedbackProps) {
  const [retryValue, setRetryValue] = useState('');
  const [retryComplete, setRetryComplete] = useState(false);
  const [retryAttemptDiff, setRetryAttemptDiff] = useState<ReturnType<typeof generateInlineDiff> | null>(null);
  const retryInputRef = useRef<HTMLInputElement>(null);

  const feedback = getGradeFeedback(grade);
  const correctDisplay = getCorrectAnswerDisplay(card);
  const needsRetry = grade < 2 && (card.kind === 'text' || card.kind === 'audio' || card.kind === 'cloze');

  useEffect(() => {
    if (needsRetry && !retryComplete) {
      setTimeout(() => retryInputRef.current?.focus(), 50);
    }
  }, [needsRetry, retryComplete]);

  function handleRetrySubmit() {
    const normalized = retryValue.trim().toLowerCase();
    // For cloze, check against joined canonical answers
    const target = card.kind === 'cloze'
      ? (card.canonicalAnswers || []).join(', ').toLowerCase()
      : card.back.toLowerCase();

    if (normalized === target) {
      setRetryComplete(true);
      setRetryAttemptDiff(null);
    } else {
      setRetryAttemptDiff(generateInlineDiff(retryValue.trim(), card.kind === 'cloze' ? (card.canonicalAnswers || []).join(', ') : card.back));
    }
  }

  function handleRetryKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRetrySubmit();
    }
  }

  const feedbackColorClass = feedback.type === 'success'
    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
    : feedback.type === 'partial'
      ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
      : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';

  const feedbackTextClass = feedback.type === 'success'
    ? 'text-green-700 dark:text-green-300'
    : feedback.type === 'partial'
      ? 'text-yellow-700 dark:text-yellow-300'
      : 'text-red-700 dark:text-red-300';

  return (
    <div className="space-y-4">
      {/* Grade feedback banner */}
      <div className={`px-4 py-3 rounded-lg border ${feedbackColorClass}`}>
        <p className={`font-medium ${feedbackTextClass}`}>{feedback.message}</p>
        {grade < 3 && (
          <p className="mt-1 text-sm text-surface-600 dark:text-surface-400">
            Correct answer: <span className="font-medium text-surface-900 dark:text-surface-100">{correctDisplay}</span>
          </p>
        )}
      </div>

      {/* MCQ visual feedback */}
      {(card.kind === 'mcq-single' || card.kind === 'mcq-multi') && card.options && (
        <div className="space-y-2">
          {shuffledIndices.map((originalIndex, displayIndex) => {
            const isCorrect = Array.isArray(card.correct)
              ? card.correct.includes(originalIndex)
              : card.correct === originalIndex;
            const wasSelected = Array.isArray(userAnswer)
              ? userAnswer.includes(originalIndex)
              : userAnswer === originalIndex;

            const optionColors = [
              { bg: 'bg-blue-50 dark:bg-blue-900/15', border: 'border-blue-200 dark:border-blue-800', badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
              { bg: 'bg-violet-50 dark:bg-violet-900/15', border: 'border-violet-200 dark:border-violet-800', badge: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' },
              { bg: 'bg-amber-50 dark:bg-amber-900/15', border: 'border-amber-200 dark:border-amber-800', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
              { bg: 'bg-emerald-50 dark:bg-emerald-900/15', border: 'border-emerald-200 dark:border-emerald-800', badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
              { bg: 'bg-rose-50 dark:bg-rose-900/15', border: 'border-rose-200 dark:border-rose-800', badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
              { bg: 'bg-cyan-50 dark:bg-cyan-900/15', border: 'border-cyan-200 dark:border-cyan-800', badge: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
            ];
            const color = optionColors[displayIndex % optionColors.length];

            let borderClass = color.border;
            let bgClass = color.bg;
            let badgeClass = color.badge;
            if (isCorrect) {
              borderClass = 'border-green-400 dark:border-green-600';
              bgClass = 'bg-green-50 dark:bg-green-900/20';
              badgeClass = 'bg-green-500 text-white';
            } else if (wasSelected && !isCorrect) {
              borderClass = 'border-red-400 dark:border-red-600';
              bgClass = 'bg-red-50 dark:bg-red-900/20';
              badgeClass = 'bg-red-500 text-white';
            }

            return (
              <div
                key={originalIndex}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 flex items-center gap-3 ${borderClass} ${bgClass} text-surface-700 dark:text-surface-300`}
              >
                <span className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold ${badgeClass}`}>
                  {displayIndex + 1}
                </span>
                <span className="font-medium">{card.options![originalIndex]}</span>
                {isCorrect && (
                  <svg className="w-5 h-5 ml-auto text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                )}
                {wasSelected && !isCorrect && (
                  <svg className="w-5 h-5 ml-auto text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Retry-to-practice for text/audio/cloze */}
      {needsRetry && !retryComplete && (
        <div className="space-y-3 p-4 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
          <p className="text-sm font-medium text-surface-600 dark:text-surface-400">
            Type the correct answer to continue...
          </p>
          <div className="flex gap-2">
            <input
              ref={retryInputRef}
              type="text"
              value={retryValue}
              onChange={e => setRetryValue(e.target.value)}
              onKeyDown={handleRetryKeyDown}
              placeholder="Type the correct answer..."
              className="flex-1 px-4 py-2.5 rounded-lg border border-surface-300 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              onClick={handleRetrySubmit}
              className="px-4 py-2.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors"
            >
              Check
            </button>
          </div>

          {/* Retry diff feedback */}
          {retryAttemptDiff && (
            <div className="text-sm font-mono space-y-1">
              <div>
                <span className="text-surface-500 text-xs mr-2">Yours:</span>
                {retryAttemptDiff.map((d, i) => (
                  <span key={i} className={d.match ? 'text-surface-600 dark:text-surface-400' : 'text-red-500 line-through'}>
                    {d.user || '\u00A0'}
                  </span>
                ))}
              </div>
              <div>
                <span className="text-surface-500 text-xs mr-2">Correct:</span>
                {retryAttemptDiff.map((d, i) => (
                  <span key={i} className={d.match ? 'text-surface-600 dark:text-surface-400' : 'text-green-500 font-medium'}>
                    {d.correct || '\u00A0'}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Next button (shown when retry not needed or retry complete) */}
      {(!needsRetry || retryComplete) && (
        <button
          onClick={onNext}
          className="px-6 py-2.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors"
          autoFocus
        >
          Next Question
        </button>
      )}
    </div>
  );
}
