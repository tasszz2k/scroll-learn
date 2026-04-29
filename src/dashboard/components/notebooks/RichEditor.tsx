import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Extension } from '@tiptap/core';
import type { Range } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Suggestion from '@tiptap/suggestion';
import { Markdown } from 'tiptap-markdown';
import { getAttachmentURL, putAttachment } from '../../../common/notebookStore';
import {
  NOTEBOOK_SLASH_ITEMS,
  type NotebookSlashItem,
} from './notebookSlashItems';

export interface RichEditorHandle {
  toggleBold(): void;
  toggleItalic(): void;
  toggleInlineCode(): void;
  toggleHeading(level: 1 | 2 | 3): void;
  toggleBulletList(): void;
  toggleOrderedList(): void;
  toggleTaskList(): void;
  toggleBlockquote(): void;
  insertCodeBlock(): void;
  insertTable(): void;
  insertHorizontalRule(): void;
  insertImage(url: string, alt?: string): void;
  setLink(url: string): void;
  insertMarkdown(text: string): void;
  focus(): void;
  isActive(name: string, attrs?: Record<string, unknown>): boolean;
}

// List of (name, attrs) lookup pairs we report active state for. Keep
// in sync with NotebookEditor's TOOLBAR_BUTTONS so every highlightable
// toolbar entry has a corresponding key.
const ACTIVE_PROBES: { key: string; name: string; attrs?: Record<string, unknown> }[] = [
  { key: 'bold', name: 'bold' },
  { key: 'italic', name: 'italic' },
  { key: 'code', name: 'code' },
  { key: 'heading:1', name: 'heading', attrs: { level: 1 } },
  { key: 'heading:2', name: 'heading', attrs: { level: 2 } },
  { key: 'heading:3', name: 'heading', attrs: { level: 3 } },
  { key: 'bulletList', name: 'bulletList' },
  { key: 'orderedList', name: 'orderedList' },
  { key: 'taskList', name: 'taskList' },
  { key: 'blockquote', name: 'blockquote' },
  { key: 'codeBlock', name: 'codeBlock' },
];

export type RichEditorActiveMap = Record<string, boolean>;

// Lookup helper exported so NotebookEditor's toolbar can build the same
// keys without duplicating the convention. Lives next to its only
// caller, so the eslint-disable is preferred over a one-export module.
// eslint-disable-next-line react-refresh/only-export-components
export function activeKey(name: string, attrs?: Record<string, unknown>): string {
  if (name === 'heading' && attrs && typeof attrs.level === 'number') {
    return `heading:${attrs.level}`;
  }
  return name;
}

interface RichEditorProps {
  notebookId: string;
  body: string;
  onBodyChange: (md: string) => void;
  onForceSave: () => void;
  // Pushed on every selection / transaction with a snapshot of active
  // marks/nodes the toolbar cares about. Lets the parent render
  // highlight state from React state rather than peeking at the ref.
  onActiveChange?: (active: RichEditorActiveMap) => void;
}

// `attachment://<id>` is a private scheme our markdown uses to reference
// IndexedDB blobs. The browser cannot fetch it directly, so the node view
// resolves the id to a fresh `blob:` URL after the node mounts. We keep
// the original `attachment://` value on the node attribute so the
// markdown serialiser round-trips losslessly.
const AttachmentImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img');
      dom.style.maxWidth = '100%';
      dom.style.height = 'auto';
      dom.style.borderRadius = '4px';

      const applySrc = (src: string | null, alt: string | null) => {
        dom.alt = alt || '';
        if (!src) return;
        if (src.startsWith('attachment://')) {
          const id = src.slice('attachment://'.length);
          dom.alt = alt || 'attachment';
          void getAttachmentURL(id).then(url => {
            if (url) {
              dom.src = url;
            } else {
              dom.alt = `(missing attachment ${id})`;
            }
          });
        } else {
          dom.src = src;
        }
      };

      applySrc(node.attrs.src as string | null, node.attrs.alt as string | null);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false;
          applySrc(
            updatedNode.attrs.src as string | null,
            updatedNode.attrs.alt as string | null,
          );
          return true;
        },
      };
    };
  },
});

interface SlashPopupState {
  visible: boolean;
  query: string;
  rect: DOMRect | null;
  activeIndex: number;
  range: Range | null;
}

// Right-click menu shown when the user right-clicks inside a table
// cell. Items are dispatched by id so the parent can keep the menu
// declarative; separators are interleaved between logical groups.
type TableMenuActionId =
  | 'addRowBefore'
  | 'addRowAfter'
  | 'deleteRow'
  | 'addColumnBefore'
  | 'addColumnAfter'
  | 'deleteColumn'
  | 'deleteTable';

type TableMenuEntry =
  | { kind: 'item'; id: TableMenuActionId; label: string }
  | { kind: 'sep' };

const TABLE_MENU_ENTRIES: TableMenuEntry[] = [
  { kind: 'item', id: 'addRowBefore', label: 'Insert row above' },
  { kind: 'item', id: 'addRowAfter', label: 'Insert row below' },
  { kind: 'item', id: 'deleteRow', label: 'Delete row' },
  { kind: 'sep' },
  { kind: 'item', id: 'addColumnBefore', label: 'Insert column to the left' },
  { kind: 'item', id: 'addColumnAfter', label: 'Insert column to the right' },
  { kind: 'item', id: 'deleteColumn', label: 'Delete column' },
  { kind: 'sep' },
  { kind: 'item', id: 'deleteTable', label: 'Delete table' },
];

const TABLE_MENU_CLASS = 'notebook-table-context-menu';
const TABLE_MENU_WIDTH = 220;

interface SlashCommandsOptions {
  onState: (state: SlashPopupState) => void;
}

const SLASH_PLUGIN_HOST = '__notebookSlashApply';

interface SlashHostWindow {
  [SLASH_PLUGIN_HOST]?: { applyAtIndex(idx: number): void };
}

const filterSlashItems = (query: string): NotebookSlashItem[] => {
  const q = query.toLowerCase().trim();
  return q
    ? NOTEBOOK_SLASH_ITEMS.filter(it => it.label.toLowerCase().includes(q))
    : NOTEBOOK_SLASH_ITEMS;
};

const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'notebookSlashCommands',
  addOptions() {
    return {
      onState: () => {},
    };
  },
  addProseMirrorPlugins() {
    const { onState } = this.options;
    let activeIndex = 0;
    let currentItems: NotebookSlashItem[] = [];
    let currentRange: Range | null = null;
    let currentRect: DOMRect | null = null;
    let currentQuery = '';

    const apply = (idx: number) => {
      const editor = this.editor;
      const item = currentItems[idx];
      const range = currentRange;
      if (!item || !range) return;
      editor.chain().focus().deleteRange(range).run();
      item.command(editor);
      onState({ visible: false, query: '', rect: null, activeIndex: 0, range: null });
    };

    const host = window as unknown as SlashHostWindow;
    host[SLASH_PLUGIN_HOST] = { applyAtIndex: apply };

    return [
      Suggestion<NotebookSlashItem, NotebookSlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: true,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
        render: () => ({
          onStart: (props) => {
            activeIndex = 0;
            currentItems = props.items;
            currentRange = props.range;
            currentRect = props.clientRect?.() ?? null;
            currentQuery = props.query;
            host[SLASH_PLUGIN_HOST] = { applyAtIndex: apply };
            onState({
              visible: true,
              query: currentQuery,
              rect: currentRect,
              activeIndex,
              range: currentRange,
            });
          },
          onUpdate: (props) => {
            currentItems = props.items;
            currentRange = props.range;
            currentRect = props.clientRect?.() ?? null;
            currentQuery = props.query;
            if (activeIndex >= currentItems.length) {
              activeIndex = Math.max(0, currentItems.length - 1);
            }
            onState({
              visible: true,
              query: currentQuery,
              rect: currentRect,
              activeIndex,
              range: currentRange,
            });
          },
          onKeyDown: (props) => {
            if (props.event.key === 'ArrowDown') {
              activeIndex = Math.min(
                activeIndex + 1,
                Math.max(0, currentItems.length - 1),
              );
              onState({
                visible: true,
                query: currentQuery,
                rect: currentRect,
                activeIndex,
                range: currentRange,
              });
              return true;
            }
            if (props.event.key === 'ArrowUp') {
              activeIndex = Math.max(activeIndex - 1, 0);
              onState({
                visible: true,
                query: currentQuery,
                rect: currentRect,
                activeIndex,
                range: currentRange,
              });
              return true;
            }
            if (props.event.key === 'Enter') {
              apply(activeIndex);
              return true;
            }
            if (props.event.key === 'Escape') {
              onState({ visible: false, query: '', rect: null, activeIndex: 0, range: null });
              return true;
            }
            return false;
          },
          onExit: () => {
            activeIndex = 0;
            currentItems = [];
            currentRange = null;
            currentRect = null;
            currentQuery = '';
            onState({ visible: false, query: '', rect: null, activeIndex: 0, range: null });
          },
        }),
      }),
    ];
  },
});

interface TableContextMenuProps {
  x: number;
  y: number;
  onPick: (id: TableMenuActionId) => void;
}

function TableContextMenu({ x, y, onPick }: TableContextMenuProps) {
  // Rough height estimate: ~28px per item, ~9px per separator, +8px
  // padding. Used only to clamp the menu inside the viewport so the
  // last few items stay clickable when the user right-clicks near
  // the bottom of the page.
  const itemCount = TABLE_MENU_ENTRIES.filter((e) => e.kind === 'item').length;
  const sepCount = TABLE_MENU_ENTRIES.filter((e) => e.kind === 'sep').length;
  const estHeight = itemCount * 28 + sepCount * 9 + 8;
  const left = Math.min(x, Math.max(8, window.innerWidth - TABLE_MENU_WIDTH - 8));
  const top = Math.min(y, Math.max(8, window.innerHeight - estHeight - 8));
  return createPortal(
    <div
      className={TABLE_MENU_CLASS}
      role="menu"
      aria-label="Table actions"
      style={{
        position: 'fixed',
        left,
        top,
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        zIndex: 70,
        minWidth: TABLE_MENU_WIDTH,
        padding: 4,
      }}
    >
      {TABLE_MENU_ENTRIES.map((entry, idx) => {
        if (entry.kind === 'sep') {
          return (
            <div
              key={`sep-${idx}`}
              role="separator"
              style={{
                height: 1,
                background: 'var(--rule)',
                margin: '4px 6px',
              }}
            />
          );
        }
        const isDelete = entry.id.startsWith('delete');
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(entry.id);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 10px',
              background: 'transparent',
              border: 'none',
              color: isDelete ? 'var(--clay, #c96442)' : 'var(--ink)',
              fontSize: 12,
              cursor: 'pointer',
              borderRadius: 4,
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                'rgba(201, 100, 66, 0.08)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

interface SlashPopupProps {
  state: SlashPopupState;
  onHover: (index: number) => void;
}

function SlashPopup({ state, onHover }: SlashPopupProps) {
  if (!state.visible || !state.rect) return null;
  const items = filterSlashItems(state.query);
  if (items.length === 0) return null;
  const left = state.rect.left;
  const top = state.rect.bottom + 4;
  return createPortal(
    <div
      className="notebook-slash-popup"
      style={{
        position: 'fixed',
        left,
        top,
        background: 'var(--paper)',
        border: '1px solid var(--rule)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
        zIndex: 60,
        minWidth: 240,
        maxHeight: 280,
        overflowY: 'auto',
        padding: 4,
      }}
    >
      <div
        className="mono"
        style={{ padding: '4px 8px', fontSize: 10, color: 'var(--ink-4)' }}
      >
        Insert
      </div>
      {items.map((item, idx) => (
        <button
          key={item.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            const host = (window as unknown as SlashHostWindow)[SLASH_PLUGIN_HOST];
            host?.applyAtIndex(idx);
          }}
          onMouseEnter={() => onHover(idx)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            padding: '6px 10px',
            background:
              idx === state.activeIndex ? 'rgba(201, 100, 66, 0.08)' : 'transparent',
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
            <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>{item.hint}</span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}

const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { notebookId, body, onBodyChange, onForceSave, onActiveChange },
  ref,
) {
  // Latest props read through refs so the editor's onTransaction and
  // onSelectionUpdate closures don't capture stale callbacks across
  // renders without recreating the editor.
  const onActiveChangeRef = useRef(onActiveChange);
  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  }, [onActiveChange]);
  const lastEmittedMd = useRef<string>(body);
  const [slashState, setSlashState] = useState<SlashPopupState>({
    visible: false,
    query: '',
    rect: null,
    activeIndex: 0,
    range: null,
  });
  // Right-click context menu position. `null` = closed. Coordinates are
  // viewport-relative because the menu uses `position: fixed`.
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);

  const forceSaveRef = useRef(onForceSave);
  useEffect(() => {
    forceSaveRef.current = onForceSave;
  }, [onForceSave]);

  const SaveShortcut = useMemo(
    () =>
      Extension.create({
        name: 'notebookSaveShortcut',
        addKeyboardShortcuts() {
          return {
            'Mod-s': () => {
              forceSaveRef.current();
              return true;
            },
          };
        },
      }),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
      AttachmentImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder: 'Start writing. Press / for the quick menu.',
        emptyEditorClass: 'is-editor-empty',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        breaks: true,
        linkify: true,
        tightLists: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SaveShortcut,
      SlashCommands.configure({
        onState: (s) => setSlashState(s),
      }),
    ],
    content: body,
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'notebook-rich-editor-content',
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void handleFileInsert(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const dt = (event as DragEvent).dataTransfer;
        if (!dt || dt.files.length === 0) return false;
        const files = Array.from(dt.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        void Promise.all(files.map(handleFileInsert));
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const storage = editor.storage as unknown as Record<string, unknown>;
      const md =
        (storage.markdown as { getMarkdown?: () => string } | undefined)
          ?.getMarkdown?.() ?? '';
      lastEmittedMd.current = md;
      onBodyChange(md);
      emitActive(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      emitActive(editor);
    },
  }, [SaveShortcut]);

  // Compute the snapshot of active marks/nodes the toolbar highlights
  // and push it to the parent. Defined as a stable closure so we don't
  // recreate the editor when onActiveChange identity changes.
  function emitActive(ed: { isActive: (name: string, attrs?: Record<string, unknown>) => boolean }) {
    const handler = onActiveChangeRef.current;
    if (!handler) return;
    const map: RichEditorActiveMap = {};
    for (const probe of ACTIVE_PROBES) {
      map[probe.key] = ed.isActive(probe.name, probe.attrs);
    }
    handler(map);
  }

  const handleFileInsert = useCallback(
    async (file: File) => {
      if (!editor) return;
      try {
        const att = await putAttachment({
          notebookId,
          filename: file.name || 'image',
          mime: file.type,
          blob: file,
        });
        editor
          .chain()
          .focus()
          .setImage({ src: `attachment://${att.id}`, alt: att.filename })
          .run();
      } catch {
        /* IndexedDB unavailable; user can retry */
      }
    },
    [editor, notebookId],
  );

  useEffect(() => {
    if (!editor) return;
    if (body === lastEmittedMd.current) return;
    lastEmittedMd.current = body;
    editor.commands.setContent(body, { emitUpdate: false });
  }, [body, editor]);

  useImperativeHandle(
    ref,
    () => ({
      toggleBold: () => editor?.chain().focus().toggleBold().run(),
      toggleItalic: () => editor?.chain().focus().toggleItalic().run(),
      toggleInlineCode: () => editor?.chain().focus().toggleCode().run(),
      toggleHeading: (level) =>
        editor?.chain().focus().toggleHeading({ level }).run(),
      toggleBulletList: () => editor?.chain().focus().toggleBulletList().run(),
      toggleOrderedList: () => editor?.chain().focus().toggleOrderedList().run(),
      toggleTaskList: () => editor?.chain().focus().toggleTaskList().run(),
      toggleBlockquote: () => editor?.chain().focus().toggleBlockquote().run(),
      insertCodeBlock: () => editor?.chain().focus().toggleCodeBlock().run(),
      insertTable: () =>
        editor
          ?.chain()
          .focus()
          .insertTable({ rows: 2, cols: 3, withHeaderRow: true })
          .run(),
      insertHorizontalRule: () =>
        editor?.chain().focus().setHorizontalRule().run(),
      insertImage: (url, alt) =>
        editor?.chain().focus().setImage({ src: url, alt: alt || '' }).run(),
      setLink: (url) => {
        if (!editor) return;
        const trimmed = url.trim();
        if (!trimmed) {
          editor.chain().focus().unsetLink().run();
          return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
      },
      insertMarkdown: (text) => {
        if (!editor) return;
        const pos = editor.state.selection.from;
        editor.chain().focus().insertContentAt(pos, text).run();
      },
      focus: () => editor?.commands.focus(),
      isActive: (name, attrs) => editor?.isActive(name, attrs) ?? false,
    }),
    [editor],
  );

  function hoverSlashItem(idx: number) {
    setSlashState(s => ({ ...s, activeIndex: idx }));
  }

  // Right-click on a table cell -> place caret at click position so the
  // command operates on the right cell, then open our menu. Right-clicks
  // outside any table fall through so the browser's default menu still
  // works on plain prose.
  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editor) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest('td, th')) return;
      event.preventDefault();
      const result = editor.view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
      });
      if (result) {
        editor.chain().focus().setTextSelection(result.pos).run();
      } else {
        editor.commands.focus();
      }
      setTableMenu({ x: event.clientX, y: event.clientY });
    },
    [editor],
  );

  const runTableAction = useCallback(
    (id: TableMenuActionId) => {
      setTableMenu(null);
      if (!editor) return;
      const chain = editor.chain().focus();
      switch (id) {
        case 'addRowBefore': chain.addRowBefore().run(); break;
        case 'addRowAfter': chain.addRowAfter().run(); break;
        case 'deleteRow': chain.deleteRow().run(); break;
        case 'addColumnBefore': chain.addColumnBefore().run(); break;
        case 'addColumnAfter': chain.addColumnAfter().run(); break;
        case 'deleteColumn': chain.deleteColumn().run(); break;
        case 'deleteTable': chain.deleteTable().run(); break;
      }
    },
    [editor],
  );

  // Dismiss the table menu on outside click, Escape, or scroll. The
  // mousedown listener is attached on a microtask boundary so the
  // event that opened the menu does not immediately close it.
  useEffect(() => {
    if (!tableMenu) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest(`.${TABLE_MENU_CLASS}`)) return;
      setTableMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTableMenu(null);
    };
    const onScroll = () => setTableMenu(null);
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocMouseDown);
      document.addEventListener('keydown', onKey);
      window.addEventListener('scroll', onScroll, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [tableMenu]);

  return (
    <div
      className="notebook-rich-editor"
      onContextMenu={handleContextMenu}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
      }}
    >
      <EditorContent editor={editor} className="notebook-rich-editor-host" />
      <SlashPopup state={slashState} onHover={hoverSlashItem} />
      {tableMenu && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          onPick={runTableAction}
        />
      )}
    </div>
  );
});

export default RichEditor;
