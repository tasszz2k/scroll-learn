import { useEffect, useRef, useState } from 'react';

export interface SlashMenuItem {
  id: string;
  label: string;
  hint?: string;
  // What to insert at the cursor (replaces the trigger token).
  insert: string;
}

interface SlashMenuProps {
  items: SlashMenuItem[];
  filter: string;
  // Page coords for the popover. Computed by the editor from the textarea
  // caret position; we only render relative to it.
  anchor: { left: number; top: number };
  onPick: (item: SlashMenuItem) => void;
  onDismiss: () => void;
}

// Lightweight popover. The editor owns input focus and forwards arrow /
// enter keys to us via `pendingKey`-style props -- but to keep it simple
// here we own the key handlers directly when open and re-route Escape /
// click-outside to onDismiss.
export default function SlashMenu({ items, filter, anchor, onPick, onDismiss }: SlashMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const filtered = filter
    ? items.filter(i => i.label.toLowerCase().includes(filter.toLowerCase()))
    : items;
  const [active, setActive] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- filter changes invalidate the highlighted index; reset is intentional
    setActive(0);
  }, [filter]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(a => Math.min(a + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(a => Math.max(a - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const pick = filtered[active];
        if (pick) onPick(pick);
        return;
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [filtered, active, onPick, onDismiss]);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onDismiss]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: anchor.left,
        top: anchor.top,
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
        zIndex: 50,
        minWidth: 220,
        maxHeight: 280,
        overflowY: 'auto',
        padding: 4,
      }}
    >
      <div className="mono" style={{ padding: '4px 8px', fontSize: 10, color: 'var(--ink-4)' }}>
        Insert
      </div>
      {filtered.map((item, idx) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item)}
          onMouseEnter={() => setActive(idx)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '6px 10px',
            background: idx === active ? 'rgba(201, 100, 66, 0.08)' : 'transparent',
            border: 'none',
            color: 'var(--ink)',
            fontSize: 12,
            cursor: 'pointer',
            borderRadius: 4,
            textAlign: 'left',
          }}
        >
          <span>{item.label}</span>
          {item.hint && (
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>{item.hint}</span>
          )}
        </button>
      ))}
    </div>
  );
}
