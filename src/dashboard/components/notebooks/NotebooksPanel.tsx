import { useCallback, useEffect, useRef, useState } from 'react';
import type { Notebook } from '../../../common/types';
import { createNotebook } from '../../../common/types';
import {
  deleteAllForNotebook,
  getBody,
  saveBody,
} from '../../../common/notebookStore';
import { instantiateTemplate, type NotebookTemplate } from '../../../common/notebookTemplates';
import {
  buildNotebookZip,
  downloadBlob,
  exportNotebookMarkdown,
} from '../../../common/notebookExport';
import { useNotebookAutosave } from '../../hooks/useNotebookAutosave';
import EditorialHeader from '../EditorialHeader';
import { useDialogs } from './Dialogs';
import FolderTree from './FolderTree';
import NotebookAiPanel from './NotebookAiPanel';
import NotebookEditor, {
  normalizeViewMode,
  type NotebookEditorHandle,
  type ViewMode,
} from './NotebookEditor';
import SearchBar, { type SearchMode } from './SearchBar';
import TemplatePicker from './TemplatePicker';
import { STORAGE_KEYS } from '../../../common/types';

// Universally-recognized fullscreen icons (the same glyph shape used by
// YouTube and most video players): four corner brackets pointing outward
// to expand and inward to collapse. Stroke-based so they inherit the
// button's text color and stay crisp at any size.
const FULLSCREEN_ICON_PROPS = {
  width: 13,
  height: 13,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function FullscreenExpandIcon() {
  return (
    <svg {...FULLSCREEN_ICON_PROPS}>
      <path d="M2 6V2h4" />
      <path d="M14 6V2h-4" />
      <path d="M2 10v4h4" />
      <path d="M14 10v4h-4" />
    </svg>
  );
}

function FullscreenCollapseIcon() {
  return (
    <svg {...FULLSCREEN_ICON_PROPS}>
      <path d="M6 2v4H2" />
      <path d="M10 2v4h4" />
      <path d="M6 14v-4H2" />
      <path d="M10 14v-4h4" />
    </svg>
  );
}

interface NotebooksPanelProps {
  notebooks: Notebook[];
  // Persist a notebook (create or update). The caller resolves to the saved
  // record so the panel can adopt the canonical id/timestamps.
  onSaveNotebook: (notebook: Notebook) => Promise<Notebook>;
  // Delete the metadata only. The panel removes the body + attachments from
  // IndexedDB before calling this.
  onDeleteNotebook: (id: string) => Promise<void>;
  onMoveFolder: (fromPath: string, toPath: string) => Promise<void>;
  // Manual "Restore samples" entry point exposed in the FolderTree menu.
  // The dashboard wires this to restoreSampleNotebooks(); the sidebar can
  // omit it. Returns counts so the panel can surface a friendly summary.
  onRestoreSamples?: () => Promise<{ added: number; skippedCollisions: number }>;
  // Sidebar mode: stack tree + editor vertically and trim chrome. Dashboard
  // uses the wider three-pane layout.
  embedded?: boolean;
  // Callback when the panel wants to hand a CSV import off to ImportPanel.
  // Only the dashboard wires this; sidebar omits it (no Import tab there).
  onPendingImport?: (payload: { content: string; format: 'csv'; deckName: string }) => void;
  // Optional notebook id to focus on mount (deep link via '#notebooks/<id>').
  // null/undefined => fall back to the first available notebook. Re-applied
  // on every hashchange so navigating between deep links inside the same
  // dashboard tab works without a reload.
  initialNotebookId?: string | null;
}

// Persist the metadata via the message channel; the body is owned by the
// autosave hook once the editor mounts. Template-driven creates write the
// body directly through saveBody before the editor mounts to avoid a flash
// of empty content.
async function persistNotebookMetadata(
  metadata: Notebook,
  onSaveNotebook: NotebooksPanelProps['onSaveNotebook'],
): Promise<Notebook> {
  return onSaveNotebook(metadata);
}

export default function NotebooksPanel({
  notebooks,
  onSaveNotebook,
  onDeleteNotebook,
  onMoveFolder,
  onRestoreSamples,
  embedded = false,
  onPendingImport,
  initialNotebookId = null,
}: NotebooksPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(initialNotebookId);
  // Dashboard-only "focus mode": hides the FolderTree side panel so the
  // editor uses the full available width. Toggled from the editor toolbar.
  // Embedded mode handles wide layout via a new tab instead.
  const [focusMode, setFocusMode] = useState(false);
  const [bodyText, setBodyText] = useState<string>('');
  // The user's last-chosen view mode is hydrated from chrome.storage on
  // mount so power users who prefer the Markdown tab don't get bounced
  // back to Format on every notebook switch. Default for fresh installs
  // is 'format' so non-tech users land in the WYSIWYG view.
  const [viewMode, setViewMode] = useState<ViewMode>('format');
  // When the user clicks "+ Notebook", we open the template picker and
  // remember the target folder. null means the picker is closed.
  const [pickerTarget, setPickerTarget] = useState<string | null>(null);
  // null when no search dialog is open; otherwise quick-open or full-text.
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  // AI panel toggle. Defaults to closed; opens via the editor's AI button.
  const [aiOpen, setAiOpen] = useState(false);
  // In compact (sidebar) mode the AI bottom sheet defaults to a partial
  // height so the editor stays partially visible behind it. Long
  // conversations need more room, so the user can flip it to near-full
  // viewport via a header toggle. Reset whenever the panel is closed.
  const [aiMaximized, setAiMaximized] = useState(false);
  // In compact (sidebar) mode the tree is hidden behind a slide-in overlay
  // so the editor can take the full width. Toggled by the hamburger button.
  const [treeOverlayOpen, setTreeOverlayOpen] = useState(false);
  const editorRef = useRef<NotebookEditorHandle | null>(null);

  // Styled prompt/confirm replacements for window.prompt/window.confirm.
  // Single-dialog-at-a-time; user actions in this surface are sequential.
  const dialog = useDialogs();

  // Adopt the first notebook on mount so the editor is never empty when one
  // exists. We also fall back if the deep-link `initialNotebookId` points
  // to a notebook that no longer exists (e.g. deleted in another tab).
  useEffect(() => {
    if (notebooks.length === 0) return;
    const stillExists = activeId != null && notebooks.some(nb => nb.id === activeId);
    if (!stillExists) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reactive selection driven by a server-fed list; idempotent
      setActiveId(notebooks[0].id);
    }
  }, [activeId, notebooks]);

  // Mirror the active notebook id into the URL hash so the dashboard tab
  // can be bookmarked / refreshed without losing place. We use
  // history.replaceState rather than setting `window.location.hash` to
  // avoid triggering our own hashchange listener and creating a loop;
  // this also keeps the back/forward stack clean (selecting notebooks
  // shouldn't fill it up). Sidebar mode lives on a different document
  // (sidebar.html) so we skip the sync there.
  useEffect(() => {
    if (embedded) return;
    if (!activeId) return;
    const desired = `#notebooks/${activeId}`;
    if (window.location.hash !== desired) {
      try {
        window.history.replaceState(null, '', desired);
      } catch {
        /* SecurityError in some sandboxed iframes -- ignore */
      }
    }
  }, [activeId, embedded]);

  // Listen for hashchange so a user navigating via the address bar (or a
  // popup-link) lands on the requested notebook without a reload.
  useEffect(() => {
    if (embedded) return;
    function onHashChange() {
      const h = window.location.hash;
      const prefix = '#notebooks/';
      if (!h.startsWith(prefix)) return;
      const id = h.slice(prefix.length).trim();
      if (id && id !== activeId) {
        setActiveId(id);
      }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [embedded, activeId]);

  // Hydrate the last-used view mode once on mount. The flag uses
  // chrome.storage.local so it survives extension reloads. We tolerate
  // missing chrome APIs (tests, dev preview) by no-oping silently.
  const viewModeHydratedRef = useRef(false);
  useEffect(() => {
    if (viewModeHydratedRef.current) return;
    viewModeHydratedRef.current = true;
    try {
      chrome?.storage?.local?.get(STORAGE_KEYS.NOTEBOOK_VIEW_MODE, (got) => {
        const stored = got?.[STORAGE_KEYS.NOTEBOOK_VIEW_MODE];
        if (stored != null) {
          setViewMode(normalizeViewMode(stored));
        }
      });
    } catch {
      /* no chrome storage available -- keep default */
    }
  }, []);

  // Persist on every change after hydration. The first render is a no-op
  // because viewModeHydratedRef is still false; once the async get above
  // runs it flips to true and any user-driven change is mirrored to
  // storage.
  useEffect(() => {
    if (!viewModeHydratedRef.current) return;
    try {
      chrome?.storage?.local?.set({ [STORAGE_KEYS.NOTEBOOK_VIEW_MODE]: viewMode });
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  // Cmd/Ctrl+P -> quick-open; Cmd/Ctrl+Shift+F -> full-text. Both are
  // panel-level so they fire whether or not the editor textarea has focus.
  // We block the default browser behaviour for both.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === 'p' && !e.shiftKey) {
        e.preventDefault();
        setSearchMode('quick');
        return;
      }
      if (key === 'f' && e.shiftKey) {
        e.preventDefault();
        setSearchMode('fulltext');
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Load body when active notebook changes.
  useEffect(() => {
    let cancelled = false;
    if (activeId == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the editor when no notebook is selected
      setBodyText('');
      return;
    }
    void (async () => {
      const md = await getBody(activeId);
      if (!cancelled) setBodyText(md);
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  const activeNotebook = notebooks.find(nb => nb.id === activeId) ?? null;

  const { status, savedAt, flush } = useNotebookAutosave({
    notebookId: activeId,
    body: bodyText,
  });

  // Metadata writes are immediate (so the tree updates without a
  // debounce). Body writes go through the autosave hook above.
  const handleMetaChange = useCallback(
    async (changes: Partial<Notebook>) => {
      if (!activeNotebook) return;
      const next = { ...activeNotebook, ...changes };
      await onSaveNotebook(next);
    },
    [activeNotebook, onSaveNotebook],
  );

  // ---- Folder + notebook operations wired to FolderTree ----

  // Open the template picker. The actual create runs once the user picks a
  // template (or cancels).
  function handleCreateNotebook(folderPath: string) {
    setPickerTarget(folderPath);
  }

  async function instantiateAndOpenTemplate(template: NotebookTemplate, folderPath: string) {
    const inst = instantiateTemplate(template);
    // The user explicitly picked the folder in the template picker, so
    // their choice always wins over the template's defaultFolderPath.
    const created = createNotebook({
      title: inst.title,
      folderPath,
      tags: inst.tags,
      properties: inst.properties,
    });
    const saved = await persistNotebookMetadata(created, onSaveNotebook);
    // Pre-write the body to IndexedDB so the editor's initial getBody()
    // returns the template content rather than racing the autosave hook.
    if (inst.body) {
      await saveBody(saved.id, inst.body);
    }
    setActiveId(saved.id);
    setBodyText(inst.body);
  }

  async function handleCreateFolder(parentPath: string) {
    const name = await dialog.prompt({
      title: 'New folder',
      description: parentPath
        ? <>Inside <span className="mono">{parentPath}</span></>
        : 'At the root of your tree.',
      placeholder: 'Folder name',
      confirmLabel: 'Create',
    });
    const trimmed = name?.trim();
    if (!trimmed) return;
    // Folders only "exist" while at least one notebook lives in them, so
    // the new folder ships with a starter notebook the user can rename.
    const folderPath = `${parentPath}/${trimmed}`;
    handleCreateNotebook(folderPath);
  }

  async function requestRenameFolder(path: string, currentName: string) {
    const next = await dialog.prompt({
      title: 'Rename folder',
      description: <>Currently <span className="mono">{path}</span></>,
      initial: currentName,
      placeholder: 'Folder name',
      confirmLabel: 'Rename',
    });
    const trimmed = next?.trim();
    if (!trimmed || trimmed === currentName) return;
    const segments = path.split('/').filter(Boolean);
    segments[segments.length - 1] = trimmed;
    const nextPath = '/' + segments.join('/');
    await onMoveFolder(path, nextPath);
  }

  async function requestDeleteFolder(path: string, descendantCount: number) {
    const ok = await dialog.confirm({
      title: 'Delete folder?',
      description: (
        <>
          This will remove <span className="mono">{path}</span> and{' '}
          <strong>
            {descendantCount} notebook{descendantCount === 1 ? '' : 's'}
          </strong>{' '}
          inside it. This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const targets = notebooks.filter(
      nb => nb.folderPath === path || nb.folderPath.startsWith(path + '/'),
    );
    for (const nb of targets) {
      await deleteAllForNotebook(nb.id);
      await onDeleteNotebook(nb.id);
      if (nb.id === activeId) setActiveId(null);
    }
  }

  async function requestRenameNotebook(id: string, currentTitle: string) {
    const next = await dialog.prompt({
      title: 'Rename notebook',
      initial: currentTitle,
      placeholder: 'Notebook title',
      confirmLabel: 'Rename',
    });
    const trimmed = next?.trim();
    if (!trimmed || trimmed === currentTitle) return;
    const target = notebooks.find(nb => nb.id === id);
    if (!target) return;
    await onSaveNotebook({ ...target, title: trimmed });
  }

  async function handleDeleteNotebook(id: string) {
    await flush();
    await deleteAllForNotebook(id);
    await onDeleteNotebook(id);
    if (activeId === id) {
      setActiveId(null);
      setBodyText('');
    }
  }

  async function requestDeleteNotebook(id: string, currentTitle: string) {
    const ok = await dialog.confirm({
      title: 'Delete notebook?',
      description: (
        <>
          Permanently remove <strong>{currentTitle}</strong>. This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await handleDeleteNotebook(id);
  }

  async function handleMoveNotebook(id: string, nextFolderPath: string) {
    const target = notebooks.find(nb => nb.id === id);
    if (!target || target.folderPath === nextFolderPath) return;
    await onSaveNotebook({ ...target, folderPath: nextFolderPath });
  }

  // ---- Restore samples ----
  //
  // Triggered from the FolderTree menu. Confirms with the user, then defers
  // to the dashboard-supplied handler (which calls restoreSampleNotebooks).
  // The summary toast is intentionally a window.alert: this surface does
  // not have a toast system yet and a one-shot blocking dialog matches the
  // rest of the tree's confirms.
  async function handleRestoreSamples() {
    if (!onRestoreSamples) return;
    const ok = await dialog.confirm({
      title: 'Restore sample notebooks?',
      description: (
        <>
          Restore the bundled English-learning sample notebooks. Existing
          notebooks with the same title and folder will be skipped, so this
          is safe to re-run.
        </>
      ),
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      const result = await onRestoreSamples();
      if (result.added === 0 && result.skippedCollisions > 0) {
        window.alert(
          `All ${result.skippedCollisions} sample notebook${result.skippedCollisions === 1 ? '' : 's'} are already in your tree. Nothing was added.`,
        );
      } else if (result.added > 0 && result.skippedCollisions > 0) {
        window.alert(
          `Added ${result.added} sample${result.added === 1 ? '' : 's'}. Skipped ${result.skippedCollisions} that already existed.`,
        );
      } else if (result.added > 0) {
        window.alert(`Added ${result.added} sample notebook${result.added === 1 ? '' : 's'}.`);
      }
    } catch (err) {
      window.alert(`Failed to restore samples: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ---- Export ----

  async function exportCurrent() {
    if (!activeNotebook) return;
    await flush();
    const md = await getBody(activeNotebook.id);
    const out = exportNotebookMarkdown(activeNotebook, md);
    const blob = new Blob([out.content], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, out.filename);
  }

  async function exportAll() {
    if (notebooks.length === 0) return;
    await flush();
    const records = await Promise.all(
      notebooks.map(async nb => ({ notebook: nb, body: await getBody(nb.id) })),
    );
    const blob = buildNotebookZip(records);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(blob, `scrolllearn-notebooks-${stamp}.zip`);
  }

  // Pick a notebook from a search hit -- closes the search modal and
  // updates the active notebook in the editor.
  function handleSearchPick(id: string) {
    setActiveId(id);
    setSearchMode(null);
  }

  // ---- Layout ----

  // Dashboard mode splits tree + editor horizontally with a fixed-width
  // tree column. Compact (sidebar) mode hides the tree behind an overlay
  // drawer and gives the editor the full width; the AI panel is a bottom
  // sheet there instead of a right column.
  // We want the editor to grow with the viewport on tall monitors -- the
  // old 760px cap left huge empty bands of background below the panel.
  // clamp keeps a sensible floor for short viewports and an upper bound
  // so 4K monitors don't get an awkwardly tall blank canvas. Focus mode
  // (FolderTree hidden) gets a touch more height to compensate for the
  // missing chrome on the side; we use the full available viewport
  // minus the dashboard chrome above the panel.
  const containerHeight = embedded
    ? '100%'
    : focusMode
      ? 'clamp(500px, 94vh, 1800px)'
      : 'clamp(500px, 88vh, 1400px)';

  // Pick a notebook from the tree overlay -- closes the drawer and
  // switches the active notebook.
  function pickFromOverlay(id: string) {
    setActiveId(id);
    setTreeOverlayOpen(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: embedded ? '100%' : undefined }}>
      {!embedded && !focusMode && (
        <EditorialHeader
          kicker="04 . Notebooks"
          title={
            <>
              Notebooks, <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>quietly</span> kept.
            </>
          }
          sub="Author markdown notes by hand. Autosaved locally. Indexed for search. Generate quizzes with AI."
          action={
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => setSearchMode('quick')}
                title="Quick open (Cmd/Ctrl+P)"
              >
                Open
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => setSearchMode('fulltext')}
                title="Full-text search (Cmd/Ctrl+Shift+F)"
              >
                Search
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => void exportCurrent()}
                disabled={!activeNotebook}
                title="Export the current notebook as .md"
              >
                Export .md
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => void exportAll()}
                disabled={notebooks.length === 0}
                title="Export every notebook as a single .zip"
              >
                Export all
              </button>
              <span
                aria-hidden
                style={{
                  width: 1,
                  alignSelf: 'stretch',
                  background: 'var(--rule)',
                  margin: '2px 4px',
                }}
              />
              <button
                type="button"
                className={aiOpen ? 'btn btn-clay' : 'btn'}
                style={{
                  padding: '4px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  background: aiOpen ? undefined : 'var(--clay-wash)',
                  color: aiOpen ? undefined : 'var(--clay-deep)',
                  borderColor: 'var(--clay-tint)',
                }}
                onClick={() => setAiOpen(o => !o)}
                disabled={!activeNotebook}
                title={
                  activeNotebook
                    ? 'Toggle AI assistant'
                    : 'Open a notebook to use the AI assistant'
                }
              >
                AI
              </button>
            </div>
          }
        />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 0,
          height: containerHeight,
          border: '1px solid var(--rule)',
          borderRadius: 6,
          overflow: 'hidden',
          background: 'var(--paper)',
          position: 'relative',
        }}
      >
        {!embedded && !focusMode && (
          <div
            style={{
              width: 280,
              minWidth: 240,
              maxWidth: 360,
              borderRight: '1px solid var(--rule)',
              background: 'rgba(0,0,0,0.015)',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <FolderTree
              notebooks={notebooks}
              activeId={activeId}
              onSelect={setActiveId}
              onCreateNotebook={handleCreateNotebook}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={requestRenameFolder}
              onDeleteFolder={requestDeleteFolder}
              onRenameNotebook={requestRenameNotebook}
              onDeleteNotebook={requestDeleteNotebook}
              onMoveNotebook={handleMoveNotebook}
              onRestoreSamples={onRestoreSamples ? handleRestoreSamples : undefined}
              compact={false}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {embedded && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderBottom: '1px solid var(--rule)',
                background: 'rgba(0,0,0,0.015)',
                fontSize: 12,
              }}
            >
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => setTreeOverlayOpen(o => !o)}
                title="Toggle notebook list"
                aria-label="Toggle notebook list"
              >
                {treeOverlayOpen ? 'x' : '\u2630'}
              </button>
              <div className="eyebrow" style={{ fontSize: 10, letterSpacing: '.08em' }}>Notebooks</div>
              <div
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--ink-2)',
                }}
                title={activeNotebook?.title ?? ''}
              >
                {activeNotebook?.title ?? 'No notebook open'}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => setSearchMode('quick')}
                title="Quick open (Cmd/Ctrl+P)"
              >
                Find
              </button>
              {activeNotebook && (
                <button
                  type="button"
                  className={aiOpen ? 'btn btn-clay' : 'btn'}
                  style={{
                    padding: '2px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    background: aiOpen ? undefined : 'var(--clay-wash)',
                    color: aiOpen ? undefined : 'var(--clay-deep)',
                    borderColor: 'var(--clay-tint)',
                  }}
                  onClick={() => setAiOpen(o => !o)}
                  title="Toggle AI assistant"
                >
                  AI
                </button>
              )}
              <button
                type="button"
                className="btn btn-clay"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => handleCreateNotebook('')}
                title="New notebook from template"
              >
                +
              </button>
            </div>
          )}
          {activeNotebook ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <NotebookEditor
                ref={editorRef}
                notebook={activeNotebook}
                body={bodyText}
                onBodyChange={setBodyText}
                onMetaChange={handleMetaChange}
                onForceSave={() => void flush()}
                onDelete={() =>
                  void requestDeleteNotebook(
                    activeNotebook.id,
                    activeNotebook.title || 'Untitled',
                  )
                }
                status={status}
                savedAt={savedAt}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                extraToolbar={
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      paddingLeft: 8,
                      marginLeft: 4,
                      borderLeft: '1px solid var(--rule)',
                    }}
                  >
                    <button
                      type="button"
                      className={focusMode ? 'btn btn-clay' : 'btn btn-ghost'}
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => {
                        if (embedded) {
                          // Sidebar can't grow; promote into a new dashboard
                          // tab pinned to this notebook.
                          if (!activeNotebook) return;
                          const url = chrome?.runtime?.getURL?.(
                            `index.html#notebooks/${activeNotebook.id}`,
                          );
                          if (url) {
                            chrome?.tabs?.create?.({ url });
                          }
                        } else {
                          setFocusMode((f) => !f);
                        }
                      }}
                      title={
                        embedded
                          ? 'Open in full screen (new tab)'
                          : focusMode
                            ? 'Exit full screen (show notebook list)'
                            : 'Full screen (hide notebook list)'
                      }
                      aria-label={
                        embedded
                          ? 'Open in full screen'
                          : focusMode
                            ? 'Exit full screen'
                            : 'Full screen'
                      }
                    >
                      {embedded || !focusMode ? (
                        <FullscreenExpandIcon />
                      ) : (
                        <FullscreenCollapseIcon />
                      )}
                    </button>
                  </span>
                }
                rightPanel={
                  aiOpen && !embedded ? (
                    <NotebookAiPanel
                      notebook={activeNotebook}
                      body={bodyText}
                      onPendingImport={onPendingImport}
                      onInsertText={(text) => editorRef.current?.insertAtCursor(text)}
                      onClose={() => setAiOpen(false)}
                    />
                  ) : null
                }
              />
            </div>
          ) : (
            <EmptyState onCreateNotebook={() => handleCreateNotebook('')} />
          )}
          {/* Compact mode: AI as a bottom sheet anchored to the side panel
              VIEWPORT (position: fixed), not to the editor flex column.
              The sidebar shell uses min-height: 100% and grows with the
              notebook body, so an absolutely-positioned sheet would slide
              off-screen for long notebooks. Viewport-anchored keeps it
              visible no matter how far the user scrolls. The user can
              flip between a partial-height (default) and a near-full
              maximized view via the header toggle, so a long AI
              conversation has room to breathe. */}
          {embedded && aiOpen && activeNotebook && (
            <div
              style={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                height: aiMaximized ? '92vh' : 'min(65vh, 560px)',
                minHeight: 280,
                background: 'var(--paper)',
                borderTop: '1px solid var(--rule)',
                boxShadow: '0 -10px 28px rgba(0,0,0,0.14)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 50,
              }}
            >
              <NotebookAiPanel
                notebook={activeNotebook}
                body={bodyText}
                onPendingImport={onPendingImport}
                onInsertText={(text) => editorRef.current?.insertAtCursor(text)}
                onClose={() => {
                  setAiOpen(false);
                  setAiMaximized(false);
                }}
                maximized={aiMaximized}
                onToggleMaximize={() => setAiMaximized((m) => !m)}
              />
            </div>
          )}
          {/* Compact mode: tree overlay drawer over the full editor area. */}
          {embedded && treeOverlayOpen && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--paper)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 30,
              }}
            >
              <FolderTree
                notebooks={notebooks}
                activeId={activeId}
                onSelect={pickFromOverlay}
                onCreateNotebook={(folderPath) => {
                  setTreeOverlayOpen(false);
                  handleCreateNotebook(folderPath);
                }}
                onCreateFolder={handleCreateFolder}
                onRenameFolder={requestRenameFolder}
                onDeleteFolder={requestDeleteFolder}
                onRenameNotebook={requestRenameNotebook}
                onDeleteNotebook={requestDeleteNotebook}
                onMoveNotebook={handleMoveNotebook}
                onRestoreSamples={onRestoreSamples ? handleRestoreSamples : undefined}
                compact
                onBack={activeNotebook ? () => setTreeOverlayOpen(false) : undefined}
                backLabel={activeNotebook?.title}
              />
            </div>
          )}
        </div>
      </div>
      {pickerTarget !== null && (
        <TemplatePicker
          targetFolderPath={pickerTarget}
          notebooks={notebooks}
          onPick={(template, folderPath) => {
            setPickerTarget(null);
            void instantiateAndOpenTemplate(template, folderPath);
          }}
          onClose={() => setPickerTarget(null)}
        />
      )}
      {searchMode !== null && (
        <SearchBar
          notebooks={notebooks}
          mode={searchMode}
          onPick={handleSearchPick}
          onClose={() => setSearchMode(null)}
        />
      )}
      {dialog.render()}
    </div>
  );
}

function EmptyState({ onCreateNotebook }: { onCreateNotebook: () => void }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 32,
        color: 'var(--ink-3)',
      }}
    >
      <div className="display" style={{ fontSize: 22, color: 'var(--ink-2)' }}>A blank page.</div>
      <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 320 }}>
        No notebook is open yet. Create your first notebook to start writing in markdown.
      </div>
      <button
        type="button"
        className="btn btn-clay"
        style={{ marginTop: 6 }}
        onClick={onCreateNotebook}
      >
        New notebook
      </button>
    </div>
  );
}
