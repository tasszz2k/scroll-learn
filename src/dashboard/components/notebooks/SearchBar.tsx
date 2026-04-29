import { useEffect, useRef, useState } from 'react';
import type { Notebook } from '../../../common/types';
import {
  quickOpenSearch,
  runFullTextSearch,
  type NotebookSearchHit,
} from '../../../common/notebookSearch';

export type SearchMode = 'quick' | 'fulltext';

interface SearchBarProps {
  notebooks: Notebook[];
  mode: SearchMode;
  onPick: (id: string) => void;
  onClose: () => void;
}

export default function SearchBar({ notebooks, mode, onPick, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NotebookSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Bumps on every search invocation so older async runs can be ignored.
  const searchSeqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Re-run the search whenever the query changes. Quick-open is sync;
  // full-text walks IndexedDB, so we guard against stale results with a
  // monotonically-increasing seq number.
  /* eslint-disable react-hooks/set-state-in-effect -- search is a derived projection of (mode, query, notebooks); the seq guard makes async writes safe */
  useEffect(() => {
    const seq = ++searchSeqRef.current;
    if (mode === 'quick') {
      const next = quickOpenSearch(notebooks, query, { limit: 50 });
      if (seq === searchSeqRef.current) {
        setHits(next);
        setActive(0);
      }
      return;
    }
    if (!query.trim()) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    void runFullTextSearch(notebooks, query, { limit: 50 }).then((next) => {
      if (seq !== searchSeqRef.current) return;
      setHits(next);
      setActive(0);
      setBusy(false);
    });
  }, [query, mode, notebooks]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(a => Math.min(a + 1, hits.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => Math.max(a - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = hits[active];
      if (pick) onPick(pick.notebookId);
      return;
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 27, 22, 0.4)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 90,
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 8,
          width: 'min(640px, 92vw)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', minWidth: 60 }}>
            {mode === 'quick' ? 'Open' : 'Search'}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={mode === 'quick' ? 'Type a notebook title or tag...' : 'Search across every notebook...'}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--ink)',
              fontSize: 14,
            }}
          />
          {busy && <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>...</span>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {hits.length === 0 && query.trim() !== '' && !busy && (
            <div style={{ padding: 16, color: 'var(--ink-3)', fontSize: 12 }}>
              No matches.
            </div>
          )}
          {hits.map((hit, idx) => {
            const isActive = idx === active;
            return (
              <button
                key={hit.notebookId}
                type="button"
                onClick={() => onPick(hit.notebookId)}
                onMouseEnter={() => setActive(idx)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 14px',
                  background: isActive ? 'rgba(201, 100, 66, 0.08)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                    <span className="display" style={{ fontSize: 14, color: 'var(--ink)' }}>
                      {hit.title || 'Untitled'}
                    </span>
                    {hit.tags.length > 0 && (
                      <span className="mono" style={{ fontSize: 10, color: 'var(--clay)' }}>
                        {hit.tags.slice(0, 3).map(t => `#${t}`).join(' ')}
                      </span>
                    )}
                  </div>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
                    {hit.folderPath || '/'}
                  </span>
                </div>
                {hit.snippet && (
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, fontStyle: 'italic' }}>
                    {hit.snippet}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
