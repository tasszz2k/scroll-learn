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
      <div className="text-lg font-semibold text-surface-900 dark:text-surface-100">
        {card.kind === 'cloze' ? (
          <div className="space-y-3">
            <p className="text-sm text-amber-600 dark:text-amber-400 uppercase tracking-wide font-bold">Fill in the blanks</p>
            <div className="leading-relaxed flex flex-wrap items-center gap-1">
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
                        className="inline-block w-32 px-2 py-1 border-b-2 border-primary-400 dark:border-primary-500 bg-transparent text-center text-surface-900 dark:text-surface-100 focus:outline-none focus:border-primary-600 dark:focus:border-primary-400 disabled:opacity-50"
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
          <p>{card.front}</p>
        )}
      </div>

      {/* Audio player */}
      {card.kind === 'audio' && card.mediaUrl && (
        <div className="flex items-center gap-3">
          <audio ref={audioRef} src={card.mediaUrl} preload="auto" />
          <button
            onClick={playAudio}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/50 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Play Audio
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
          placeholder="Type your answer..."
          className="w-full px-4 py-3 rounded-lg border-2 border-primary-200 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-400 dark:focus:border-primary-500 disabled:opacity-50 placeholder:text-primary-300 dark:placeholder:text-primary-600"
          autoFocus
        />
      )}

      {/* MCQ options */}
      {(card.kind === 'mcq-single' || card.kind === 'mcq-multi') && card.options && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary-600 dark:text-primary-400">
            {card.kind === 'mcq-single' ? 'Select one answer' : 'Select all that apply'}
          </p>
          {shuffledIndices.map((originalIndex, displayIndex) => {
            const isSelected = selectedIndices.includes(originalIndex);
            const optionColors = [
              { bg: 'bg-blue-50 dark:bg-blue-900/15', border: 'border-blue-200 dark:border-blue-800', hoverBorder: 'hover:border-blue-400 dark:hover:border-blue-600', badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
              { bg: 'bg-violet-50 dark:bg-violet-900/15', border: 'border-violet-200 dark:border-violet-800', hoverBorder: 'hover:border-violet-400 dark:hover:border-violet-600', badge: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300' },
              { bg: 'bg-amber-50 dark:bg-amber-900/15', border: 'border-amber-200 dark:border-amber-800', hoverBorder: 'hover:border-amber-400 dark:hover:border-amber-600', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
              { bg: 'bg-emerald-50 dark:bg-emerald-900/15', border: 'border-emerald-200 dark:border-emerald-800', hoverBorder: 'hover:border-emerald-400 dark:hover:border-emerald-600', badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
              { bg: 'bg-rose-50 dark:bg-rose-900/15', border: 'border-rose-200 dark:border-rose-800', hoverBorder: 'hover:border-rose-400 dark:hover:border-rose-600', badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
              { bg: 'bg-cyan-50 dark:bg-cyan-900/15', border: 'border-cyan-200 dark:border-cyan-800', hoverBorder: 'hover:border-cyan-400 dark:hover:border-cyan-600', badge: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
            ];
            const color = optionColors[displayIndex % optionColors.length];
            return (
              <button
                key={originalIndex}
                onClick={() => !disabled && toggleOption(originalIndex)}
                disabled={disabled}
                className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all flex items-center gap-3 ${
                  isSelected
                    ? 'border-orange-500 dark:border-orange-400 bg-orange-50 dark:bg-orange-900/20 text-surface-900 dark:text-surface-100 shadow-md ring-2 ring-orange-200 dark:ring-orange-800'
                    : `${color.border} ${color.bg} ${color.hoverBorder} text-surface-700 dark:text-surface-300`
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold ${
                  isSelected ? 'bg-orange-500 dark:bg-orange-500 text-white' : color.badge
                }`}>
                  {displayIndex + 1}
                </span>
                <span className="font-medium">{card.options![originalIndex]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={disabled}
          className="px-6 py-2.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Submit Answer
        </button>
      </div>

      {/* Keyboard hint */}
      {settings.showKeyboardHints && settings.enableKeyboardShortcuts && (
        <p className="text-center text-xs text-surface-400 dark:text-surface-500">
          {(card.kind === 'mcq-single' || card.kind === 'mcq-multi')
            ? 'Press 1-4 to select, Enter to submit'
            : 'Press Enter to submit'}
          {settings.allowSkip && ', Esc to skip'}
        </p>
      )}

      {/* Toolbar: Skip, Edit, Delete */}
      <div className="flex items-center gap-2 pt-4 mt-4 border-t border-surface-200 dark:border-surface-700">
        {settings.allowSkip && (
          <button
            onClick={onSkip}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5,4 15,12 5,20" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
            Skip
          </button>
        )}
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 dark:text-red-400 border border-red-200 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          Delete
        </button>
      </div>
    </div>
  );
}
