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

  const feedbackBg = feedback.type === 'success'
    ? 'rgba(110,123,92,.10)'
    : feedback.type === 'partial'
      ? 'rgba(184,146,58,.10)'
      : 'rgba(196,115,107,.10)';
  const feedbackBorder = feedback.type === 'success'
    ? 'rgba(110,123,92,.30)'
    : feedback.type === 'partial'
      ? 'rgba(184,146,58,.30)'
      : 'rgba(196,115,107,.30)';
  const feedbackTextColor = feedback.type === 'success'
    ? '#4F5B40'
    : feedback.type === 'partial'
      ? '#6E5A20'
      : '#8A4A42';

  return (
    <div className="space-y-4">
      {/* Grade feedback banner */}
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 10,
          border: `1px solid ${feedbackBorder}`,
          background: feedbackBg,
        }}
      >
        <p style={{ margin: 0, fontWeight: 500, color: feedbackTextColor }}>{feedback.message}</p>
        {grade < 3 && (
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            Correct answer:{' '}
            <span className="serif" style={{ fontWeight: 600, color: 'var(--ink)' }}>{correctDisplay}</span>
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

            let borderColor = 'var(--rule-2)';
            let bgColor = 'var(--card)';
            let badgeBg = 'var(--paper-2)';
            let badgeColor = 'var(--ink-3)';
            if (isCorrect) {
              borderColor = 'var(--moss)';
              bgColor = 'rgba(110,123,92,.08)';
              badgeBg = 'var(--moss)';
              badgeColor = '#FFF';
            } else if (wasSelected && !isCorrect) {
              borderColor = 'var(--rose)';
              bgColor = 'rgba(196,115,107,.10)';
              badgeBg = 'var(--rose)';
              badgeColor = '#FFF';
            }

            return (
              <div
                key={originalIndex}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: `1px solid ${borderColor}`,
                  background: bgColor,
                  color: 'var(--ink)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
                    fontSize: 11,
                    fontWeight: 500,
                    background: badgeBg,
                    color: badgeColor,
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  {displayIndex + 1}
                </span>
                <span className="serif" style={{ fontSize: 15, fontWeight: 500 }}>
                  {card.options![originalIndex]}
                </span>
                {isCorrect && (
                  <svg width="18" height="18" style={{ marginLeft: 'auto', color: 'var(--moss)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                )}
                {wasSelected && !isCorrect && (
                  <svg width="18" height="18" style={{ marginLeft: 'auto', color: 'var(--rose)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
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
        <div
          style={{
            padding: 16,
            borderRadius: 10,
            border: '1px solid var(--rule)',
            background: 'var(--paper-2)',
            display: 'grid',
            gap: 12,
          }}
        >
          <p className="eyebrow" style={{ margin: 0 }}>Type the correct answer to continue</p>
          <div className="flex" style={{ gap: 8 }}>
            <input
              ref={retryInputRef}
              type="text"
              value={retryValue}
              onChange={e => setRetryValue(e.target.value)}
              onKeyDown={handleRetryKeyDown}
              placeholder="Type the correct answer…"
              className="input-editorial"
              style={{ flex: 1 }}
            />
            <button
              onClick={handleRetrySubmit}
              type="button"
              className="btn btn-clay"
            >
              Check
            </button>
          </div>

          {/* Retry diff feedback */}
          {retryAttemptDiff && (
            <div className="mono" style={{ fontSize: 13, display: 'grid', gap: 4 }}>
              <div>
                <span style={{ color: 'var(--ink-3)', fontSize: 11, marginRight: 8 }}>Yours:</span>
                {retryAttemptDiff.map((d, i) => (
                  <span
                    key={i}
                    style={{
                      color: d.match ? 'var(--ink-2)' : 'var(--rose)',
                      textDecoration: d.match ? 'none' : 'line-through',
                    }}
                  >
                    {d.user || '\u00A0'}
                  </span>
                ))}
              </div>
              <div>
                <span style={{ color: 'var(--ink-3)', fontSize: 11, marginRight: 8 }}>Correct:</span>
                {retryAttemptDiff.map((d, i) => (
                  <span
                    key={i}
                    style={{
                      color: d.match ? 'var(--ink-2)' : 'var(--moss)',
                      fontWeight: d.match ? 400 : 600,
                    }}
                  >
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
          type="button"
          className="btn btn-clay"
          autoFocus
        >
          Next question
        </button>
      )}
    </div>
  );
}
