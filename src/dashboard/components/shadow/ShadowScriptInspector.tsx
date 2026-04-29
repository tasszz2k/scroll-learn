import { useEffect, useMemo, useState } from 'react';
import type { ShadowLevel, ShadowLine, ShadowScript } from '../../../common/types';
import Select from '../Select';

type Tab = 'raw' | 'sound' | 'edit';

interface ShadowScriptInspectorProps {
  script: ShadowScript;
  onClose: () => void;
  onSave: (next: ShadowScript) => void | Promise<void>;
}

const LEVEL_OPTIONS: { value: ShadowLevel; label: string }[] = [
  { value: 'A1', label: 'A1' },
  { value: 'A2', label: 'A2' },
  { value: 'B1', label: 'B1' },
  { value: 'B2', label: 'B2' },
  { value: 'C1', label: 'C1' },
  { value: 'C2', label: 'C2' },
];

interface DraftLine {
  speaker: string;
  text: string;
  glossVi: string;
  ipaFocus: string[];
}

function toDraft(lines: ShadowLine[]): DraftLine[] {
  return lines.map(l => ({
    speaker: l.speaker,
    text: l.text,
    glossVi: l.glossVi ?? '',
    ipaFocus: l.ipaFocus ?? [],
  }));
}

function buildSoundScript(script: ShadowScript): string {
  return script.lines.map(l => `${l.speaker}: ${l.text}`).join('\n');
}

function buildRawJson(script: ShadowScript): string {
  return JSON.stringify(script, null, 2);
}

export default function ShadowScriptInspector({
  script,
  onClose,
  onSave,
}: ShadowScriptInspectorProps) {
  const [tab, setTab] = useState<Tab>('raw');
  const [title, setTitle] = useState(script.title);
  const [level, setLevel] = useState<ShadowLevel>(script.level);
  const [draftLines, setDraftLines] = useState<DraftLine[]>(() => toDraft(script.lines));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // If the parent swaps the script underneath us, reset local edit state.
  useEffect(() => {
    setTitle(script.title);
    setLevel(script.level);
    setDraftLines(toDraft(script.lines));
    setError(null);
  }, [script]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dirty = useMemo(() => {
    if (title.trim() !== script.title) return true;
    if (level !== script.level) return true;
    if (draftLines.length !== script.lines.length) return true;
    for (let i = 0; i < draftLines.length; i++) {
      const a = draftLines[i];
      const b = script.lines[i];
      if (a.speaker.trim() !== b.speaker) return true;
      if (a.text.trim() !== b.text) return true;
      if ((a.glossVi.trim() || '') !== (b.glossVi ?? '')) return true;
    }
    return false;
  }, [title, level, draftLines, script]);

  const rawJson = useMemo(() => buildRawJson(script), [script]);
  const soundScript = useMemo(() => buildSoundScript(script), [script]);

  async function handleSave() {
    if (!dirty || saving) return;
    const cleanedTitle = title.trim();
    if (!cleanedTitle) {
      setError('Title cannot be empty.');
      return;
    }
    const lines: ShadowLine[] = [];
    for (let i = 0; i < draftLines.length; i++) {
      const d = draftLines[i];
      const speaker = d.speaker.trim();
      const text = d.text.trim();
      if (!speaker) {
        setError(`Line ${i + 1} is missing a speaker.`);
        return;
      }
      if (!text) {
        setError(`Line ${i + 1} is missing text.`);
        return;
      }
      const line: ShadowLine = { speaker, text };
      const gloss = d.glossVi.trim();
      if (gloss) line.glossVi = gloss;
      if (d.ipaFocus.length > 0) line.ipaFocus = d.ipaFocus;
      lines.push(line);
    }
    const next: ShadowScript = {
      ...script,
      title: cleanedTitle,
      level,
      lines,
    };
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(idx: number, patch: Partial<DraftLine>) {
    setDraftLines(prev => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Best-effort; ignore failures (e.g. document not focused).
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shadow-inspector-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(31, 27, 22, 0.45)',
        backdropFilter: 'saturate(140%) blur(4px)',
        WebkitBackdropFilter: 'saturate(140%) blur(4px)',
        padding: 16,
        animation: 'sl-confirm-fade .14s ease-out',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 880,
          maxHeight: 'calc(100vh - 32px)',
          background: 'var(--card)',
          color: 'var(--ink)',
          border: '1px solid var(--rule-2)',
          borderRadius: 14,
          boxShadow: '0 20px 50px -12px rgba(31, 27, 22, 0.35), 0 4px 12px -4px rgba(31, 27, 22, 0.2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'sl-confirm-pop .18s cubic-bezier(.2,.9,.3,1.2)',
        }}
      >
        <div style={{ padding: '20px 24px 12px', borderBottom: '1px solid var(--rule)' }}>
          <div className="eyebrow" style={{ color: 'var(--clay)', fontSize: 10, marginBottom: 6 }}>
            Script inspector
          </div>
          <h2
            id="shadow-inspector-title"
            className="serif"
            style={{ fontSize: 20, lineHeight: 1.25, margin: 0, color: 'var(--ink)' }}
          >
            {script.title}
          </h2>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 6, letterSpacing: '.04em' }}>
            {script.level} · {script.lines.length} {script.lines.length === 1 ? 'LINE' : 'LINES'} · {script.speakerCount} {script.speakerCount === 1 ? 'SPEAKER' : 'SPEAKERS'}
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Script views"
          style={{
            display: 'flex',
            gap: 4,
            padding: '8px 16px 0',
            borderBottom: '1px solid var(--rule)',
            background: 'var(--paper-2)',
          }}
        >
          {(
            [
              { id: 'raw' as Tab, label: 'Raw script' },
              { id: 'sound' as Tab, label: 'Sound script' },
              { id: 'edit' as Tab, label: 'Edit' },
            ]
          ).map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => { setTab(t.id); setError(null); }}
                className={active ? 'btn btn-clay' : 'btn btn-ghost'}
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  borderBottomLeftRadius: 0,
                  borderBottomRightRadius: 0,
                  borderBottom: active ? '1px solid var(--clay)' : '1px solid transparent',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div style={{ padding: 20, overflow: 'auto', flex: 1, minHeight: 240 }}>
          {tab === 'raw' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                  Saved JSON (read-only)
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => handleCopy(rawJson)}
                >
                  Copy
                </button>
              </div>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  padding: 14,
                  background: 'var(--paper-2)',
                  border: '1px solid var(--rule)',
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--ink-2)',
                  whiteSpace: 'pre',
                  overflow: 'auto',
                  maxHeight: '60vh',
                }}
              >
                {rawJson}
              </pre>
            </div>
          )}

          {tab === 'sound' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                  TTS-ready transcript (read-only)
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '4px 10px', fontSize: 11 }}
                  onClick={() => handleCopy(soundScript)}
                >
                  Copy
                </button>
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '0 0 8px', lineHeight: 1.5 }}>
                One line per turn, in the form <span className="mono">SPEAKER: text</span>. The player feeds the
                raw <span className="mono">text</span> portion to the selected TTS provider verbatim, including
                pacing punctuation like <span className="mono">...</span> and <span className="mono">--</span>.
              </p>
              <pre
                className="mono"
                style={{
                  margin: 0,
                  padding: 14,
                  background: 'var(--paper-2)',
                  border: '1px solid var(--rule)',
                  borderRadius: 8,
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: 'var(--ink-2)',
                  whiteSpace: 'pre-wrap',
                  overflow: 'auto',
                  maxHeight: '60vh',
                }}
              >
                {soundScript}
              </pre>
            </div>
          )}

          {tab === 'edit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 320px' }}>
                  <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-4)' }}>Title</span>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="input-editorial"
                    style={{ padding: '8px 10px', fontSize: 14 }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 120px' }}>
                  <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-4)' }}>Level</span>
                  <Select<ShadowLevel>
                    value={level}
                    options={LEVEL_OPTIONS}
                    onChange={setLevel}
                    width="100%"
                    ariaLabel="CEFR level"
                  />
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span className="eyebrow" style={{ fontSize: 10, color: 'var(--ink-4)' }}>Lines</span>
                {draftLines.map((d, i) => (
                  <div
                    key={i}
                    className="card-flat"
                    style={{
                      padding: 12,
                      background: 'var(--paper-2)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-4)',
                          minWidth: 28,
                          letterSpacing: '.04em',
                        }}
                      >
                        #{i + 1}
                      </span>
                      <input
                        type="text"
                        value={d.speaker}
                        onChange={e => updateDraft(i, { speaker: e.target.value })}
                        className="input-editorial mono"
                        style={{ padding: '4px 8px', fontSize: 12, width: 60, textAlign: 'center' }}
                        aria-label={`Speaker for line ${i + 1}`}
                      />
                      {d.ipaFocus.length > 0 && (
                        <span
                          className="mono"
                          style={{
                            fontSize: 10,
                            color: 'var(--ink-4)',
                            letterSpacing: '.04em',
                          }}
                          title="IPA focus phonemes (preserved on save)"
                        >
                          IPA: {d.ipaFocus.join(' ')}
                        </span>
                      )}
                    </div>
                    <textarea
                      value={d.text}
                      onChange={e => updateDraft(i, { text: e.target.value })}
                      className="input-editorial"
                      rows={2}
                      style={{ padding: '8px 10px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }}
                      aria-label={`Text for line ${i + 1}`}
                    />
                    <textarea
                      value={d.glossVi}
                      onChange={e => updateDraft(i, { glossVi: e.target.value })}
                      placeholder="Vietnamese gloss (optional)"
                      className="input-editorial"
                      rows={1}
                      style={{
                        padding: '6px 10px',
                        fontSize: 13,
                        resize: 'vertical',
                        color: 'var(--ink-2)',
                        fontStyle: 'italic',
                        fontFamily: 'inherit',
                      }}
                      aria-label={`Vietnamese gloss for line ${i + 1}`}
                    />
                  </div>
                ))}
              </div>

              {error && (
                <div
                  className="mono"
                  role="alert"
                  style={{
                    fontSize: 12,
                    padding: '8px 12px',
                    background: 'rgba(198, 40, 40, 0.08)',
                    border: '1px solid var(--rose, #c62828)',
                    borderRadius: 6,
                    color: 'var(--rose, #c62828)',
                  }}
                >
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--rule)',
            background: 'var(--paper-2)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            Close
          </button>
          {tab === 'edit' && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className="btn btn-clay"
              style={{ padding: '8px 18px', fontSize: 13 }}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
