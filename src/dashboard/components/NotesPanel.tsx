import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note, Settings as SettingsType } from '../../common/types';
import { detectVietnamese, translateMany, type TranslateLang } from '../../common/translate';

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
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [plainCopy, setPlainCopy] = useState<CopyState>({ kind: 'idle' });
  const [pairsCopy, setPairsCopy] = useState<CopyState>({ kind: 'idle' });
  const datesPrefilled = useRef(false);

  // Pre-fill the date range to span all existing notes the first time we see any.
  // The user can still edit/clear the inputs after.
  useEffect(() => {
    if (datesPrefilled.current) return;
    if (notes.length === 0) return;
    const earliest = notes.reduce((min, n) => Math.min(min, n.createdAt), Date.now());
    setFromDate(toISODate(earliest));
    setToDate(toISODate(Date.now()));
    datesPrefilled.current = true;
  }, [notes]);

  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const n of notes) set.add(n.domain);
    return Array.from(set).sort();
  }, [notes]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return notes
      .filter(n => {
        if (domainFilter && n.domain !== domainFilter) return false;
        if (needle && !n.text.toLowerCase().includes(needle)) return false;
        if (fromTs !== null && n.createdAt < fromTs) return false;
        if (toTs !== null && n.createdAt > toTs) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [notes, search, domainFilter, fromDate, toDate]);

  // Reset copy states when filtered list changes substantially
  useEffect(() => {
    setPlainCopy({ kind: 'idle' });
    setPairsCopy({ kind: 'idle' });
  }, [filtered.length]);

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
    return filtered
      .map(n => n.text.trim())
      .filter(Boolean)
      .map(text => `- ${text.replace(/\s*\n\s*/g, ' ')}`)
      .join('\n');
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
    const items = filtered.map(n => ({ id: n.id, text: n.text.trim() })).filter(i => i.text);
    if (items.length === 0) return;
    setPairsCopy({ kind: 'translating', done: 0, total: items.length });
    try {
      const map = await translateMany(
        items,
        resolveDirection,
        done => setPairsCopy({ kind: 'translating', done, total: items.length }),
        5,
      );
      const lines = items.map(i => {
        const t = map.get(i.id);
        const translated = t && t.length > 0 ? t : i.text;
        return `${i.text}|${translated}`;
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Notes</h2>
          <p className="text-surface-500 mt-1">
            Selections captured from allowlisted sites. Copy them out to build flashcards in the Import tab.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-surface-200 text-surface-900 hover:bg-surface-300 focus:ring-surface-400 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600"
          >
            Refresh
          </button>
          <button
            onClick={handleClearAll}
            disabled={notes.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-red-600 text-white hover:bg-red-700 focus:ring-red-500"
          >
            Clear all
          </button>
        </div>
      </div>

      {allowlistEmpty && notes.length === 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200">
          No domains in your capture allowlist yet. Open <strong>Settings → Note Capture</strong> and add a domain (for example <code>en.wikipedia.org</code>) to start saving selections.
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
              onChange={e => setSearch(e.target.value)}
              placeholder="Search note text..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">Domain</label>
            <select
              className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              value={domainFilter}
              onChange={e => setDomainFilter(e.target.value)}
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
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-surface-600 dark:text-surface-400 mb-1.5">To</label>
            <input
              type="date"
              className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
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
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500"
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
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-violet-600 text-white hover:bg-violet-700 focus:ring-violet-500"
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
                className="text-xs text-surface-500 hover:text-red-600 dark:hover:text-red-400 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                aria-label="Delete note"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
