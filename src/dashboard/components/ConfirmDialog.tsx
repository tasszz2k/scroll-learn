import { useEffect, useRef, type ReactNode } from 'react';

export type ConfirmVariant = 'default' | 'danger';

export interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => confirmBtnRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const accent = variant === 'danger' ? 'var(--rose)' : 'var(--clay)';
  const confirmClass = variant === 'danger' ? 'btn btn-ghost' : 'btn btn-clay';
  const confirmExtra: React.CSSProperties = variant === 'danger'
    ? { background: 'var(--rose)', color: '#FFF8F2', borderColor: 'var(--rose)' }
    : {};

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'confirm-dialog-title' : undefined}
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
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--card)',
          color: 'var(--ink)',
          border: '1px solid var(--rule-2)',
          borderRadius: 14,
          boxShadow: '0 20px 50px -12px rgba(31, 27, 22, 0.35), 0 4px 12px -4px rgba(31, 27, 22, 0.2)',
          overflow: 'hidden',
          animation: 'sl-confirm-pop .18s cubic-bezier(.2,.9,.3,1.2)',
        }}
      >
        <div style={{ padding: '22px 24px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="eyebrow" style={{ color: accent, fontSize: 10 }}>
            {variant === 'danger' ? 'Confirm · destructive' : 'Confirm'}
          </div>
          {title && (
            <h2
              id="confirm-dialog-title"
              className="serif"
              style={{ fontSize: 20, lineHeight: 1.25, margin: 0, color: 'var(--ink)' }}
            >
              {title}
            </h2>
          )}
          <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>
            {message}
          </div>
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
            onClick={onCancel}
            className="btn btn-ghost"
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={confirmClass}
            style={{ padding: '8px 18px', fontSize: 13, ...confirmExtra }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes sl-confirm-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes sl-confirm-pop {
          from { opacity: 0; transform: translateY(6px) scale(.98) }
          to   { opacity: 1; transform: translateY(0)    scale(1) }
        }
      `}</style>
    </div>
  );
}
