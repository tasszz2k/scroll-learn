import { useMemo, useState } from 'react';
import type { Note, Settings as SettingsType } from '../../common/types';
import { detectVietnamese, translateMany, type TranslateLang } from '../../common/translate';
import EditorialHeader from './EditorialHeader';
import PromptGenerator from './PromptGenerator';

interface NotesPanelProps {
  notes: Note[];
  settings: SettingsType;
  onRefresh: () => void;
}

type CopyState =
  | { kind: 'idle' }
  | { kind: 'translating'; done: number; total: number }
  | { kind: 'copied'; label: string }
  | { kind: 'error'; message: string };

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

function toISODate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function NotesPanel({ notes, settings, onRefresh }: NotesPanelProps) {
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('');
  // null = "use derived default from notes"; '' = "user explicitly cleared"
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [plainCopy, setPlainCopy] = useState<CopyState>({ kind: 'idle' });
  const [pairsCopy, setPairsCopy] = useState<CopyState>({ kind: 'idle' });
  const [showPromptGenerator, setShowPromptGenerator] = useState(false);
  const [showClearAfterGenerate, setShowClearAfterGenerate] = useState(false);

  // Anchor "now" once per mount; the panel session is short-lived.
  const [now] = useState(() => Date.now());

  // Derived defaults span all existing notes; the user can still edit/clear them.
  const defaultDates = useMemo(() => {
    if (notes.length === 0) return { from: '', to: '' };
    const earliest = notes.reduce((min, n) => Math.min(min, n.createdAt), now);
    return { from: toISODate(earliest), to: toISODate(now) };
  }, [notes, now]);

  const effectiveFromDate = fromDate ?? defaultDates.from;
  const effectiveToDate = toDate ?? defaultDates.to;

  // Reset copy state at the source of any filter change so it doesn't drift to
  // a stale "Copied!" label after the user narrows the result set.
  function resetCopyState() {
    setPlainCopy(prev => (prev.kind === 'idle' ? prev : { kind: 'idle' }));
    setPairsCopy(prev => (prev.kind === 'idle' ? prev : { kind: 'idle' }));
  }

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) set.add(n.domain);
    return Array.from(set).sort();
  }, [notes]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const fromTs = effectiveFromDate ? new Date(`${effectiveFromDate}T00:00:00`).getTime() : null;
    const toTs = effectiveToDate ? new Date(`${effectiveToDate}T23:59:59.999`).getTime() : null;
    return notes
      .filter(n => {
        if (domainFilter && n.domain !== domainFilter) return false;
        if (needle && !n.text.toLowerCase().includes(needle)) return false;
        if (fromTs !== null && n.createdAt < fromTs) return false;
        if (toTs !== null && n.createdAt > toTs) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, search, domainFilter, effectiveFromDate, effectiveToDate]);

  async function handleDelete(id: string) {
    const response = await chrome.runtime.sendMessage({ type: 'delete_note', noteId: id });
    if (response?.ok) onRefresh();
  }

  async function handleClearAll() {
    if (!confirm('Delete ALL notes? This cannot be undone.')) return;
    const response = await chrome.runtime.sendMessage({ type: 'clear_notes' });
    if (response?.ok) onRefresh();
  }

  function buildPlain(): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of filtered) {
      const text = n.text.trim().replace(/\s*\n\s*/g, ' ');
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`- ${text}`);
    }
    return out.join('\n');
  }

  function uniqueFilteredCount(): number {
    const seen = new Set<string>();
    for (const n of filtered) {
      const t = n.text.trim().toLowerCase();
      if (t) seen.add(t);
    }
    return seen.size;
  }

  async function handleCopyPlain() {
    if (filtered.length === 0) return;
    try {
      await navigator.clipboard.writeText(buildPlain());
      setPlainCopy({ kind: 'copied', label: 'Copied!' });
      setTimeout(() => setPlainCopy({ kind: 'idle' }), 1500);
    } catch (err) {
      setPlainCopy({ kind: 'error', message: 'Copy failed' });
      console.error('[ScrollLearn] Copy plain failed:', err);
      setTimeout(() => setPlainCopy({ kind: 'idle' }), 2000);
    }
  }

  function resolveDirection(text: string): { from: TranslateLang; to: TranslateLang } {
    const dir = settings.noteTranslateDirection;
    if (dir === 'en->vi') return { from: 'en', to: 'vi' };
    if (dir === 'vi->en') return { from: 'vi', to: 'en' };
    // auto
    return detectVietnamese(text)
      ? { from: 'vi', to: 'en' }
      : { from: 'en', to: 'vi' };
  }

  async function handleCopyPairs() {
    if (filtered.length === 0) return;
    // Notes that already carry a stored translation (from auto-translate on capture)
    // skip the re-translation pass to save time and quota.
    const cached = new Map<string, string>();
    const itemsNeedingTranslation: { id: string; text: string }[] = [];
    const orderedTexts: { id: string; text: string }[] = [];
    for (const n of filtered) {
      const text = n.text.trim();
      if (!text) continue;
      orderedTexts.push({ id: n.id, text });
      if (n.translation && n.translation.trim()) {
        cached.set(n.id, n.translation.trim());
      } else {
        itemsNeedingTranslation.push({ id: n.id, text });
      }
    }
    if (orderedTexts.length === 0) return;

    setPairsCopy({ kind: 'translating', done: cached.size, total: orderedTexts.length });
    try {
      let translated = cached;
      if (itemsNeedingTranslation.length > 0) {
        const fresh = await translateMany(
          itemsNeedingTranslation,
          resolveDirection,
          done => setPairsCopy({
            kind: 'translating',
            done: cached.size + done,
            total: orderedTexts.length,
          }),
          5,
        );
        translated = new Map(cached);
        for (const [k, v] of fresh) translated.set(k, v);
      }
      const lines = orderedTexts.map(i => {
        const t = translated.get(i.id);
        const value = t && t.length > 0 ? t : i.text;
        return `${i.text}|${value}`;
      });
      await navigator.clipboard.writeText(lines.join('\n'));
      setPairsCopy({ kind: 'copied', label: 'Copied!' });
      setTimeout(() => setPairsCopy({ kind: 'idle' }), 1500);
    } catch (err) {
      setPairsCopy({ kind: 'error', message: 'Copy failed' });
      console.error('[ScrollLearn] Copy pairs failed:', err);
      setTimeout(() => setPairsCopy({ kind: 'idle' }), 2000);
    }
  }

  const allowlistEmpty = settings.noteCaptureAllowlist.length === 0;

  return (
    <div className="space-y-6">
      <EditorialHeader
        kicker="03 · Notes"
        title={
          <>
            Selections, <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>captured</span> from the wild.
          </>
        }
        sub="Highlights from allowlisted sites. Copy them out to build flashcards in the Import tab."
        action={
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowPromptGenerator(s => !s)}
              disabled={notes.length === 0 && !showPromptGenerator}
            >
              {showPromptGenerator ? 'Hide AI prompt' : 'AI prompt'}
            </button>
            <button onClick={onRefresh} className="btn btn-ghost" type="button">
              Refresh
            </button>
            <button
              onClick={handleClearAll}
              disabled={notes.length === 0}
              className="btn"
              type="button"
              style={{
                background: 'transparent',
                color: 'var(--rose)',
                border: '1px solid var(--rose)',
              }}
            >
              Clear all
            </button>
          </div>
        }
      />

      {showPromptGenerator && (
        <>
          <PromptGenerator
            initialInput={buildPlain()}
            inputPlaceholder="Filtered notes will be used as source. Edit to refine, or paste your own."
            defaultCardCount={Math.max(20, uniqueFilteredCount() * 2)}
            mode="translation"
            defaultDirection={settings.noteTranslateDirection === 'vi->en' ? 'vi->en' : 'en->vi'}
            onGenerated={() => setShowClearAfterGenerate(true)}
          />
          {showClearAfterGenerate && notes.length > 0 && (
            <div
              className="card-flat"
              style={{
                padding: '14px 18px',
                marginTop: -20,
                marginBottom: 32,
                background: 'rgba(184,146,58,.08)',
                borderColor: 'rgba(184,146,58,.30)',
                color: '#6E5A20',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span>
                Prompt generated. Done with these notes? Clear them so new captures start fresh.
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={() => setShowClearAfterGenerate(false)}
                >
                  Keep notes
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    background: 'transparent',
                    color: 'var(--rose)',
                    border: '1px solid var(--rose)',
                    padding: '6px 12px',
                    fontSize: 12,
                  }}
                  onClick={async () => {
                    await handleClearAll();
                    setShowClearAfterGenerate(false);
                  }}
                >
                  Clear all notes
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {allowlistEmpty && notes.length === 0 && (
        <div
          className="card-flat"
          style={{
            padding: '14px 18px',
            background: 'rgba(184,146,58,.08)',
            borderColor: 'rgba(184,146,58,.30)',
            color: '#6E5A20',
            fontSize: 13,
          }}
        >
          No domains in your capture allowlist yet. Open <strong>Settings → Note Capture</strong> and add a domain (for example <code className="mono" style={{ background: 'var(--paper-2)', padding: '1px 4px', borderRadius: 3 }}>en.wikipedia.org</code>) to start saving selections.
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">Search</label>
            <input
              type="text"
              className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              value={search}
              onChange={e => { setSearch(e.target.value); resetCopyState(); }}
              placeholder="Search note text..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">Domain</label>
            <select
              className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              value={domainFilter}
              onChange={e => { setDomainFilter(e.target.value); resetCopyState(); }}
            >
              <option value="">All domains</option>
              {domains.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">From</label>
            <input
              type="date"
              className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              value={effectiveFromDate}
              onChange={e => { setFromDate(e.target.value); resetCopyState(); }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">To</label>
            <input
              type="date"
              className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              value={effectiveToDate}
              onChange={e => { setToDate(e.target.value); resetCopyState(); }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-200 dark:border-surface-700 flex-wrap gap-3">
          <div className="text-sm text-surface-500">
            {filtered.length} of {notes.length} note{notes.length === 1 ? '' : 's'}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleCopyPlain}
              disabled={filtered.length === 0 || plainCopy.kind === 'translating'}
              type="button"
              className="btn btn-clay"
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              {plainCopy.kind === 'copied'
                ? plainCopy.label
                : plainCopy.kind === 'error'
                  ? plainCopy.message
                  : 'Copy filtered'}
            </button>
            <button
              onClick={handleCopyPairs}
              disabled={filtered.length === 0 || pairsCopy.kind === 'translating'}
              type="button"
              className="btn btn-dark"
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              {pairsCopy.kind === 'translating'
                ? `Translating... ${pairsCopy.done}/${pairsCopy.total}`
                : pairsCopy.kind === 'copied'
                  ? pairsCopy.label
                  : pairsCopy.kind === 'error'
                    ? pairsCopy.message
                    : 'Copy EN↔VI pairs'}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-10 shadow-sm dark:border-surface-800 dark:bg-surface-900 text-center text-surface-500">
          {notes.length === 0
            ? 'No notes yet. Add domains in Settings → Note Capture to start saving selections.'
            : 'No notes match the current filters.'}
        </div>
      ) : (
        <div className="rounded-xl border border-surface-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900 divide-y divide-surface-100 dark:divide-surface-800">
          {filtered.map(note => (
            <div key={note.id} className="p-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-surface-900 dark:text-surface-100 whitespace-pre-wrap break-words">
                  {note.text}
                </div>
                {note.translation && (
                  <div
                    className="mt-1 text-sm whitespace-pre-wrap break-words"
                    style={{ color: 'var(--clay-deep)', fontStyle: 'italic' }}
                    title={note.translationLang ? `Translated to ${note.translationLang.toUpperCase()}` : 'Translation'}
                  >
                    {note.translation}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-500">
                  <a
                    href={note.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate max-w-[28ch] hover:text-primary-600 dark:hover:text-primary-400"
                    title={note.pageTitle || note.url}
                  >
                    {note.pageTitle || note.url}
                  </a>
                  <span className="px-2 py-0.5 rounded-full bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300">
                    {note.domain}
                  </span>
                  <span title={formatDate(note.createdAt)}>{toISODate(note.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={() => handleDelete(note.id)}
                type="button"
                className="ulink"
                aria-label="Delete note"
                style={{
                  background: 'none',
                  padding: 0,
                  fontSize: 12,
                  color: 'var(--rose)',
                  borderBottomColor: 'var(--rose)',
                  cursor: 'pointer',
                }}
              >
                delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
