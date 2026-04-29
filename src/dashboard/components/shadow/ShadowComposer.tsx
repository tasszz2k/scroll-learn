import { useEffect, useMemo, useState } from 'react';
import type { Note, ShadowLevel } from '../../../common/types';
import { useIpaProgress } from './ipa/useIpaProgress';
import { buildShadowPrompt } from './prompts';
import { useShadowGen, type ShadowGenMeta } from './useShadowGen';

interface ShadowComposerProps {
  notes: Note[];
  // Fires when a fresh script lands; the parent typically refreshes the
  // saved list and selects the new entry in the player.
  onScriptCreated?: (scriptId: string) => void;
}

const LEVELS: ShadowLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const LEVEL_KEY = 'scroll-learn:shadow-level';
const SPEAKERS_KEY = 'scroll-learn:shadow-speakers';
const DURATION_KEY = 'scroll-learn:shadow-duration';
const RATE_KEY = 'scroll-learn:shadow-rate';
const REGISTER_KEY = 'scroll-learn:shadow-register';

function loadNumber(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch { return fallback; }
}
function loadString(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function persist(key: string, value: string | number): void {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore */ }
}

export default function ShadowComposer({ notes, onScriptCreated }: ShadowComposerProps) {
  const { getWeakPhonemes } = useIpaProgress();

  const [words, setWords] = useState('');
  const [context, setContext] = useState('');
  const [level, setLevel] = useState<ShadowLevel>(() => {
    const saved = loadString(LEVEL_KEY, 'B1');
    return (LEVELS as string[]).includes(saved) ? (saved as ShadowLevel) : 'B1';
  });
  const [speakerCount, setSpeakerCount] = useState<number>(() => loadNumber(SPEAKERS_KEY, 2));
  const [durationSec, setDurationSec] = useState<number>(() => loadNumber(DURATION_KEY, 40));
  const [rate, setRate] = useState<number>(() => loadNumber(RATE_KEY, 1.0));
  const [register, setRegister] = useState<string>(() => loadString(REGISTER_KEY, 'neutral conversational'));
  const [enabledPhonemes, setEnabledPhonemes] = useState<Set<string>>(new Set());
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [pickerSelection, setPickerSelection] = useState<Set<string>>(new Set());

  const { state, elapsedMs, generate, reset } = useShadowGen({
    onResult: (script) => onScriptCreated?.(script.id),
  });

  // Persist form state across visits.
  useEffect(() => persist(LEVEL_KEY, level), [level]);
  useEffect(() => persist(SPEAKERS_KEY, speakerCount), [speakerCount]);
  useEffect(() => persist(DURATION_KEY, durationSec), [durationSec]);
  useEffect(() => persist(RATE_KEY, rate), [rate]);
  useEffect(() => persist(REGISTER_KEY, register), [register]);

  // Pull weak phonemes from progress and pre-check up to 5.
  const weakPhonemes = useMemo(() => getWeakPhonemes(5), [getWeakPhonemes]);

  // Initialise the enabled set once weak phonemes are known.
  useEffect(() => {
    if (weakPhonemes.length > 0 && enabledPhonemes.size === 0) {
      setEnabledPhonemes(new Set(weakPhonemes));
    }
    // We deliberately do NOT depend on enabledPhonemes -- only seed once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weakPhonemes.length]);

  const recentNotes = useMemo(() => {
    return [...notes]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 30);
  }, [notes]);

  function togglePhoneme(sym: string) {
    setEnabledPhonemes(prev => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  }

  function toggleNoteSelection(id: string) {
    setPickerSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyNoteSelection() {
    const selected = recentNotes.filter(n => pickerSelection.has(n.id));
    if (selected.length === 0) {
      setShowNotePicker(false);
      return;
    }
    const incoming = selected.map(n => n.text.trim()).filter(Boolean).join('\n');
    setWords(prev => (prev.trim() ? prev.trim() + '\n' + incoming : incoming));
    setPickerSelection(new Set());
    setShowNotePicker(false);
  }

  const targetWords = useMemo(() =>
    words.split('\n').map(s => s.trim()).filter(Boolean),
    [words],
  );

  const isBusy = state.kind === 'running';
  const canSubmit = !isBusy && targetWords.length > 0 && context.trim().length > 0;

  function handleGenerate() {
    if (!canSubmit) return;
    const prompt = buildShadowPrompt({
      targetWords,
      context: context.trim(),
      level,
      speakerCount,
      durationSec,
      weakPhonemes: Array.from(enabledPhonemes),
      register,
    });
    const meta: ShadowGenMeta = {
      level,
      speakerCount,
      durationSec,
      rate,
      targetWords,
      context: context.trim(),
    };
    void generate(prompt, meta);
  }

  return (
    <div className="card-flat" style={{ padding: 24, marginBottom: 28, background: 'var(--card)' }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>Compose a shadowing script</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Target words / phrases</label>
          <textarea
            className="input-editorial"
            value={words}
            onChange={e => setWords(e.target.value)}
            placeholder={'one item per line\nmeanwhile\nlooking forward to it'}
            style={{ minHeight: 110, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowNotePicker(s => !s)}
              className="btn btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
            >
              {showNotePicker ? 'Hide notes' : 'Pull from Notes…'}
            </button>
            {recentNotes.length === 0 && (
              <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--ink-4)' }}>
                No notes captured yet.
              </span>
            )}
          </div>

          {showNotePicker && recentNotes.length > 0 && (
            <div
              style={{
                marginTop: 8,
                border: '1px solid var(--rule)',
                borderRadius: 6,
                background: 'var(--paper-2, #f0eada)',
                // Use flex-column so the action footer pins to the bottom of
                // the picker while only the list scrolls -- this keeps the
                // Add button visible no matter how many notes are loaded.
                display: 'flex',
                flexDirection: 'column',
                maxHeight: 280,
              }}
            >
              <div style={{ padding: '12px 12px 4px', overflowY: 'auto', flex: 1 }}>
                {recentNotes.map(n => (
                  <label
                    key={n.id}
                    style={{
                      display: 'flex',
                      gap: 8,
                      fontSize: 12,
                      color: 'var(--ink-2)',
                      padding: '4px 0',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={pickerSelection.has(n.id)}
                      onChange={() => toggleNoteSelection(n.id)}
                      style={{ marginTop: 2 }}
                    />
                    <span>{n.text.length > 80 ? n.text.slice(0, 80) + '…' : n.text}</span>
                  </label>
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderTop: '1px solid var(--rule)',
                  background: 'var(--paper-2, #f0eada)',
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                  {pickerSelection.size === 0
                    ? 'Pick notes to add to the target words.'
                    : `${pickerSelection.size} selected`}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => { setPickerSelection(new Set()); setShowNotePicker(false); }}
                    className="btn btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyNoteSelection}
                    className="btn btn-clay"
                    style={{ padding: '4px 12px', fontSize: 12 }}
                    disabled={pickerSelection.size === 0}
                  >
                    {pickerSelection.size === 0
                      ? 'Add selections'
                      : `Add ${pickerSelection.size} selection${pickerSelection.size === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Context / setting</label>
          <textarea
            className="input-editorial"
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="e.g. Two coworkers planning a team offsite at a Vietnamese coffee shop."
            style={{ minHeight: 110, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}
      >
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Level</label>
          <select
            className="input-editorial"
            value={level}
            onChange={e => setLevel(e.target.value as ShadowLevel)}
          >
            {LEVELS.map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Speakers</label>
          <select
            className="input-editorial"
            value={speakerCount}
            onChange={e => setSpeakerCount(parseInt(e.target.value, 10))}
          >
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Duration (sec)</label>
          <input
            type="number"
            min={15}
            max={180}
            step={5}
            className="input-editorial"
            value={durationSec}
            onChange={e => setDurationSec(Math.max(15, Math.min(180, parseInt(e.target.value, 10) || 40)))}
          />
        </div>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Default rate</label>
          <input
            type="number"
            min={0.5}
            max={1.5}
            step={0.05}
            className="input-editorial"
            value={rate}
            onChange={e => setRate(Math.max(0.5, Math.min(1.5, parseFloat(e.target.value) || 1)))}
          />
        </div>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Register</label>
          <input
            type="text"
            className="input-editorial"
            value={register}
            onChange={e => setRegister(e.target.value)}
            placeholder="neutral conversational"
          />
        </div>
      </div>

      {weakPhonemes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Include words featuring your weak sounds</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {weakPhonemes.map(sym => {
              const on = enabledPhonemes.has(sym);
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => togglePhoneme(sym)}
                  className={on ? 'btn btn-clay' : 'btn btn-ghost'}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  /{sym}/
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleGenerate}
          className="btn btn-clay"
          disabled={!canSubmit}
          style={{ padding: '8px 16px', fontSize: 13 }}
        >
          {isBusy ? 'Generating with Gemini…' : 'Generate script with Gemini'}
        </button>
        {state.kind === 'running' && (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            stage: {state.stage}{state.detail ? ` (${state.detail})` : ''} · {Math.round(elapsedMs / 1000)}s elapsed
          </span>
        )}
        {state.kind === 'success' && (
          <span style={{ fontSize: 12, color: 'var(--ok, #2e7d32)' }}>
            Script ready: "{state.script.title}" — selected in the player below.
          </span>
        )}
        {state.kind === 'error' && (
          <span style={{ fontSize: 12, color: 'var(--err, #c62828)' }}>
            {state.message}
            <button
              type="button"
              onClick={reset}
              className="btn btn-ghost"
              style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
            >
              Dismiss
            </button>
          </span>
        )}
      </div>

      {state.kind === 'error' && state.raw && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--ink-3)' }}>
            Raw model response (copy if you want to retry manually)
          </summary>
          <textarea
            readOnly
            value={state.raw}
            className="input-editorial"
            style={{ minHeight: 120, marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
          />
        </details>
      )}
    </div>
  );
}
