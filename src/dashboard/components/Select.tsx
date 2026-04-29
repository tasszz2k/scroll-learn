import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
  /** Width of the trigger; defaults to `auto`. Use `100%` to fill the row. */
  width?: number | string;
  /** Width of the popover. Defaults to `max(triggerWidth, 240px)`. */
  menuWidth?: number | string;
  ariaLabel?: string;
}

export default function Select<T extends string = string>({
  id,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  size = 'sm',
  className,
  style,
  width = 'auto',
  menuWidth,
  ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeIndex = useMemo(
    () => Math.max(0, options.findIndex(o => o.value === value)),
    [options, value],
  );
  const active = options[activeIndex];

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

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

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      panelRef.current?.focus();
      const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function commit(idx: number) {
    const opt = options[idx];
    if (!opt || opt.disabled) return;
    if (opt.value !== value) onChange(opt.value);
    close();
  }

  function openMenu() {
    setHighlight(activeIndex);
    setOpen(true);
  }

  function onTriggerClick() {
    if (open) setOpen(false);
    else openMenu();
  }

  function onTriggerKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      openMenu();
    }
  }

  function onListKeyDown(ev: React.KeyboardEvent) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setHighlight(h => {
        let n = h;
        for (let i = 0; i < options.length; i++) {
          n = Math.min(options.length - 1, n + 1);
          if (!options[n]?.disabled) return n;
        }
        return h;
      });
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlight(h => {
        let n = h;
        for (let i = 0; i < options.length; i++) {
          n = Math.max(0, n - 1);
          if (!options[n]?.disabled) return n;
        }
        return h;
      });
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

  const padY = size === 'md' ? 8 : 5;
  const padX = size === 'md' ? 12 : 10;
  const fontSize = size === 'md' ? 13 : 12;

  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'inline-block', width, ...style }}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: `${padY}px ${padX}px`,
          background: 'var(--card)',
          border: '1px solid ' + (open ? 'var(--clay)' : 'var(--rule-2)'),
          borderRadius: 8,
          color: 'var(--ink)',
          fontSize,
          fontWeight: 500,
          fontFamily: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
          boxShadow: open ? '0 0 0 3px var(--clay-tint)' : 'none',
          transition: 'border-color .15s, box-shadow .15s',
        }}
      >
        <span style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: active ? 'var(--ink)' : 'var(--ink-3)',
        }}>
          {active ? active.label : placeholder}
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="listbox"
          tabIndex={-1}
          aria-activedescendant={`select-opt-${highlight}`}
          onKeyDown={onListKeyDown}
          style={{
            position: 'absolute',
            zIndex: 40,
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: '100%',
            width: menuWidth,
            background: 'var(--card)',
            border: '1px solid var(--rule-2)',
            borderRadius: 12,
            boxShadow: '0 14px 36px -14px rgba(31, 27, 22, 0.28), 0 4px 12px -4px rgba(31, 27, 22, 0.12)',
            overflow: 'hidden',
            outline: 'none',
            animation: 'sl-select-pop .14s ease-out',
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
              const isActive = opt.value === value;
              const isHighlighted = idx === highlight && !opt.disabled;
              return (
                <div
                  key={opt.value}
                  id={`select-opt-${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={opt.disabled || undefined}
                  onMouseEnter={() => !opt.disabled && setHighlight(idx)}
                  onClick={() => commit(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px 8px 8px',
                    borderRadius: 8,
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    background: isHighlighted ? 'var(--paper-2)' : 'transparent',
                    color: opt.disabled ? 'var(--ink-4)' : 'var(--ink)',
                    opacity: opt.disabled ? 0.6 : 1,
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
                      style={{
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {opt.label}
                    </span>
                    {opt.hint && (
                      <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.35 }}>
                        {opt.hint}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes sl-select-pop {
          from { opacity: 0; transform: translateY(-4px) }
          to   { opacity: 1; transform: translateY(0) }
        }
      `}</style>
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
        flexShrink: 0,
      }}
    >
      ▾
    </span>
  );
}
