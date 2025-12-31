import { useState } from 'react';
import type { Card, CardKind } from '../../common/types';
import { normalizeText } from '../../common/parser';

interface CardEditorProps {
  card?: Card;
  deckId: string;
  onSave: (card: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card) => Promise<void>;
  onCancel: () => void;
}

export default function CardEditor({ card, deckId, onSave, onCancel }: CardEditorProps) {
  const [kind, setKind] = useState<CardKind>(card?.kind || 'text');
  const [front, setFront] = useState(card?.front || '');
  const [back, setBack] = useState(card?.back || '');
  const [options, setOptions] = useState<string[]>(card?.options || ['', '', '', '']);
  const [correct, setCorrect] = useState<number | number[]>(card?.correct ?? 0);
  const [mediaUrl, setMediaUrl] = useState(card?.mediaUrl || '');
  const [tags, setTags] = useState(card?.tags?.join(', ') || '');
  const [saving, setSaving] = useState(false);

  const kindOptions: { value: CardKind; label: string; description: string }[] = [
    { value: 'text', label: 'Text', description: 'Type the answer' },
    { value: 'mcq-single', label: 'Multiple Choice', description: 'Select one answer' },
    { value: 'mcq-multi', label: 'Multi-Select', description: 'Select all correct answers' },
    { value: 'cloze', label: 'Fill in Blank', description: 'Use {{answer}} for blanks' },
    { value: 'audio', label: 'Audio', description: 'Listen and type' },
  ];

  function extractClozeAnswers(text: string): string[] {
    const regex = /\{\{([^}]+)\}\}/g;
    const answers: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      answers.push(normalizeText(match[1]));
    }
    return answers;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;
    
    setSaving(true);
    try {
      const cardData: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card = {
        ...(card || {}),
        deckId,
        kind,
        front: front.trim(),
        back: back.trim(),
        options: kind.startsWith('mcq') ? options.filter(o => o.trim()) : undefined,
        correct: kind.startsWith('mcq') ? correct : undefined,
        canonicalAnswers: kind === 'cloze' 
          ? extractClozeAnswers(front)
          : kind === 'text' || kind === 'audio'
            ? [normalizeText(back)]
            : undefined,
        mediaUrl: kind === 'audio' && mediaUrl ? mediaUrl : undefined,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(t => t) : undefined,
      } as Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card;

      await onSave(cardData);
    } finally {
      setSaving(false);
    }
  }

  function updateOption(index: number, value: string) {
    const newOptions = [...options];
    newOptions[index] = value;
    setOptions(newOptions);
  }

  function addOption() {
    setOptions([...options, '']);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    const newOptions = options.filter((_, i) => i !== index);
    setOptions(newOptions);
    
    // Update correct answer indices
    if (kind === 'mcq-single') {
      if (correct === index) {
        setCorrect(0);
      } else if (typeof correct === 'number' && correct > index) {
        setCorrect(correct - 1);
      }
    } else if (kind === 'mcq-multi' && Array.isArray(correct)) {
      setCorrect(correct.filter(i => i !== index).map(i => i > index ? i - 1 : i));
    }
  }

  function toggleMultiCorrect(index: number) {
    if (!Array.isArray(correct)) {
      setCorrect([index]);
      return;
    }
    
    if (correct.includes(index)) {
      setCorrect(correct.filter(i => i !== index));
    } else {
      setCorrect([...correct, index].sort());
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Card Type Selector */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Card Type</label>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {kindOptions.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setKind(option.value);
                if (option.value === 'mcq-multi') {
                  setCorrect([0]);
                } else if (option.value === 'mcq-single') {
                  setCorrect(0);
                }
              }}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                kind === option.value
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
              }`}
            >
              <div className={`text-sm font-medium ${kind === option.value ? 'text-primary-600 dark:text-primary-400' : 'text-surface-900 dark:text-surface-100'}`}>
                {option.label}
              </div>
              <div className="text-xs text-surface-500 mt-0.5">{option.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Front (Question) */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
          {kind === 'cloze' ? 'Question (use {{answer}} for blanks)' : 'Question / Front'}
        </label>
        <textarea
          className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 min-h-[80px] resize-y"
          value={front}
          onChange={e => setFront(e.target.value)}
          placeholder={
            kind === 'cloze' 
              ? 'The capital of France is {{Paris}}'
              : 'What is the capital of France?'
          }
          required
        />
        {kind === 'cloze' && (
          <p className="text-xs text-surface-500 mt-1">
            Wrap answers in double curly braces: {'{{answer}}'}
          </p>
        )}
      </div>

      {/* Back (Answer) - for text/audio */}
      {(kind === 'text' || kind === 'audio' || kind === 'cloze') && (
        <div>
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
            {kind === 'cloze' ? 'Hint / Additional Info' : 'Answer / Back'}
          </label>
          <textarea
            className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 min-h-[60px] resize-y"
            value={back}
            onChange={e => setBack(e.target.value)}
            placeholder="Paris"
            required
          />
          <p className="text-xs text-surface-500 mt-1">
            Normalized: {normalizeText(back) || '(empty)'}
          </p>
        </div>
      )}

      {/* MCQ Options */}
      {kind.startsWith('mcq') && (
        <div>
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Options</label>
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                {kind === 'mcq-single' ? (
                  <input
                    type="radio"
                    name="correct"
                    checked={correct === index}
                    onChange={() => setCorrect(index)}
                    className="w-4 h-4 text-primary-600"
                  />
                ) : (
                  <input
                    type="checkbox"
                    checked={Array.isArray(correct) && correct.includes(index)}
                    onChange={() => toggleMultiCorrect(index)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                )}
                <input
                  type="text"
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 flex-1"
                  value={option}
                  onChange={e => updateOption(index, e.target.value)}
                  placeholder={`Option ${index + 1}`}
                />
                {options.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    className="p-2 text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addOption}
            className="mt-2 text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Option
          </button>
          <p className="text-xs text-surface-500 mt-2">
            {kind === 'mcq-single' ? 'Select the correct answer' : 'Check all correct answers'}
          </p>
          
          {/* Set back to first correct option for MCQ */}
          {!back && options.filter(o => o.trim()).length > 0 && (
            <input type="hidden" value={options[typeof correct === 'number' ? correct : correct[0]] || ''} />
          )}
        </div>
      )}

      {/* Audio URL */}
      {kind === 'audio' && (
        <div>
          <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Audio URL</label>
          <input
            type="url"
            className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
            value={mediaUrl}
            onChange={e => setMediaUrl(e.target.value)}
            placeholder="https://example.com/audio.mp3"
          />
          {mediaUrl && (
            <audio controls className="mt-2 w-full">
              <source src={mediaUrl} />
            </audio>
          )}
        </div>
      )}

      {/* Tags */}
      <div>
        <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Tags (optional)</label>
        <input
          type="text"
          className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder="vocabulary, beginner, unit-1"
        />
        <p className="text-xs text-surface-500 mt-1">Separate with commas</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500" disabled={saving}>
          {saving ? 'Saving...' : card ? 'Update Card' : 'Create Card'}
        </button>
        <button type="button" onClick={onCancel} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-surface-200 text-surface-900 hover:bg-surface-300 focus:ring-surface-400 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600">
          Cancel
        </button>
      </div>
    </form>
  );
}

