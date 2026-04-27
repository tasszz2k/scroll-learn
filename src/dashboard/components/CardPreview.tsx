import { useEffect, useMemo, useState } from 'react';
import type { Card } from '../../common/types';

interface CardPreviewProps {
  cards: Card[];
  deckName: string;
  initialIndex?: number;
  onClose: () => void;
  onEdit?: (card: Card) => void;
}

function correctIndices(card: Card): number[] {
  if (card.correct === undefined) return [];
  return Array.isArray(card.correct) ? card.correct : [card.correct];
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

function renderClozeWithAnswers(front: string): React.ReactNode {
  const parts = front.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (part.startsWith('{{') && part.endsWith('}}')) {
      const answer = part.slice(2, -2);
      return (
        <span
          key={i}
          style={{
            background: 'rgba(110,123,92,.18)',
            color: '#3F4A33',
            padding: '2px 8px',
            borderRadius: 4,
            fontWeight: 600,
            border: '1px dashed rgba(110,123,92,.55)',
          }}
        >
          {answer}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function renderClozeAsBlanks(front: string): React.ReactNode {
  const parts = front.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) => {
    if (part.startsWith('{{') && part.endsWith('}}')) {
      return (
        <span
          key={i}
          style={{
            display: 'inline-block',
            minWidth: 80,
            borderBottom: '2px solid var(--ink-3)',
            margin: '0 4px',
            color: 'transparent',
            userSelect: 'none',
          }}
        >
          {'    '}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function CardPreview({ cards, deckName, initialIndex = 0, onClose, onEdit }: CardPreviewProps) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, cards.length - 1)));
  const [revealed, setRevealed] = useState(true);

  const card = cards[index];
  const total = cards.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setIndex(i => Math.min(total - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setIndex(i => Math.max(0, i - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setRevealed(r => !r);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, total]);

  const correct = useMemo(() => correctIndices(card), [card]);

  if (!card) return null;

  const acceptedAnswers = card.canonicalAnswers && card.canonicalAnswers.length > 0
    ? card.canonicalAnswers
    : Array.isArray(card.back) ? card.back : [card.back];

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(31, 27, 22, 0.55)',
        backdropFilter: 'blur(2px)',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card-flat"
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            borderBottom: '1px solid var(--rule)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div className="eyebrow">Preview</div>
            <span className="serif" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
              {deckName}
            </span>
            <span className="pill">{shortKind(card.kind)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              aria-label="Close preview"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '32px 28px', overflowY: 'auto', flex: 1 }}>
          {/* Front */}
          <div className="eyebrow" style={{ marginBottom: 12 }}>Question</div>
          <div
            className="serif"
            style={{
              fontSize: 22,
              lineHeight: 1.45,
              color: 'var(--ink)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {card.kind === 'cloze'
              ? (revealed ? renderClozeWithAnswers(card.front) : renderClozeAsBlanks(card.front))
              : card.front}
          </div>

          {card.kind === 'audio' && card.mediaUrl && (
            <audio
              controls
              src={card.mediaUrl}
              style={{ marginTop: 14, width: '100%' }}
            />
          )}

          {/* MCQ options */}
          {(card.kind === 'mcq-single' || card.kind === 'mcq-multi') && card.options && (
            <div style={{ marginTop: 22, display: 'grid', gap: 10 }}>
              {card.options.map((opt, i) => {
                const isCorrect = correct.includes(i);
                const showCorrect = revealed && isCorrect;
                return (
                  <div
                    key={i}
                    style={{
                      padding: '12px 16px',
                      border: showCorrect ? '1.5px solid var(--moss)' : '1px solid var(--rule-2)',
                      borderRadius: 10,
                      background: showCorrect ? 'rgba(110,123,92,.10)' : 'var(--card)',
                      color: 'var(--ink)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <span
                      className="mono"
                      style={{
                        fontSize: 12,
                        color: showCorrect ? '#3F4A33' : 'var(--ink-3)',
                        minWidth: 18,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ flex: 1 }}>{opt}</span>
                    {showCorrect && (
                      <span className="pill pill-moss" style={{ fontSize: 10 }}>correct</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Answer reveal section */}
          <div
            style={{
              marginTop: 28,
              padding: '18px 22px',
              border: '1px solid var(--rule)',
              borderRadius: 10,
              background: 'var(--paper-2)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: revealed ? 10 : 0,
                gap: 12,
              }}
            >
              <div className="eyebrow">Answer</div>
              <button
                type="button"
                className="ulink"
                style={{ background: 'none', padding: 0, fontSize: 12, cursor: 'pointer' }}
                onClick={() => setRevealed(r => !r)}
              >
                {revealed ? 'hide' : 'reveal'}
              </button>
            </div>
            {revealed && (
              <div className="serif" style={{ fontSize: 17, color: 'var(--ink)', lineHeight: 1.5 }}>
                {card.kind === 'mcq-single' || card.kind === 'mcq-multi' ? (
                  correct.length === 0
                    ? <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>No correct option set.</span>
                    : (
                      <span>
                        {correct.map(i => `${i + 1}. ${card.options?.[i] ?? ''}`).join('  ·  ')}
                      </span>
                    )
                ) : card.kind === 'cloze' ? (
                  <span style={{ fontWeight: 600 }}>
                    {acceptedAnswers.join('  ·  ')}
                  </span>
                ) : (
                  <span>
                    {acceptedAnswers.join('  ·  ')}
                  </span>
                )}
              </div>
            )}
            {revealed && card.tags && card.tags.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {card.tags.map(t => (
                  <span key={t} className="pill" style={{ fontSize: 10 }}>{t}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer / nav */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: 'var(--paper-2)',
          }}
        >
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
            ← / → navigate · space toggles answer · esc closes
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {onEdit && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => onEdit(card)}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0}
            >
              ← Prev
            </button>
            <button
              type="button"
              className="btn btn-clay"
              style={{ padding: '6px 14px', fontSize: 12 }}
              onClick={() => setIndex(i => Math.min(total - 1, i + 1))}
              disabled={index === total - 1}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
