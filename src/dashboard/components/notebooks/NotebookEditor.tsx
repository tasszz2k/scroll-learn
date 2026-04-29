import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Notebook } from '../../../common/types';
import type { AutosaveStatus } from '../../hooks/useNotebookAutosave';
import { putAttachment } from '../../../common/notebookStore';
import NotebookPreview from './NotebookPreview';
import PropertiesPanel from './PropertiesPanel';
import RichEditor, {
  activeKey,
  type RichEditorActiveMap,
  type RichEditorHandle,
} from './RichEditor';
import SlashMenu, { type SlashMenuItem } from './SlashMenu';
import {
  applySlashCommand,
  cmdBold,
  cmdBulletList,
  cmdChecklist,
  cmdCodeBlock,
  cmdHeading,
  cmdHorizontalRule,
  cmdImage,
  cmdIndent,
  cmdInlineCode,
  cmdItalic,
  cmdLink,
  cmdNumberedList,
  cmdOutdent,
  cmdQuote,
  cmdTable,
  type EditorCommand,
  type EditorState,
} from './editorCommands';
import { NOTEBOOK_SLASH_ITEMS } from './notebookSlashItems';

// View modes:
//   - 'format'   -> WYSIWYG TipTap editor (default; friendly for non-tech users)
//   - 'read'     -> read-only rendered preview
//   - 'markdown' -> raw <textarea> with markdown source (power users)
export type ViewMode = 'format' | 'read' | 'markdown';

const VIEW_MODES: ViewMode[] = ['format', 'read', 'markdown'];

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  format: 'Format',
  read: 'Read',
  markdown: 'Markdown',
};

const VIEW_MODE_TOOLTIPS: Record<ViewMode, string> = {
  format: 'Edit your notebook the way it will look. Best for everyday writing.',
  read: 'Read-only rendered view.',
  markdown: 'Edit the raw markdown source. For power users.',
};

// Translate the legacy view mode strings used by older state stores to
// the new union. Kept tiny so storage migration is a single function call
// from the panel layer. Colocated with the component because moving it
// to its own module would fragment 8 lines across two files.
// eslint-disable-next-line react-refresh/only-export-components
export function normalizeViewMode(value: unknown): ViewMode {
  if (value === 'format' || value === 'live' || value === 'edit') return 'format';
  if (value === 'read' || value === 'preview') return 'read';
  if (value === 'markdown') return 'markdown';
  return 'format';
}

const FORMAT_HINT_DISMISSED_KEY = 'scrolllearn_notebook_seen_format_hint';

export interface NotebookEditorHandle {
  // Insert text at the current cursor position. Used by the AI panel's
  // "Insert at cursor" affordance. The text is treated as markdown so it
  // renders correctly whether the user is in Format or Markdown mode.
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

interface NotebookEditorProps {
  notebook: Notebook;
  body: string;
  onBodyChange: (next: string) => void;
  onMetaChange: (
    changes: Partial<Pick<Notebook, 'title' | 'tags' | 'properties' | 'folderPath'>>,
  ) => void;
  onForceSave: () => void;
  onDelete: () => void;
  status: AutosaveStatus;
  savedAt: number | null;
  viewMode: ViewMode;
  onViewModeChange: (next: ViewMode) => void;
  rightPanel?: React.ReactNode;
  extraToolbar?: React.ReactNode;
}

function formatSavedAt(savedAt: number | null): string {
  if (!savedAt) return '';
  const d = new Date(savedAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Slash items adapted to the textarea SlashMenu component (which doesn't
// know about TipTap commands).
const SLASH_ITEMS: SlashMenuItem[] = NOTEBOOK_SLASH_ITEMS.map((item) => ({
  id: item.id,
  label: item.label,
  hint: item.hint,
  insert: item.insert,
}));

interface ToolbarButton {
  id: string;
  // Compact label rendered inside the button. Kept to 1-3 chars so the
  // toolbar fits a single row even in the narrow extension sidebar.
  // The verbose name lives in `title` for the tooltip/aria.
  label: string;
  title: string;
  // Optional inline style applied to the label span. We use this to
  // render "B" bold, "I" italic, and code-related buttons in monospace
  // so a non-tech user can recognise them by shape, not by reading.
  labelStyle?: React.CSSProperties;
  // Mark/node name to query for active highlighting in format mode.
  // When omitted, the button is never highlighted (e.g. image insert).
  activeName?: string;
  // Optional attrs passed alongside activeName (e.g. heading level).
  activeAttrs?: Record<string, unknown>;
}

// Compact icon-style labels. We deliberately avoid emoji and em dashes
// (per workspace rules); the unicode bullet, ASCII quote, and brackets
// are plain glyphs every system font ships.
const TOOLBAR_BUTTONS: ToolbarButton[] = [
  { id: 'bold', label: 'B', title: 'Bold (Cmd/Ctrl+B)', activeName: 'bold', labelStyle: { fontWeight: 700 } },
  { id: 'italic', label: 'I', title: 'Italic (Cmd/Ctrl+I)', activeName: 'italic', labelStyle: { fontStyle: 'italic' } },
  { id: 'code', label: '<>', title: 'Inline code (Cmd/Ctrl+Shift+K)', activeName: 'code', labelStyle: { fontFamily: "'JetBrains Mono', ui-monospace, monospace" } },
  { id: 'h1', label: 'H1', title: 'Heading 1', activeName: 'heading', activeAttrs: { level: 1 } },
  { id: 'h2', label: 'H2', title: 'Heading 2', activeName: 'heading', activeAttrs: { level: 2 } },
  { id: 'h3', label: 'H3', title: 'Heading 3', activeName: 'heading', activeAttrs: { level: 3 } },
  { id: 'ul', label: '\u2022', title: 'Bullet list (Cmd/Ctrl+Shift+L)', activeName: 'bulletList' },
  { id: 'ol', label: '1.', title: 'Numbered list (Cmd/Ctrl+Shift+O)', activeName: 'orderedList' },
  { id: 'todo', label: '[ ]', title: 'Checklist (Cmd/Ctrl+Shift+9)', activeName: 'taskList' },
  { id: 'quote', label: '"', title: 'Quote', activeName: 'blockquote' },
  { id: 'table', label: 'Tbl', title: 'Table (Cmd/Ctrl+Shift+T)' },
  { id: 'codeBlock', label: '{}', title: 'Code block', activeName: 'codeBlock', labelStyle: { fontFamily: "'JetBrains Mono', ui-monospace, monospace" } },
  { id: 'hr', label: '---', title: 'Horizontal rule', labelStyle: { letterSpacing: '-1px' } },
  { id: 'image', label: 'Img', title: 'Insert image' },
  { id: 'link', label: 'Link', title: 'Link (Cmd/Ctrl+K)' },
];

function NotebookEditorImpl(
  {
    notebook,
    body,
    onBodyChange,
    onMetaChange,
    onForceSave,
    onDelete,
    status,
    savedAt,
    viewMode,
    onViewModeChange,
    rightPanel,
    extraToolbar,
  }: NotebookEditorProps,
  forwardedRef: React.ForwardedRef<NotebookEditorHandle>,
) {
  const [titleDraft, setTitleDraft] = useState(notebook.title);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const richRef = useRef<RichEditorHandle | null>(null);
  // Reset internal state (title draft, slash menu) whenever the parent
  // hands us a different notebook. Tracking the previous id in state
  // (rather than an effect that mirrors props -> state) is the React
  // 19 endorsed pattern for "adjust state on prop change" and dodges
  // the react-hooks/set-state-in-effect lint.
  const [prevNotebookId, setPrevNotebookId] = useState(notebook.id);

  // Snapshot of active marks/nodes pushed by the rich editor on each
  // selection change. The toolbar reads from this map so it never has
  // to peek at the rich editor's ref during render.
  const [richActive, setRichActive] = useState<RichEditorActiveMap>({});

  // Whether the first-time tip banner has been dismissed. We keep the
  // flag in localStorage so it persists across sessions; the in-memory
  // copy avoids re-reading on every render.
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FORMAT_HINT_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  function dismissHint() {
    setHintDismissed(true);
    try {
      localStorage.setItem(FORMAT_HINT_DISMISSED_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  useImperativeHandle(
    forwardedRef,
    () => ({
      insertAtCursor: (text: string) => {
        if (viewMode === 'format' && richRef.current) {
          richRef.current.insertMarkdown(text);
          return;
        }
        const ta = textareaRef.current;
        if (!ta) return;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = body.slice(0, start) + text + body.slice(end);
        onBodyChange(next);
        requestAnimationFrame(() => {
          if (!textareaRef.current) return;
          const cursor = start + text.length;
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(cursor, cursor);
        });
      },
      focus: () => {
        if (viewMode === 'format') {
          richRef.current?.focus();
        } else {
          textareaRef.current?.focus();
        }
      },
    }),
    [viewMode, body, onBodyChange],
  );

  // Slash-menu state for the markdown <textarea>. The rich editor owns
  // its own slash menu via TipTap's suggestion plugin.
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashAnchor, setSlashAnchor] = useState<{ left: number; top: number } | null>(null);
  const slashTriggerRef = useRef<{ start: number; end: number } | null>(null);

  const closeSlashMenu = useCallback(() => {
    setSlashOpen(false);
    setSlashFilter('');
    setSlashAnchor(null);
    slashTriggerRef.current = null;
  }, []);

  if (prevNotebookId !== notebook.id) {
    setPrevNotebookId(notebook.id);
    setTitleDraft(notebook.title);
    setSlashOpen(false);
    setSlashFilter('');
    setSlashAnchor(null);
  }

  useEffect(() => {
    slashTriggerRef.current = null;
  }, [notebook.id]);

  function commitTitle() {
    const next = titleDraft.trim();
    if (next && next !== notebook.title) {
      onMetaChange({ title: next });
    } else if (!next) {
      setTitleDraft(notebook.title);
    }
  }

  // Apply a markdown transformation to the textarea selection.
  const apply = useCallback(
    (cmd: EditorCommand) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const state: EditorState = {
        value: ta.value,
        selectionStart: ta.selectionStart,
        selectionEnd: ta.selectionEnd,
      };
      const next = cmd(state);
      onBodyChange(next.value);
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(next.selectionStart, next.selectionEnd);
      });
    },
    [onBodyChange],
  );

  const applyLink = useCallback(() => {
    const url = window.prompt('Link URL', 'https://');
    if (url === null) return;
    if (viewMode === 'format' && richRef.current) {
      richRef.current.setLink(url);
      return;
    }
    apply(cmdLink(url));
  }, [apply, viewMode]);

  // Toolbar dispatcher. Routes by viewMode to either the rich editor's
  // imperative handle or the textarea's apply() helper. Defined inside
  // useMemo so the dependency array signals to react-hooks/refs that we
  // are intentionally reading the latest handle at click time.
  const dispatchToolbar = useCallback(
    (id: string) => {
      if (viewMode === 'format') {
        const r = richRef.current;
        if (!r) return;
        switch (id) {
          case 'bold': r.toggleBold(); return;
          case 'italic': r.toggleItalic(); return;
          case 'code': r.toggleInlineCode(); return;
          case 'h1': r.toggleHeading(1); return;
          case 'h2': r.toggleHeading(2); return;
          case 'h3': r.toggleHeading(3); return;
          case 'ul': r.toggleBulletList(); return;
          case 'ol': r.toggleOrderedList(); return;
          case 'todo': r.toggleTaskList(); return;
          case 'quote': r.toggleBlockquote(); return;
          case 'table': r.insertTable(); return;
          case 'codeBlock': r.insertCodeBlock(); return;
          case 'hr': r.insertHorizontalRule(); return;
          case 'image': {
            const url = window.prompt('Image URL', 'https://');
            if (url) r.insertImage(url);
            return;
          }
          case 'link': applyLink(); return;
        }
        return;
      }
      // Markdown mode: route to textarea-based commands.
      switch (id) {
        case 'bold': apply(cmdBold); return;
        case 'italic': apply(cmdItalic); return;
        case 'code': apply(cmdInlineCode); return;
        case 'h1': apply(cmdHeading(1)); return;
        case 'h2': apply(cmdHeading(2)); return;
        case 'h3': apply(cmdHeading(3)); return;
        case 'ul': apply(cmdBulletList); return;
        case 'ol': apply(cmdNumberedList); return;
        case 'todo': apply(cmdChecklist); return;
        case 'quote': apply(cmdQuote); return;
        case 'table': apply(cmdTable); return;
        case 'codeBlock': apply(cmdCodeBlock); return;
        case 'hr': apply(cmdHorizontalRule); return;
        case 'image': apply(cmdImage); return;
        case 'link': applyLink(); return;
      }
    },
    [apply, applyLink, viewMode],
  );

  // Render a stable list of toolbar buttons. Active state lookup happens
  // via the imperative handle inside the click; we only re-render when
  // dispatchToolbar's deps change so the buttons themselves stay
  // memoised.
  const toolbarButtons = useMemo(() => TOOLBAR_BUTTONS, []);

  // ----- Image paste / drop -> attachment:// (markdown mode only; the
  // rich editor handles its own paste/drop via TipTap's editorProps).

  async function handleFileInsert(file: File) {
    if (!file.type.startsWith('image/')) return;
    const att = await putAttachment({
      notebookId: notebook.id,
      filename: file.name || 'image',
      mime: file.type,
      blob: file,
    });
    const md = `![${att.filename}](attachment://${att.id})`;
    apply((s) => ({
      value: s.value.slice(0, s.selectionStart) + md + s.value.slice(s.selectionEnd),
      selectionStart: s.selectionStart + md.length,
      selectionEnd: s.selectionStart + md.length,
    }));
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await handleFileInsert(file);
          return;
        }
      }
    }
  }

  async function handleDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    for (const file of Array.from(e.dataTransfer.files)) {
      if (file.type.startsWith('image/')) {
        await handleFileInsert(file);
      }
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  }

  // ----- Markdown-tab keyboard shortcuts -----

  function handleBodyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const meta = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();

    if (meta && k === 's') {
      e.preventDefault();
      onForceSave();
      return;
    }

    if (meta && !e.shiftKey && k === 'b') { e.preventDefault(); apply(cmdBold); return; }
    if (meta && !e.shiftKey && k === 'i') { e.preventDefault(); apply(cmdItalic); return; }
    if (meta && !e.shiftKey && k === 'k') { e.preventDefault(); applyLink(); return; }
    if (meta && e.shiftKey && k === 'k') { e.preventDefault(); apply(cmdInlineCode); return; }

    if (meta && e.shiftKey && k === 'l') { e.preventDefault(); apply(cmdBulletList); return; }
    if (meta && e.shiftKey && k === 'o') { e.preventDefault(); apply(cmdNumberedList); return; }
    if (meta && e.shiftKey && k === '9') { e.preventDefault(); apply(cmdChecklist); return; }
    if (meta && e.shiftKey && k === 't') { e.preventDefault(); apply(cmdTable); return; }

    if (meta && e.altKey && (k === '1' || k === '2' || k === '3')) {
      e.preventDefault();
      apply(cmdHeading(parseInt(k, 10) as 1 | 2 | 3));
      return;
    }

    if (k === 'tab') {
      e.preventDefault();
      apply(e.shiftKey ? cmdOutdent : cmdIndent);
      return;
    }

    if (e.key === '/') {
      const ta = e.currentTarget;
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const lineStart = before.lastIndexOf('\n') + 1;
      const linePrefix = before.slice(lineStart);
      if (linePrefix.trim() === '') {
        requestAnimationFrame(() => {
          const rect = ta.getBoundingClientRect();
          setSlashOpen(true);
          setSlashFilter('');
          setSlashAnchor({
            left: rect.left + 24,
            top: rect.top + 28,
          });
          slashTriggerRef.current = { start: pos, end: pos + 1 };
        });
      }
      return;
    }
  }

  function handleTextareaChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onBodyChange(e.target.value);
    if (slashOpen && slashTriggerRef.current) {
      const ta = e.target;
      const pos = ta.selectionStart;
      const trigger = slashTriggerRef.current;
      if (pos < trigger.end) {
        closeSlashMenu();
        return;
      }
      const filterText = ta.value.slice(trigger.end, pos);
      if (/[\s\n]/.test(filterText)) {
        closeSlashMenu();
        return;
      }
      setSlashFilter(filterText);
    }
  }

  function handleSlashPick(item: SlashMenuItem) {
    const ta = textareaRef.current;
    const trigger = slashTriggerRef.current;
    if (!ta || !trigger) return closeSlashMenu();
    const triggerStart = trigger.start;
    const triggerEnd = trigger.end + slashFilter.length;
    const next = applySlashCommand(
      { value: ta.value, selectionStart: ta.selectionStart, selectionEnd: ta.selectionEnd },
      triggerStart,
      triggerEnd,
      item.insert,
    );
    onBodyChange(next.value);
    closeSlashMenu();
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  // Active-state lookup for toolbar highlighting. Reads from the
  // pushed state snapshot (`richActive`), never the imperative handle,
  // so render-time ref access stays out of the picture.
  function isToolbarActive(btn: ToolbarButton): boolean {
    if (viewMode !== 'format') return false;
    if (!btn.activeName) return false;
    return richActive[activeKey(btn.activeName, btn.activeAttrs)] ?? false;
  }

  const showToolbar = viewMode !== 'read';

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Title row */}
        <div style={{ padding: '8px 18px 4px' }}>
          <input
            type="text"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
                if (viewMode === 'format') {
                  richRef.current?.focus();
                } else {
                  textareaRef.current?.focus();
                }
              }
            }}
            placeholder="Untitled"
            className="display"
            style={{
              width: '100%',
              fontSize: 28,
              padding: '4px 0',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--ink)',
            }}
          />
        </div>

        {/* Properties block */}
        <PropertiesPanel
          tags={notebook.tags}
          onTagsChange={(next) => onMetaChange({ tags: next })}
          properties={notebook.properties}
          onPropertiesChange={(next) => onMetaChange({ properties: next })}
          folderPath={notebook.folderPath}
        />

        {/* View-mode tabs + formatting toolbar.
            View tabs and toolbar live in their own rows so the formatting
            buttons can scroll horizontally without dragging the tab row
            with them. The toolbar uses overflowX:auto + nowrap so even
            very narrow viewports show a single, scannable row instead
            of wrapping into multiple lines. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px 4px',
            borderBottom: showToolbar ? 'none' : '1px solid var(--rule)',
          }}
        >
          <div role="tablist" aria-label="View mode" style={{ display: 'flex', gap: 4 }}>
            {VIEW_MODES.map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onViewModeChange(mode)}
                  className={active ? 'btn btn-clay' : 'btn btn-ghost'}
                  title={VIEW_MODE_TOOLTIPS[mode]}
                  style={{ padding: '2px 12px', fontSize: 11 }}
                >
                  {VIEW_MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>
          {!showToolbar && extraToolbar && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {extraToolbar}
            </div>
          )}
        </div>
        {showToolbar && (
          <div
            className="notebook-toolbar"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 12px 6px',
              borderBottom: '1px solid var(--rule)',
              overflowX: 'auto',
              whiteSpace: 'nowrap',
            }}
          >
            {toolbarButtons.map((btn) => {
              const active = isToolbarActive(btn);
              return (
                <button
                  key={btn.id}
                  type="button"
                  title={btn.title}
                  aria-label={btn.title}
                  aria-pressed={active}
                  onClick={() => dispatchToolbar(btn.id)}
                  className={active ? 'btn btn-clay' : 'btn btn-ghost'}
                  style={{
                    padding: '2px 6px',
                    fontSize: 11,
                    minWidth: 24,
                    flex: '0 0 auto',
                  }}
                >
                  <span style={btn.labelStyle}>{btn.label}</span>
                </button>
              );
            })}
            {extraToolbar && (
              <span
                style={{
                  display: 'inline-flex',
                  gap: 6,
                  marginLeft: 10,
                  paddingLeft: 10,
                  borderLeft: '1px solid var(--rule)',
                  flex: '0 0 auto',
                }}
              >
                {extraToolbar}
              </span>
            )}
          </div>
        )}

        {/* First-time tip banner for non-tech users */}
        {viewMode === 'format' && !hintDismissed && (
          <div
            role="note"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '4px 14px',
              background: 'var(--clay-wash, rgba(201, 100, 66, 0.08))',
              borderBottom: '1px solid var(--rule)',
              fontSize: 12,
              color: 'var(--ink-2)',
            }}
          >
            <span>
              Tip: type <strong>/</strong> for a quick menu of headings, lists, tables,
              and more. Click <strong>Markdown</strong> to view the raw text.
            </span>
            <button
              type="button"
              onClick={dismissHint}
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 11 }}
              aria-label="Dismiss tip"
            >
              Got it
            </button>
          </div>
        )}

        {/* Editor body / preview */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
          {viewMode === 'format' && (
            <RichEditor
              ref={richRef}
              notebookId={notebook.id}
              body={body}
              onBodyChange={onBodyChange}
              onForceSave={onForceSave}
              onActiveChange={setRichActive}
            />
          )}
          {viewMode === 'markdown' && (
            <textarea
              ref={textareaRef}
              className="notebook-markdown-textarea"
              value={body}
              onChange={handleTextareaChange}
              onKeyDown={handleBodyKeyDown}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              placeholder="Edit raw markdown. Press / for the slash menu."
              style={{
                flex: 1,
                minWidth: 0,
                border: 'none',
                outline: 'none',
                resize: 'none',
                padding: '16px 20px',
                color: 'var(--ink)',
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 14,
              }}
            />
          )}
          {viewMode === 'read' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
              <NotebookPreview body={body} />
            </div>
          )}
          {slashOpen && slashAnchor && viewMode === 'markdown' && (
            <SlashMenu
              items={SLASH_ITEMS}
              filter={slashFilter}
              anchor={slashAnchor}
              onPick={handleSlashPick}
              onDismiss={closeSlashMenu}
            />
          )}
        </div>

        <footer
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '4px 16px',
            borderTop: '1px solid var(--rule)',
            fontSize: 11,
            color: 'var(--ink-3)',
          }}
        >
          <div className="mono">
            {wordCount(body)} words . {body.length} chars
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="mono">
              {status === 'saving' && 'Saving...'}
              {status === 'saved' && savedAt && `Saved ${formatSavedAt(savedAt)}`}
              {status === 'error' && 'Save failed'}
              {status === 'idle' && '-'}
            </span>
            <span className="mono" style={{ color: 'var(--ink-4)' }}>
              0 backlinks
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </footer>
      </div>

      {rightPanel && (
        <div
          style={{
            width: 380,
            borderLeft: '1px solid var(--rule)',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {rightPanel}
        </div>
      )}
    </div>
  );
}

const NotebookEditor = forwardRef<NotebookEditorHandle, NotebookEditorProps>(
  NotebookEditorImpl,
);
export default NotebookEditor;
