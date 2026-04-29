import { useMemo, useState } from 'react';
import type { Notebook } from '../../../common/types';

interface FolderTreeProps {
  notebooks: Notebook[];
  activeId: string | null;
  onSelect: (id: string) => void;
  // Folder operations. Rename/Delete are "request" callbacks: the panel
  // owns the confirm/prompt UI so the styled dialogs live in one place.
  onCreateNotebook: (folderPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRenameFolder: (path: string, currentName: string) => void;
  onDeleteFolder: (path: string, descendantCount: number) => void;
  // Notebook-level operations.
  onRenameNotebook: (id: string, currentTitle: string) => void;
  onDeleteNotebook: (id: string, currentTitle: string) => void;
  onMoveNotebook: (id: string, nextFolderPath: string) => void;
  // Optional "Restore samples" action exposed in the header overflow menu.
  // The owning panel is responsible for the confirm dialog and the actual
  // seed call; the tree only renders the entry when the prop is provided.
  onRestoreSamples?: () => void;
  // Compact mode disables expand-by-default and trims spacing for the
  // sidebar shell. Dashboard uses the wider variant.
  compact?: boolean;
  // When provided, the header renders a back affordance that calls this
  // (used by the embedded panel to dismiss the tree overlay and return
  // to the currently open notebook editor). Hidden in dashboard mode.
  onBack?: () => void;
  // Optional title shown next to the back button so the user knows
  // which notebook they will return to ("Back to test docs").
  backLabel?: string;
}

interface FolderNode {
  // '' is the implicit root.
  path: string;
  // 'My Folder' (display name; never includes a leading '/')
  name: string;
  children: FolderNode[];
  notebooks: Notebook[];
}

// Build a tree from the flat folderPath strings on each notebook. We do not
// store folders separately, so a folder only "exists" for as long as at least
// one of its descendant notebooks lives in it.
function buildTree(notebooks: Notebook[]): FolderNode {
  const root: FolderNode = { path: '', name: '', children: [], notebooks: [] };
  const folderMap = new Map<string, FolderNode>();
  folderMap.set('', root);

  function ensureFolder(path: string): FolderNode {
    if (folderMap.has(path)) return folderMap.get(path)!;
    const segments = path.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (const seg of segments) {
      acc += '/' + seg;
      let next = folderMap.get(acc);
      if (!next) {
        next = { path: acc, name: seg, children: [], notebooks: [] };
        folderMap.set(acc, next);
        cur.children.push(next);
      }
      cur = next;
    }
    return cur;
  }

  for (const nb of notebooks) {
    const folder = ensureFolder(nb.folderPath || '');
    folder.notebooks.push(nb);
  }

  // Sort folders alphabetically; notebooks by title for stability.
  function sort(node: FolderNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.notebooks.sort((a, b) => a.title.localeCompare(b.title));
    node.children.forEach(sort);
  }
  sort(root);
  return root;
}

interface FolderRowProps {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  toggleExpand: (path: string) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreateNotebook: (folderPath: string) => void;
  onCreateFolder: (parentPath: string) => void;
  onRenameFolder: (path: string, currentName: string) => void;
  onDeleteFolder: (path: string, descendantCount: number) => void;
  onRenameNotebook: (id: string, currentTitle: string) => void;
  onDeleteNotebook: (id: string, currentTitle: string) => void;
  onMoveNotebook: (id: string, nextFolderPath: string) => void;
}

function FolderRow({
  node,
  depth,
  expanded,
  toggleExpand,
  activeId,
  onSelect,
  onCreateNotebook,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameNotebook,
  onDeleteNotebook,
  onMoveNotebook,
}: FolderRowProps) {
  const isRoot = node.path === '';
  const isExpanded = isRoot || expanded.has(node.path);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData('text/scrolllearn-notebook-id');
    if (id) {
      onMoveNotebook(id, node.path);
    }
  }

  function allowDrop(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('text/scrolllearn-notebook-id')) {
      e.preventDefault();
    }
  }

  return (
    <li>
      {!isRoot && (
        <div
          className="folder-row"
          onClick={() => toggleExpand(node.path)}
          onDragOver={allowDrop}
          onDrop={handleDrop}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            paddingLeft: depth * 14,
            paddingRight: 6,
            paddingTop: 3,
            paddingBottom: 3,
            cursor: 'pointer',
            color: 'var(--ink-2)',
            fontSize: 13,
            borderRadius: 4,
          }}
        >
          <span className="mono" style={{ width: 12, fontSize: 10, color: 'var(--ink-4)' }}>
            {isExpanded ? 'v' : '>'}
          </span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
          <RowMenu
            items={[
              { label: 'New notebook', onClick: () => onCreateNotebook(node.path) },
              { label: 'New folder', onClick: () => onCreateFolder(node.path) },
              {
                label: 'Rename folder',
                onClick: () => onRenameFolder(node.path, node.name),
              },
              {
                label: 'Delete folder',
                onClick: () => onDeleteFolder(node.path, countDescendants(node)),
                danger: true,
              },
            ]}
          />
        </div>
      )}
      {isExpanded && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {node.children.map(child => (
            <FolderRow
              key={child.path}
              node={child}
              depth={isRoot ? 0 : depth + 1}
              expanded={expanded}
              toggleExpand={toggleExpand}
              activeId={activeId}
              onSelect={onSelect}
              onCreateNotebook={onCreateNotebook}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onRenameNotebook={onRenameNotebook}
              onDeleteNotebook={onDeleteNotebook}
              onMoveNotebook={onMoveNotebook}
            />
          ))}
          {node.notebooks.map(nb => (
            <NotebookRow
              key={nb.id}
              notebook={nb}
              depth={isRoot ? 0 : depth + 1}
              active={nb.id === activeId}
              onSelect={onSelect}
              onRenameNotebook={onRenameNotebook}
              onDeleteNotebook={onDeleteNotebook}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function countDescendants(node: FolderNode): number {
  return node.notebooks.length + node.children.reduce((sum, c) => sum + countDescendants(c), 0);
}

interface NotebookRowProps {
  notebook: Notebook;
  depth: number;
  active: boolean;
  onSelect: (id: string) => void;
  onRenameNotebook: (id: string, currentTitle: string) => void;
  onDeleteNotebook: (id: string, currentTitle: string) => void;
}

function NotebookRow({
  notebook,
  depth,
  active,
  onSelect,
  onRenameNotebook,
  onDeleteNotebook,
}: NotebookRowProps) {
  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData('text/scrolllearn-notebook-id', notebook.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <li
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect(notebook.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        paddingLeft: depth * 14 + 12,
        paddingRight: 6,
        paddingTop: 3,
        paddingBottom: 3,
        cursor: 'pointer',
        background: active ? 'rgba(201, 100, 66, 0.08)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        fontSize: 13,
        borderRadius: 4,
      }}
    >
      <span className="mono" style={{ width: 12, fontSize: 10, color: active ? 'var(--clay)' : 'var(--ink-4)' }}>
        ·
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {notebook.title || 'Untitled'}
      </span>
      <RowMenu
        items={[
          {
            label: 'Rename',
            onClick: () => onRenameNotebook(notebook.id, notebook.title),
          },
          {
            label: 'Delete',
            onClick: () => onDeleteNotebook(notebook.id, notebook.title || 'Untitled'),
            danger: true,
          },
        ]}
      />
    </li>
  );
}

interface RowMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

// Lightweight click-to-toggle popover. Avoids the project's existing modal
// stack so the tree feels fast and keyboard-friendly later.
function RowMenu({ items }: { items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        className="btn btn-ghost"
        style={{ padding: '0 4px', fontSize: 12, lineHeight: 1 }}
        aria-label="More actions"
        onClick={() => setOpen(o => !o)}
      >
        ...
      </button>
      {open && (
        <span
          onMouseLeave={() => setOpen(false)}
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            background: 'var(--paper)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
            zIndex: 10,
            minWidth: 160,
            padding: 4,
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                color: it.danger ? '#b14a2c' : 'var(--ink)',
                fontSize: 12,
                cursor: 'pointer',
                borderRadius: 4,
              }}
            >
              {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export default function FolderTree({
  notebooks,
  activeId,
  onSelect,
  onCreateNotebook,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameNotebook,
  onDeleteNotebook,
  onMoveNotebook,
  onRestoreSamples,
  compact = false,
  onBack,
  backLabel,
}: FolderTreeProps) {
  const tree = useMemo(() => buildTree(notebooks), [notebooks]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (compact) return new Set();
    const all = new Set<string>();
    function walk(n: FolderNode) {
      if (n.path) all.add(n.path);
      n.children.forEach(walk);
    }
    walk(tree);
    return all;
  });

  function toggleExpand(path: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function handleRootDrop(e: React.DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/scrolllearn-notebook-id');
    if (id) onMoveNotebook(id, '');
  }
  function allowRootDrop(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('text/scrolllearn-notebook-id')) {
      e.preventDefault();
    }
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid var(--rule)',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {onBack && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                padding: '2px 8px',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                flex: '0 0 auto',
              }}
              onClick={onBack}
              title={backLabel ? `Back to ${backLabel}` : 'Back to notebook'}
              aria-label={backLabel ? `Back to ${backLabel}` : 'Back to notebook'}
            >
              <span aria-hidden="true">&lt;</span>
              <span>Back</span>
            </button>
          )}
          <div
            className="eyebrow"
            style={{
              fontSize: 10,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Notebooks
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => onCreateFolder('')}
            title="New folder at root"
          >
            + Folder
          </button>
          <button
            type="button"
            className="btn btn-clay"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => onCreateNotebook('')}
            title="New notebook at root"
          >
            + Notebook
          </button>
          {onRestoreSamples && (
            <RowMenu
              items={[
                {
                  label: 'Restore samples',
                  onClick: onRestoreSamples,
                },
              ]}
            />
          )}
        </div>
      </div>
      <div
        onDragOver={allowRootDrop}
        onDrop={handleRootDrop}
        style={{ flex: 1, overflowY: 'auto', padding: '6px 4px' }}
      >
        {notebooks.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-3)' }}>
            No notebooks yet. Press <span className="mono">+ Notebook</span> to start writing.
          </div>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {/* Render the root's children inline (root has no header row). */}
          {tree.children.map(child => (
            <FolderRow
              key={child.path}
              node={child}
              depth={0}
              expanded={expanded}
              toggleExpand={toggleExpand}
              activeId={activeId}
              onSelect={onSelect}
              onCreateNotebook={onCreateNotebook}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onRenameNotebook={onRenameNotebook}
              onDeleteNotebook={onDeleteNotebook}
              onMoveNotebook={onMoveNotebook}
            />
          ))}
          {tree.notebooks.map(nb => (
            <NotebookRow
              key={nb.id}
              notebook={nb}
              depth={0}
              active={nb.id === activeId}
              onSelect={onSelect}
              onRenameNotebook={onRenameNotebook}
              onDeleteNotebook={onDeleteNotebook}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
