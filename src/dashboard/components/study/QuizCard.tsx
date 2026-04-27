import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Card, Settings } from '@/common/types';

interface QuizCardProps {
  card: Card;
  shuffledIndices: number[];
  onSubmit: (answer: string | number | number[]) => void;
  onSkip: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disabled: boolean;
  settings: Settings;
}

export default function QuizCard({ card, shuffledIndices, onSubmit, onSkip, onEdit, onDelete, disabled, settings }: QuizCardProps) {
  const [textAnswer, setTextAnswer] = useState('');
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [clozeAnswers, setClozeAnswers] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Parse cloze blanks
  const clozeParts = useMemo(() => {
    if (card.kind !== 'cloze') return [];
    return card.front.split(/(\{\{[^}]+\}\})/g);
  }, [card.kind, card.front]);

  const clozeBlankCount = useMemo(() => {
    return clozeParts.filter(p => p.startsWith('{{') && p.endsWith('}}')).length;
  }, [clozeParts]);

  // Reset state when card changes
  useEffect(() => {
    setTextAnswer('');
    setSelectedIndices([]);
    setClozeAnswers(new Array(clozeBlankCount).fill(''));
    if (card.kind === 'text' || card.kind === 'audio') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [card.id, card.kind, clozeBlankCount]);

  const toggleOption = useCallback((originalIndex: number) => {
    if (card.kind === 'mcq-single') {
      setSelectedIndices([originalIndex]);
    } else {
      setSelectedIndices(prev =>
        prev.includes(originalIndex)
          ? prev.filter(i => i !== originalIndex)
          : [...prev, originalIndex]
      );
    }
  }, [card.kind]);

  const handleSubmit = useCallback(() => {
    if (disabled) return;
    switch (card.kind) {
      case 'text':
      case 'audio':
        if (!textAnswer.trim()) return;
        onSubmit(textAnswer.trim());
        break;
      case 'mcq-single':
        if (selectedIndices.length === 0) return;
        onSubmit(selectedIndices[0]);
        break;
      case 'mcq-multi':
        if (selectedIndices.length === 0) return;
        onSubmit(selectedIndices);
        break;
      case 'cloze':
        if (clozeAnswers.every(a => !a.trim())) return;
        onSubmit(clozeAnswers.map(a => a.trim()).join('|'));
        break;
    }
  }, [disabled, card.kind, textAnswer, selectedIndices, clozeAnswers, onSubmit]);

  // Keyboard shortcuts
  useEffect(() => {
    if (disabled || !settings.enableKeyboardShortcuts) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
        return;
      }

      if ((card.kind === 'mcq-single' || card.kind === 'mcq-multi') && card.options) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= card.options.length) {
          e.preventDefault();
          const originalIndex = shuffledIndices[num - 1];
          toggleOption(originalIndex);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, card.kind, card.options, shuffledIndices, settings.enableKeyboardShortcuts, handleSubmit, onSkip, toggleOption]);

  function playAudio() {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }

  return (
    <div className="space-y-6">
      {/* Question */}
      <div
        style={{
          fontFamily: "'Source Serif 4', Georgia, serif",
          fontWeight: 500,
          fontSize: 22,
          lineHeight: 1.3,
          color: 'var(--ink)',
        }}
      >
        {card.kind === 'cloze' ? (
          <div className="space-y-3">
            <p className="eyebrow">Fill in the blanks</p>
            <div style={{ lineHeight: 1.5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              {(() => {
                let blankIdx = 0;
                return clozeParts.map((part, i) => {
                  if (part.startsWith('{{') && part.endsWith('}}')) {
                    const idx = blankIdx++;
                    return (
                      <input
                        key={i}
                        type="text"
                        value={clozeAnswers[idx] || ''}
                        onChange={e => {
                          const updated = [...clozeAnswers];
                          updated[idx] = e.target.value;
                          setClozeAnswers(updated);
                        }}
                        disabled={disabled}
                        placeholder={`blank ${idx + 1}`}
                        style={{
                          display: 'inline-block',
                          minWidth: 130,
                          padding: '2px 8px',
                          margin: '0 2px',
                          fontFamily: "'Source Serif 4', Georgia, serif",
                          fontSize: 22,
                          fontWeight: 500,
                          textAlign: 'center',
                          color: 'var(--clay-deep)',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '2px solid var(--clay)',
                          outline: 'none',
                          opacity: disabled ? 0.5 : 1,
                        }}
                        autoFocus={idx === 0}
                      />
                    );
                  }
                  return <span key={i}>{part}</span>;
                });
              })()}
            </div>
          </div>
        ) : (
          <p style={{ margin: 0 }}>{card.front}</p>
        )}
      </div>

      {/* Audio player */}
      {card.kind === 'audio' && card.mediaUrl && (
        <div className="flex items-center gap-3">
          <audio ref={audioRef} src={card.mediaUrl} preload="auto" />
          <button
            onClick={playAudio}
            type="button"
            className="btn btn-ghost"
            style={{ padding: '8px 14px' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play audio
          </button>
        </div>
      )}

      {/* Text/Audio input */}
      {(card.kind === 'text' || card.kind === 'audio') && (
        <input
          ref={inputRef}
          type="text"
          value={textAnswer}
          onChange={e => setTextAnswer(e.target.value)}
          disabled={disabled}
          placeholder="Type your answer…"
          className="input-editorial"
          style={{
            fontFamily: "'Source Serif 4', Georgia, serif",
            fontSize: 18,
            padding: '14px 18px',
            opacity: disabled ? 0.6 : 1,
          }}
          autoFocus
        />
      )}

      {/* MCQ options */}
      {(card.kind === 'mcq-single' || card.kind === 'mcq-multi') && card.options && (
        <div className="space-y-2">
          <p className="eyebrow">
            {card.kind === 'mcq-single' ? 'Select one answer' : 'Select all that apply'}
          </p>
          {shuffledIndices.map((originalIndex, displayIndex) => {
            const isSelected = selectedIndices.includes(originalIndex);
            return (
              <button
                key={originalIndex}
                onClick={() => !disabled && toggleOption(originalIndex)}
                disabled={disabled}
                type="button"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 16px',
                  borderRadius: 10,
                  border: `1px solid ${isSelected ? 'var(--clay)' : 'var(--rule-2)'}`,
                  background: isSelected ? 'var(--clay-wash)' : 'var(--card)',
                  color: 'var(--ink)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.6 : 1,
                  transition: 'all .15s ease',
                  fontFamily: 'inherit',
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
                    background: isSelected ? 'var(--clay)' : 'var(--paper-2)',
                    color: isSelected ? '#FFF8F2' : 'var(--ink-3)',
                    border: `1px solid ${isSelected ? 'var(--clay)' : 'var(--rule-2)'}`,
                  }}
                >
                  {displayIndex + 1}
                </span>
                <span className="serif" style={{ fontSize: 15, fontWeight: 500 }}>
                  {card.options![originalIndex]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center" style={{ gap: 10 }}>
        <button
          onClick={handleSubmit}
          disabled={disabled}
          type="button"
          className="btn btn-clay"
        >
          Submit answer
        </button>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.06em' }}>
          ↵ submit
          {(card.kind === 'mcq-single' || card.kind === 'mcq-multi') && ' · 1-4 select'}
          {settings.allowSkip && ' · esc skip'}
        </span>
      </div>

      {/* Toolbar: Skip, Edit, Delete */}
      <div
        className="flex items-center"
        style={{ gap: 8, paddingTop: 16, marginTop: 16, borderTop: '1px solid var(--rule)' }}
      >
        {settings.allowSkip && (
          <button
            onClick={onSkip}
            disabled={disabled}
            type="button"
            className="btn btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,4 15,12 5,20" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
            Skip
          </button>
        )}
        <button
          onClick={onEdit}
          type="button"
          className="btn btn-ghost"
          style={{ padding: '6px 12px', fontSize: 12 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>
        <button
          onClick={onDelete}
          type="button"
          className="btn"
          style={{
            padding: '6px 12px',
            fontSize: 12,
            background: 'transparent',
            color: 'var(--rose)',
            border: '1px solid var(--rose)',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          Delete
        </button>
      </div>
    </div>
  );
}
