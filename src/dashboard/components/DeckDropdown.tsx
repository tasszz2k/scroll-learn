import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { Deck } from '@/common/types';

type Variant = 'compact' | 'rich';

interface DeckDropdownProps {
  decks: Deck[];
  activeDeckId: string;
  totalDue: number;
  dueByDeck: Map<string, number>;
  cardCountByDeck?: Map<string, number>;
  allLabel?: string;
  allHint?: string;
  variant?: Variant;
  onChange: (deckId: string) => void;
}

interface OptionRow {
  id: string;
  name: string;
  due: number;
  count?: number;
}

export default function DeckDropdown({
  decks,
  activeDeckId,
  totalDue,
  dueByDeck,
  cardCountByDeck,
  allLabel = 'All decks',
  allHint,
  variant = 'compact',
  onChange,
}: DeckDropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo<OptionRow[]>(() => {
    const all: OptionRow = { id: '', name: allLabel, due: totalDue };
    const rest: OptionRow[] = decks.map(d => ({
      id: d.id,
      name: d.name,
      due: dueByDeck.get(d.id) || 0,
      count: cardCountByDeck?.get(d.id),
    }));
    return [all, ...rest];
  }, [decks, dueByDeck, cardCountByDeck, totalDue, allLabel]);

  const activeIndex = useMemo(
    () => Math.max(0, options.findIndex(o => o.id === activeDeckId)),
    [options, activeDeckId]
  );

  const activeOption = options[activeIndex];
  const activeLabel = activeOption?.name ?? allLabel;
  const activeDue = activeOption?.due ?? 0;
  const activeCount = activeOption?.count;
  const activeIsAll = (activeOption?.id ?? '') === '';

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Outside click + escape
  useEffect(() => {
    if (!open) return;
    function onDocClick(ev: MouseEvent) {
      const t = ev.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        close();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  // On open: take focus and scroll active row into view (highlight is set
  // synchronously by the trigger handler, not in an effect).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      panelRef.current?.focus();
      const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, activeIndex]);

  function commit(idx: number) {
    const opt = options[idx];
    if (!opt) return;
    if (opt.id !== activeDeckId) onChange(opt.id);
    close();
  }

  function openDropdown() {
    setHighlight(activeIndex);
    setOpen(true);
  }

  function onTriggerClick() {
    if (open) {
      setOpen(false);
    } else {
      openDropdown();
    }
  }

  function onTriggerKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      openDropdown();
    }
  }

  function onListKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setHighlight(h => Math.min(options.length - 1, h + 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      setHighlight(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      setHighlight(options.length - 1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      commit(highlight);
    } else if (ev.key === 'Tab') {
      setOpen(false);
    }
  }

  // Keep highlighted row visible during keyboard nav
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  // ----- Trigger renderers -----------------------------------------------

  const compactTrigger = (
    <>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {activeLabel}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: '.08em',
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
          }}
        >
          {activeDue} due
        </span>
        <Chevron open={open} />
      </span>
    </>
  );

  const richTrigger = (
    <>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 1 }}>
        <span
          className="serif"
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: activeIsAll ? 'var(--ink-3)' : 'var(--ink)',
            fontStyle: activeIsAll ? 'italic' : 'normal',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {activeLabel}
        </span>
        <span
          style={{
            fontSize: 11.5,
            color: 'var(--ink-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {activeIsAll
            ? (allHint ?? `${activeDue} due across all decks`)
            : `${activeCount ?? 0} ${activeCount === 1 ? 'card' : 'cards'}${activeDue > 0 ? ` · ${activeDue} due` : ''}`}
        </span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {activeDue > 0
          ? <span className="pill pill-clay">{activeDue}</span>
          : <span className="pill">none due</span>}
        <Chevron open={open} />
      </span>
    </>
  );

  const triggerStyle: React.CSSProperties = variant === 'rich'
    ? {
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        background: 'var(--card)',
        border: '1px solid var(--rule-2)',
        borderRadius: 10,
        color: 'var(--ink)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'border-color .15s, box-shadow .15s',
        boxShadow: open ? '0 0 0 3px var(--clay-tint)' : 'none',
        borderColor: open ? 'var(--clay)' : 'var(--rule-2)',
      }
    : {
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '8px 12px',
        background: 'var(--paper)',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        color: 'var(--ink)',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'border-color .15s, box-shadow .15s',
        boxShadow: open ? '0 0 0 3px var(--clay-tint)' : 'none',
        borderColor: open ? 'var(--clay)' : 'var(--rule-2)',
      };

  return (
    <div
      style={{
        position: 'relative',
        flex: variant === 'rich' ? undefined : 1,
        minWidth: 0,
        width: variant === 'rich' ? '100%' : undefined,
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        className={variant === 'rich' ? undefined : 'serif'}
        style={triggerStyle}
      >
        {variant === 'rich' ? richTrigger : compactTrigger}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`deck-opt-${highlight}`}
          onKeyDown={onListKeyDown}
          className="animate-slide-down"
          style={{
            position: 'absolute',
            zIndex: 30,
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--card)',
            border: '1px solid var(--rule-2)',
            borderRadius: 12,
            boxShadow: '0 12px 32px -12px rgba(31, 27, 22, 0.22), 0 4px 10px -4px rgba(31, 27, 22, 0.10)',
            overflow: 'hidden',
            outline: 'none',
          }}
        >
          <div
            ref={listRef}
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              padding: 4,
            }}
          >
            {options.map((opt, idx) => {
              const isActive = opt.id === activeDeckId;
              const isHighlighted = idx === highlight;
              const isAll = opt.id === '';
              const showCount = cardCountByDeck != null && !isAll;
              return (
                <div
                  key={opt.id || '__all__'}
                  id={`deck-opt-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setHighlight(idx)}
                  onClick={() => commit(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 10px 9px 8px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isHighlighted ? 'var(--paper-2)' : 'transparent',
                    color: 'var(--ink)',
                    borderBottom: isAll ? '1px solid var(--rule)' : 'none',
                    marginBottom: isAll ? 4 : 0,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 14,
                      flexShrink: 0,
                      color: 'var(--clay)',
                      fontSize: 13,
                      lineHeight: 1,
                      textAlign: 'center',
                    }}
                  >
                    {isActive ? '✓' : ''}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span
                      className="serif"
                      style={{
                        fontSize: 14,
                        fontWeight: isActive ? 600 : 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontStyle: isAll ? 'italic' : 'normal',
                        color: isAll ? 'var(--ink-2)' : 'var(--ink)',
                      }}
                    >
                      {opt.name}
                    </span>
                    {showCount && (
                      <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                        {opt.count ?? 0} {opt.count === 1 ? 'card' : 'cards'}
                      </span>
                    )}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: opt.due > 0 ? 'var(--clay-deep)' : 'var(--ink-4)',
                      flexShrink: 0,
                    }}
                  >
                    {opt.due} due
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform .15s',
        color: 'var(--ink-4)',
        fontSize: 10,
      }}
    >
      ▾
    </span>
  );
}
