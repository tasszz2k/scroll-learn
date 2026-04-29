import { useEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATES, type NotebookTemplate } from '../../../common/notebookTemplates';
import type { Notebook } from '../../../common/types';

interface TemplatePickerProps {
  // The folder the new notebook will land in by default. Empty string === root.
  // The user can override this in the dialog before picking a template.
  targetFolderPath: string;
  // Existing notebooks. Used to derive the autocomplete list of folder
  // paths so a user opening the picker from root can still drop the new
  // notebook into a deeply-nested folder without leaving the dialog.
  notebooks: Notebook[];
  onPick: (template: NotebookTemplate, folderPath: string) => void;
  onClose: () => void;
}

// Normalize user input to the canonical folder path shape used elsewhere
// in the panel: empty string for root, otherwise a leading slash with no
// trailing or duplicated slashes (`'/a/b/c'`). Whitespace inside path
// segments is trimmed but otherwise preserved so titles like
// `/My Notes` round-trip cleanly.
function normalizeFolderPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '/') return '';
  const parts = trimmed.split('/').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  return '/' + parts.join('/');
}

// Collect every folder path that is currently in use, plus every ancestor
// path (so `/a/b/c` also yields `/a` and `/a/b`). Used for the datalist
// suggestions on the folder input.
function collectFolderPaths(notebooks: Notebook[]): string[] {
  const paths = new Set<string>();
  for (const nb of notebooks) {
    const fp = nb.folderPath ?? '';
    if (!fp) continue;
    const segs = fp.split('/').filter(Boolean);
    let acc = '';
    for (const s of segs) {
      acc += '/' + s;
      paths.add(acc);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

interface FolderDropdownProps {
  // Canonical normalized value: '' for root, otherwise '/Foo/Bar'.
  value: string;
  // Existing canonical folder paths (no root entry; we render that ourselves).
  options: string[];
  onChange: (next: string) => void;
}

// Custom dropdown for picking the destination folder. Replaces the old
// free-text input + datalist combo (which rendered as a small native
// menu the user could not style) with a popover list driven by React.
//
// Keeps the "create a new path" escape hatch as an inline mode inside
// the popover so deeply-nested folders can be authored without leaving
// the dialog. Selecting an item closes the popover; clicking outside
// closes it without committing.
function FolderDropdown({ value, options, onChange }: FolderDropdownProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click-outside closes the popover. We attach during open and detach
  // on close so the rest of the dialog can still receive clicks.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Reset the create-new sub-mode whenever the popover toggles.
  function toggle() {
    setOpen(o => {
      if (o) setCreating(false);
      return !o;
    });
  }

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setCreating(false);
  }

  function commitDraft() {
    const next = normalizeFolderPath(draft);
    pick(next);
  }

  const labelFor = (path: string) => path || 'Root';
  const buttonLabel = labelFor(value);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          padding: '6px 10px',
          fontSize: 13,
          border: '1px solid var(--rule)',
          borderRadius: 4,
          background: 'var(--paper)',
          color: 'var(--ink)',
          fontFamily: 'inherit',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
      >
        <span
          className={value === '' ? '' : 'mono'}
          style={{
            fontSize: value === '' ? 13 : 12,
            color: value === '' ? 'var(--ink-3)' : 'var(--ink)',
          }}
        >
          {buttonLabel}
        </span>
        <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
          {open ? '\u25B4' : '\u25BE'}
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            zIndex: 10,
            maxHeight: 240,
            overflowY: 'auto',
            padding: 4,
          }}
        >
          <FolderOption
            label="Root"
            hint="(no folder)"
            mono={false}
            selected={value === ''}
            onSelect={() => pick('')}
          />
          {options.map(opt => (
            <FolderOption
              key={opt}
              label={opt}
              mono
              selected={value === opt}
              onSelect={() => pick(opt)}
            />
          ))}
          <div style={{ borderTop: '1px solid var(--rule)', margin: '4px 0' }} />
          {!creating ? (
            <button
              type="button"
              onClick={() => {
                setCreating(true);
                setDraft('');
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                color: 'var(--clay)',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              + New folder...
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4, padding: 4 }}>
              <input
                type="text"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder="/My folder/Subfolder"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitDraft();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setCreating(false);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '4px 6px',
                  fontSize: 12,
                  border: '1px solid var(--rule)',
                  borderRadius: 4,
                  background: 'var(--paper)',
                  color: 'var(--ink)',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                }}
              />
              <button
                type="button"
                onClick={commitDraft}
                disabled={normalizeFolderPath(draft) === ''}
                className="btn btn-clay"
                style={{ padding: '2px 10px', fontSize: 11 }}
              >
                Use
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FolderOptionProps {
  label: string;
  hint?: string;
  mono: boolean;
  selected: boolean;
  onSelect: () => void;
}

function FolderOption({ label, hint, mono, selected, onSelect }: FolderOptionProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '6px 10px',
        background: selected ? 'rgba(201, 100, 66, 0.10)' : 'transparent',
        border: 'none',
        color: 'var(--ink)',
        fontSize: 12,
        cursor: 'pointer',
        borderRadius: 4,
        textAlign: 'left',
      }}
    >
      <span className={mono ? 'mono' : ''} style={{ fontSize: mono ? 12 : 13 }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{hint}</span>
      )}
      {selected && !hint && (
        <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--clay)' }}>
          selected
        </span>
      )}
    </button>
  );
}

// Modal dialog. The footer carries Cancel; clicking the backdrop also
// closes. We intentionally do not use a portal -- the parent NotebooksPanel
// only renders one of these at a time and Tailwind/CSS variables keep the
// stacking context simple.
export default function TemplatePicker({
  targetFolderPath,
  notebooks,
  onPick,
  onClose,
}: TemplatePickerProps) {
  const [folder, setFolder] = useState<string>(normalizeFolderPath(targetFolderPath));
  // Build the dropdown list. We seed it with the canonical folder paths
  // already in use, plus the current value when it is not yet represented
  // (e.g. when the dialog opens on a brand-new folder created via the
  // "+ Folder" flow). Sorted for a stable order.
  const folderOptions = useMemo(() => {
    const set = new Set(collectFolderPaths(notebooks));
    if (folder) set.add(folder);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [notebooks, folder]);
  const normalized = folder; // already normalized via state setter
  const displayPath = normalized || '/';

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31, 27, 22, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          borderRadius: 8,
          width: 'min(560px, 92vw)',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
          padding: 22,
        }}
      >
        <div className="eyebrow" style={{ fontSize: 11 }}>New notebook</div>
        <h3 className="display" style={{ fontSize: 22, marginTop: 6, marginBottom: 4 }}>
          Pick a starter.
        </h3>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
          Lands in <span className="mono">{displayPath}</span>. You can change everything later.
        </div>
        <div style={{ marginBottom: 14, fontSize: 12, color: 'var(--ink-2)' }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>Folder</div>
          <FolderDropdown
            value={normalized}
            options={folderOptions}
            onChange={setFolder}
          />
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
            Pick an existing folder or use <span className="mono">+ New folder</span> to create one.
          </div>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {TEMPLATES.map(t => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPick(t, normalized)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'rgba(0,0,0,0.02)',
                  border: '1px solid var(--rule)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--ink)',
                }}
              >
                <div className="display" style={{ fontSize: 15, marginBottom: 2 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.description}</div>
                {t.defaultTags.length > 0 && (
                  <div className="mono" style={{ fontSize: 10, marginTop: 6, color: 'var(--ink-4)' }}>
                    {t.defaultTags.map(tag => `#${tag}`).join(' ')}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
