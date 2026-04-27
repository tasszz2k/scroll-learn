import { useState, useRef } from 'react';
import type { Deck, Card, ParsedCard, Response } from '../../common/types';
import { parseSimpleFormat, parseCSV, parseJSON } from '../../common/parser';
import EditorialHeader from './EditorialHeader';
import PromptGenerator from './PromptGenerator';

type ImportFormat = 'simple' | 'csv' | 'json';

interface ImportPanelProps {
  decks: Deck[];
  onImport: (cards: Card[], deckId: string) => Promise<Response<{ inserted: number }>>;
  onCreateDeck: (deck: Omit<Deck, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Response<Deck>>;
}

const numberFmt = new Intl.NumberFormat('en-US').format;

const FORMAT_TABS: { value: ImportFormat; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
];

const PLACEHOLDERS: Record<ImportFormat, string> = {
  simple:
`[deck:Spanish, Volume I]
Hola|Hello
¿Cómo estás?|How are you?
Capital of Spain?|Madrid|Barcelona|Lisbon|Paris
Yo ___ a la tienda.|fui   {cloze}`,
  csv:
`deck,kind,front,back,options,correct,tags
Math,text,What is 2+2?,4,,,basics
Math,mcq-single,3+3?,6,6|7|8|9,0,arithmetic`,
  json:
`[
  { "front": "What is 2+2?", "back": "4", "kind": "text" },
  { "front": "3+3?", "back": "6", "kind": "mcq-single", "options": ["6","7","8","9"], "correct": 0 }
]`,
};

function shortKind(kind: ParsedCard['kind']): string {
  switch (kind) {
    case 'mcq-single': return 'mcq';
    case 'mcq-multi': return 'mcq+';
    case 'cloze': return 'cloze';
    case 'audio': return 'audio';
    default: return 'text';
  }
}

export default function ImportPanel({ decks, onImport, onCreateDeck }: ImportPanelProps) {
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [content, setContent] = useState('');
  const [separator, setSeparator] = useState('|');
  const [selectedDeck, setSelectedDeck] = useState<string>(decks[0]?.id || '');
  const [newDeckName, setNewDeckName] = useState('');
  const [createNewDeck, setCreateNewDeck] = useState(decks.length === 0);
  const [parsedCards, setParsedCards] = useState<ParsedCard[]>([]);
  const [errors, setErrors] = useState<Array<{ line: number; message: string; raw: string }>>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAllCards, setShowAllCards] = useState(false);

  const [showPromptGenerator, setShowPromptGenerator] = useState(false);

  function handleParse() {
    let result;
    switch (format) {
      case 'simple': result = parseSimpleFormat(content, separator); break;
      case 'csv':    result = parseCSV(content); break;
      case 'json':   result = parseJSON(content); break;
    }
    setParsedCards(result.cards);
    setErrors(result.errors);
    setImportResult(null);
    setShowAllCards(false);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setContent(text);
      if (file.name.endsWith('.json')) setFormat('json');
      else if (file.name.endsWith('.csv')) setFormat('csv');
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (parsedCards.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      let targetDeckId = selectedDeck;
      if (createNewDeck && newDeckName.trim()) {
        const r = await onCreateDeck({ name: newDeckName.trim(), description: `Imported ${parsedCards.length} cards` });
        if (r.ok && r.data) targetDeckId = r.data.id;
        else throw new Error('Failed to create deck');
      }
      if (!targetDeckId) throw new Error('No deck selected');
      const cardsToImport = parsedCards.map(pc => ({
        deckId: targetDeckId,
        kind: pc.kind,
        front: pc.front,
        back: pc.back,
        options: pc.options,
        correct: pc.correct,
        canonicalAnswers: pc.canonicalAnswers,
        mediaUrl: pc.mediaUrl,
        tags: pc.tags,
      })) as unknown as Card[];
      const result = await onImport(cardsToImport, targetDeckId);
      if (result.ok) {
        setImportResult({ success: true, count: result.data?.inserted || parsedCards.length });
        setParsedCards([]);
        setContent('');
      } else {
        throw new Error('Import failed');
      }
    } catch (error) {
      setImportResult({ success: false, count: 0 });
      console.error('Import error:', error);
    } finally {
      setImporting(false);
    }
  }

  function clearAll() {
    setContent('');
    setParsedCards([]);
    setErrors([]);
    setImportResult(null);
    setShowAllCards(false);
  }

  const lineCount = content.split('\n').filter(l => l.trim()).length;
  const previewCards = showAllCards ? parsedCards : parsedCards.slice(0, 5);
  const importDisabled = importing || parsedCards.length === 0 || (createNewDeck ? !newDeckName.trim() : !selectedDeck);

  return (
    <div>
      <EditorialHeader
        kicker="04 · Import"
        title={
          <>
            Bring in cards from{' '}
            <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>plaintext</span>, CSV, or JSON.
          </>
        }
        sub="Three formats, one preview. Paste below, choose a target deck, and inspect before committing."
        action={
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowPromptGenerator(s => !s)}
          >
            {showPromptGenerator ? 'Hide AI prompt' : 'AI prompt'}
          </button>
        }
      />

      {showPromptGenerator && <PromptGenerator />}

      {/* Two-column main */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 40 }}>
        {/* LEFT — source / target / actions */}
        <div>
          <div className="eyebrow">A · Source</div>

          {/* Format tabs */}
          <div style={{ display: 'flex', gap: 0, marginTop: 10, borderBottom: '1px solid var(--rule)' }}>
            {FORMAT_TABS.map(opt => {
              const active = format === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFormat(opt.value)}
                  style={{
                    padding: '10px 18px',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    fontSize: 13,
                    fontWeight: 500,
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--clay)' : '2px solid transparent',
                    marginBottom: -1,
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Paste area */}
          <div className="card-flat" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none' }}>
            <textarea
              className="mono"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={PLACEHOLDERS[format]}
              spellCheck={false}
              style={{
                width: '100%',
                margin: 0,
                padding: '20px 22px',
                fontSize: 13,
                lineHeight: 1.7,
                color: 'var(--ink-2)',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                resize: 'vertical',
                minHeight: 220,
                fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
                boxSizing: 'border-box',
              }}
            />
            <div
              style={{
                padding: '12px 22px',
                borderTop: '1px solid var(--rule)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'var(--paper-2)',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                {numberFmt(lineCount)} {lineCount === 1 ? 'line' : 'lines'}
                {parsedCards.length > 0 && ` · ${numberFmt(parsedCards.length)} ${parsedCards.length === 1 ? 'card' : 'cards'} parsed`}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".txt,.csv,.json"
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >
                  Upload file
                </button>
                {content && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="btn btn-ghost"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!content.trim()}
                  className="btn btn-dark"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                >
                  Parse
                </button>
              </div>
            </div>
          </div>

          {/* Separator (Simple format only) */}
          {format === 'simple' && (
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="eyebrow">Separator</span>
              <input
                type="text"
                className="input-editorial"
                value={separator}
                onChange={e => setSeparator(e.target.value || '|')}
                maxLength={1}
                style={{ width: 80 }}
              />
            </div>
          )}

          {/* Target deck */}
          <div style={{ marginTop: 24 }}>
            <div className="eyebrow">B · Target deck</div>
            <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 13, color: 'var(--ink-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: decks.length === 0 ? 'not-allowed' : 'pointer' }}>
                <input
                  type="radio"
                  checked={!createNewDeck}
                  onChange={() => setCreateNewDeck(false)}
                  disabled={decks.length === 0}
                  style={{ accentColor: 'var(--clay)' }}
                />
                Existing deck
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={createNewDeck}
                  onChange={() => setCreateNewDeck(true)}
                  style={{ accentColor: 'var(--clay)' }}
                />
                New deck
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              {createNewDeck ? (
                <input
                  type="text"
                  className="input-editorial"
                  value={newDeckName}
                  onChange={e => setNewDeckName(e.target.value)}
                  placeholder="New deck name"
                />
              ) : (
                <select
                  className="input-editorial"
                  value={selectedDeck}
                  onChange={e => setSelectedDeck(e.target.value)}
                  disabled={decks.length === 0}
                >
                  {decks.length === 0 ? (
                    <option value="">No decks available</option>
                  ) : (
                    decks.map(deck => (
                      <option key={deck.id} value={deck.id}>{deck.name}</option>
                    ))
                  )}
                </select>
              )}
            </div>
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="card-flat" style={{ marginTop: 20, padding: '14px 18px', borderColor: 'rgba(196,115,107,.45)', background: 'rgba(196,115,107,.06)' }}>
              <div className="eyebrow" style={{ color: '#8A4A42' }}>{errors.length} {errors.length === 1 ? 'error' : 'errors'}</div>
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                {errors.slice(0, 5).map((err, i) => (
                  <li key={i} className="mono" style={{ fontSize: 12, color: '#8A4A42' }}>
                    Line {err.line}: {err.message}
                    {err.raw && (
                      <span style={{ marginLeft: 8, opacity: .7 }}>({err.raw.slice(0, 30)}…)</span>
                    )}
                  </li>
                ))}
                {errors.length > 5 && (
                  <li className="mono" style={{ fontSize: 12, color: '#8A4A42', opacity: .7 }}>
                    …and {errors.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Import action bar */}
          <div style={{ marginTop: 24, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleImport}
              disabled={importDisabled}
              className="btn btn-clay"
            >
              {importing
                ? 'Importing…'
                : parsedCards.length > 0
                  ? `Import ${numberFmt(parsedCards.length)} ${parsedCards.length === 1 ? 'card' : 'cards'} →`
                  : 'Import →'}
            </button>
            {parsedCards.length > 0 && (
              <button type="button" onClick={clearAll} className="btn btn-ghost">
                Cancel
              </button>
            )}
          </div>

          {/* Result banner */}
          {importResult && (
            <div
              className="card-flat"
              style={{
                marginTop: 18,
                padding: '14px 18px',
                background: importResult.success ? 'rgba(110,123,92,.10)' : 'rgba(196,115,107,.10)',
                borderColor: importResult.success ? 'rgba(110,123,92,.30)' : 'rgba(196,115,107,.30)',
              }}
            >
              <div className="eyebrow" style={{ color: importResult.success ? '#4F5B40' : '#8A4A42' }}>
                {importResult.success ? `Imported ${numberFmt(importResult.count)} cards` : 'Import failed'}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — preview + pipeline */}
        <div>
          <div className="eyebrow">
            C · Preview {parsedCards.length > 0 && `· ${numberFmt(parsedCards.length)} ${parsedCards.length === 1 ? 'card' : 'cards'}`}
          </div>
          {parsedCards.length === 0 ? (
            <div
              className="card-flat"
              style={{
                marginTop: 10,
                padding: '40px 24px',
                textAlign: 'center',
                color: 'var(--ink-3)',
                fontSize: 13,
              }}
            >
              Paste source on the left, then press <span className="mono" style={{ fontSize: 12, padding: '1px 6px', border: '1px solid var(--rule-2)', borderRadius: 4, background: 'var(--paper-2)' }}>Parse</span>.
            </div>
          ) : (
            <table className="dtable" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th style={{ width: 80 }}>Type</th>
                  <th>Front</th>
                  <th>Back</th>
                </tr>
              </thead>
              <tbody>
                {previewCards.map((card, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: 'var(--ink-4)' }}>{String(i + 1).padStart(2, '0')}</td>
                    <td><span className="pill">{shortKind(card.kind)}</span></td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {card.front}
                    </td>
                    <td className="serif" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {Array.isArray(card.back) ? card.back.join(', ') : card.back}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {parsedCards.length > 5 && (
            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setShowAllCards(v => !v)}
                className="ulink"
                style={{ background: 'none', padding: 0, fontSize: 12, cursor: 'pointer' }}
              >
                {showAllCards ? 'show less' : `show all ${numberFmt(parsedCards.length)}`}
              </button>
            </div>
          )}

          {/* Pipeline ASCII */}
          <div style={{ marginTop: 28 }}>
            <div className="eyebrow">Pipeline</div>
            <pre className="ascii" style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.55 }}>
{`  paste / upload
        │
        ▼
  ┌───────────────┐    ┌───────────────┐
  │   PARSER      │──▶ │  VALIDATOR    │
  │   simple|csv  │    │  dedupe · fmt │
  │   json        │    │               │
  └───────────────┘    └───────┬───────┘
                               │
                               ▼
                       ┌───────────────┐
                       │  TARGET DECK  │
                       │  ${(decks.find(d => d.id === selectedDeck)?.name || newDeckName || '— none —').padEnd(11).slice(0, 11)}  │
                       └───────────────┘`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
