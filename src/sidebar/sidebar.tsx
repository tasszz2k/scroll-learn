/* eslint-disable react-refresh/only-export-components -- sidebar.tsx is the entry point, not a Vite-HMR module */
import { StrictMode, Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import NotesPanel from '../dashboard/components/NotesPanel';
// Lazy-loaded so the Notebooks tab's TipTap + marked + DOMPurify chunk only
// downloads when the user actually opens that tab. The "always-mounted hidden
// tab" pattern below is preserved via the notebooksMounted gate so state
// persists once it has been opened the first time in a session.
const NotebooksPanel = lazy(() => import('../dashboard/components/notebooks/NotebooksPanel'));
import type { Card, Deck, Note, Notebook, Settings as SettingsType } from '../common/types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../common/types';
import ChatPanel from './ChatPanel';
import SidebarStudy from './SidebarStudy';
import SidebarTabs from './SidebarTabs';
import {
  isSidebarTab,
  SIDEBAR_TAB_STORAGE_KEY,
  type SidebarTab,
} from './sidebarTypes';
import '../index.css';
import './sidebar.css';

interface Snapshot {
  cards: Card[];
  decks: Deck[];
  notes: Note[];
  notebooks: Notebook[];
  settings: SettingsType;
}

// Read everything the sidebar needs straight from chrome.storage.local. Avoids
// waking the service worker on every refresh and lets us apply storage-event
// payloads directly when changes arrive.
async function readSnapshot(): Promise<Snapshot> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.CARDS,
    STORAGE_KEYS.DECKS,
    STORAGE_KEYS.NOTES,
    STORAGE_KEYS.NOTEBOOKS,
    STORAGE_KEYS.SETTINGS,
  ]);
  const cards = (stored[STORAGE_KEYS.CARDS] as Card[] | undefined) ?? [];
  const decks = (stored[STORAGE_KEYS.DECKS] as Deck[] | undefined) ?? [];
  const notes = (stored[STORAGE_KEYS.NOTES] as Note[] | undefined) ?? [];
  const notebooks = (stored[STORAGE_KEYS.NOTEBOOKS] as Notebook[] | undefined) ?? [];
  const partial = (stored[STORAGE_KEYS.SETTINGS] as Partial<SettingsType> | undefined) ?? {};
  return { cards, decks, notes, notebooks, settings: { ...DEFAULT_SETTINGS, ...partial } };
}

function readInitialTab(): SidebarTab {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_TAB_STORAGE_KEY);
    if (isSidebarTab(raw)) return raw;
  } catch {
    /* localStorage may be unavailable in some contexts */
  }
  return 'quizzes';
}

function SidebarApp() {
  const [tab, setTabState] = useState<SidebarTab>(readInitialTab);
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [loading, setLoading] = useState(true);
  // Sticky-once gate so the lazy Notebooks chunk is only fetched after the
  // user activates the tab. Once mounted it stays in the DOM (toggled with
  // `hidden`) so tab-switching does not re-fetch or lose editor state.
  const [notebooksMounted, setNotebooksMounted] = useState<boolean>(tab === 'notebooks');

  function setTab(next: SidebarTab) {
    setTabState(next);
    if (next === 'notebooks') setNotebooksMounted(true);
    try {
      window.localStorage.setItem(SIDEBAR_TAB_STORAGE_KEY, next);
    } catch {
      /* ignore quota / privacy mode */
    }
  }

  const reload = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const snap = await readSnapshot();
      setCards(snap.cards);
      setDecks(snap.decks);
      setNotes(snap.notes);
      setNotebooks(snap.notebooks);
      setSettings(snap.settings);
    } catch (error) {
      console.error('[ScrollLearn:sidebar] load failed:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) document.documentElement.classList.add('dark');
  }, [reload]);

  // Apply storage events in-place. Reading newValue from the event payload
  // means we don't depend on a chrome.runtime round-trip after every save --
  // any context that calls chrome.storage.local.set fans out to us instantly.
  useEffect(() => {
    function onChanged(
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) {
      if (area !== 'local') return;
      const cardsChange = changes[STORAGE_KEYS.CARDS];
      if (cardsChange) {
        setCards((cardsChange.newValue as Card[] | undefined) ?? []);
      }
      const decksChange = changes[STORAGE_KEYS.DECKS];
      if (decksChange) {
        setDecks((decksChange.newValue as Deck[] | undefined) ?? []);
      }
      const notesChange = changes[STORAGE_KEYS.NOTES];
      if (notesChange) {
        setNotes((notesChange.newValue as Note[] | undefined) ?? []);
      }
      const notebooksChange = changes[STORAGE_KEYS.NOTEBOOKS];
      if (notebooksChange) {
        setNotebooks((notebooksChange.newValue as Notebook[] | undefined) ?? []);
      }
      const settingsChange = changes[STORAGE_KEYS.SETTINGS];
      if (settingsChange) {
        const partial = (settingsChange.newValue as Partial<SettingsType> | undefined) ?? {};
        setSettings({ ...DEFAULT_SETTINGS, ...partial });
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // Side-panel documents can be hidden when the user collapses the panel.
  // When they bring it back, do a full re-read in case any storage event was
  // delivered while the document was throttled.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void reload(false);
    }
    function onFocus() {
      void reload(false);
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [reload]);

  const dueCount = useMemo(() => {
    if (!settings) return 0;
    const activeId = settings.activeDeckId || null;
    const now = Date.now();
    let n = 0;
    for (const c of cards) {
      if (activeId && c.deckId !== activeId) continue;
      if (c.due <= now) n++;
    }
    return n;
  }, [cards, settings]);

  async function handleSaveSettings(patch: Partial<SettingsType>) {
    const response = await chrome.runtime.sendMessage({ type: 'set_settings', settings: patch });
    if (response?.ok) setSettings(response.data as SettingsType);
    return response;
  }

  async function handleSaveNotebook(notebook: Notebook): Promise<Notebook> {
    const response = await chrome.runtime.sendMessage({ type: 'save_notebook', notebook });
    if (response?.ok && response.data) return response.data as Notebook;
    return notebook;
  }

  async function handleDeleteNotebook(id: string): Promise<void> {
    await chrome.runtime.sendMessage({ type: 'delete_notebook', id });
  }

  async function handleMoveNotebookFolder(fromPath: string, toPath: string): Promise<void> {
    await chrome.runtime.sendMessage({ type: 'move_notebook_folder', fromPath, toPath });
  }

  function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }

  function reloadSidebar() {
    window.location.reload();
  }

  return (
    <div className="sidebar-shell">
      <header className="sidebar-header">
        <div className="sidebar-mark" aria-label="Scroll Learn">
          <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true">
            <rect x="14" y="16" width="36" height="3" fill="#FBF8F2" />
            <rect x="14" y="26" width="28" height="3" fill="#FBF8F2" />
            <rect x="14" y="36" width="32" height="3" fill="#FBF8F2" />
            <path d="M 50 12 Q 60 32 50 52" fill="none" stroke="#C96442" strokeWidth="3" strokeLinecap="round" />
            <circle cx="50" cy="46" r="3" fill="#C96442" />
          </svg>
        </div>
        <div className="sidebar-title">
          <div className="eyebrow">Scroll Learn</div>
          <h1>
            Study, notes &amp;{' '}
            <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>chat</span>
          </h1>
        </div>
        <button
          type="button"
          className="btn btn-ghost sidebar-icon-btn"
          onClick={reloadSidebar}
          title="Reload sidebar"
          aria-label="Reload sidebar"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: 11 }}
          onClick={openDashboard}
          title="Open the full dashboard"
        >
          Dashboard
        </button>
      </header>

      <SidebarTabs
        active={tab}
        onChange={setTab}
        badges={{ quizzes: dueCount }}
      />

      <div className="sidebar-body">
        {loading || !settings ? (
          <div
            className="eyebrow animate-pulse"
            style={{ padding: '40px 0', textAlign: 'center' }}
          >
            Loading...
          </div>
        ) : (
          <>
            <div hidden={tab !== 'quizzes'}>
              <SidebarStudy
                decks={decks}
                cards={cards}
                settings={settings}
                onDataChange={() => reload(false)}
                onSaveSettings={handleSaveSettings}
              />
            </div>
            <div
              hidden={tab !== 'notebooks'}
              style={{ height: '100%', display: tab === 'notebooks' ? 'flex' : undefined, flexDirection: 'column', minHeight: 0 }}
            >
              {notebooksMounted && (
                <Suspense
                  fallback={
                    <div
                      className="eyebrow animate-pulse"
                      style={{ padding: '40px 0', textAlign: 'center' }}
                    >
                      Loading notebooks...
                    </div>
                  }
                >
                  <NotebooksPanel
                    notebooks={notebooks}
                    onSaveNotebook={handleSaveNotebook}
                    onDeleteNotebook={handleDeleteNotebook}
                    onMoveFolder={handleMoveNotebookFolder}
                    embedded
                  />
                </Suspense>
              )}
            </div>
            <div hidden={tab !== 'notes'}>
              <NotesPanel
                notes={notes}
                settings={settings}
                onRefresh={() => reload(false)}
              />
            </div>
            <div hidden={tab !== 'chat'}>
              <ChatPanel />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const container = document.getElementById('sidebar-root');
if (container) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <SidebarApp />
    </StrictMode>,
  );
}
