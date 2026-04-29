import { useEffect, useRef, useState, type ReactNode } from 'react';

// Replaces native browser window.prompt() / window.confirm() with a styled
// modal that uses the app's clay/ink design tokens. Both components share
// the same backdrop + card frame as TemplatePicker so the surface feels
// consistent across the Notebooks panel.

interface DialogFrameProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer: ReactNode;
  onDismiss: () => void;
  // Tone changes the title accent color so destructive actions (delete)
  // read as red without us shipping a toast/alert system.
  tone?: 'neutral' | 'danger';
}

function DialogFrame({
  title,
  description,
  children,
  footer,
  onDismiss,
  tone = 'neutral',
}: DialogFrameProps) {
  return (
    <div
      role="presentation"
      onClick={onDismiss}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 27, 22, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 10,
          width: 'min(440px, 92vw)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
          padding: 22,
        }}
      >
        <div
          className="display"
          style={{
            fontSize: 18,
            marginBottom: description ? 4 : 14,
            color: tone === 'danger' ? 'var(--clay-deep)' : 'var(--ink)',
          }}
        >
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>
            {description}
          </div>
        )}
        {children}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

// ----- PromptDialog -----

export interface PromptDialogProps {
  title: ReactNode;
  description?: ReactNode;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Optional input validator. Returning a non-empty string surfaces the
  // message under the input and disables Submit. Returning null or
  // undefined treats the value as valid.
  validate?: (value: string) => string | null | undefined;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function PromptDialog({
  title,
  description,
  initial = '',
  placeholder,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  validate,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus + select-all on mount so the user can type or replace
  // the suggested value with one keystroke. Done in an effect because
  // the DOM node is not guaranteed mounted before render commits.
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(t);
  }, []);

  const trimmed = value.trim();
  const validationError = validate?.(trimmed) ?? null;
  const canSubmit = trimmed.length > 0 && !validationError;

  function submit() {
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  return (
    <DialogFrame
      title={title}
      description={description}
      onDismiss={onCancel}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-clay"
            onClick={submit}
            disabled={!canSubmit}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 14,
          border: '1px solid var(--rule)',
          borderRadius: 6,
          outline: 'none',
          background: 'var(--paper)',
          color: 'var(--ink)',
        }}
      />
      {validationError && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--clay-deep)' }}>
          {validationError}
        </div>
      )}
    </DialogFrame>
  );
}

// ----- ConfirmDialog -----

export interface ConfirmDialogProps {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => confirmRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, []);

  return (
    <DialogFrame
      title={title}
      description={description}
      onDismiss={onCancel}
      tone={destructive ? 'danger' : 'neutral'}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-clay"
            onClick={onConfirm}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}

// ----- useDialogs -----
//
// Imperative async API that converts dialog interactions into Promises so
// callers can `await dialog.prompt(...)` instead of carrying state around
// every callsite. Returns a `render` JSX node the caller drops anywhere
// inside its tree.

interface PromptRequest extends Omit<PromptDialogProps, 'onSubmit' | 'onCancel'> {
  kind: 'prompt';
  resolve: (value: string | null) => void;
}

interface ConfirmRequest extends Omit<ConfirmDialogProps, 'onConfirm' | 'onCancel'> {
  kind: 'confirm';
  resolve: (value: boolean) => void;
}

type DialogRequest = PromptRequest | ConfirmRequest;

type PromptOpts = Omit<PromptDialogProps, 'onSubmit' | 'onCancel'>;
type ConfirmOpts = Omit<ConfirmDialogProps, 'onConfirm' | 'onCancel'>;

export interface DialogsApi {
  prompt: (opts: PromptOpts) => Promise<string | null>;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  render: () => ReactNode;
}

export function useDialogs(): DialogsApi {
  const [pending, setPending] = useState<DialogRequest | null>(null);

  const promptFn = (opts: PromptOpts) =>
    new Promise<string | null>((resolve) => {
      setPending({ kind: 'prompt', ...opts, resolve });
    });

  const confirmFn = (opts: ConfirmOpts) =>
    new Promise<boolean>((resolve) => {
      setPending({ kind: 'confirm', ...opts, resolve });
    });

  function close(value: string | null | boolean) {
    if (!pending) return;
    if (pending.kind === 'prompt') {
      pending.resolve(value as string | null);
    } else {
      pending.resolve(value as boolean);
    }
    setPending(null);
  }

  function render(): ReactNode {
    if (!pending) return null;
    if (pending.kind === 'prompt') {
      return (
        <PromptDialog
          {...pending}
          onSubmit={(v) => close(v)}
          onCancel={() => close(null)}
        />
      );
    }
    return (
      <ConfirmDialog
        {...pending}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    );
  }

  return { prompt: promptFn, confirm: confirmFn, render };
}
