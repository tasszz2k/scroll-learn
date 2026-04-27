import { useState, useEffect, useCallback } from 'react';
import DeckList from './components/DeckList';
import ImportPanel from './components/ImportPanel';
import NotesPanel from './components/NotesPanel';
import Settings from './components/Settings';
import Stats from './components/Stats';
import StudySession from './components/study/StudySession';
import type { Deck, Card, Note, Settings as SettingsType, Stats as StatsType } from '../common/types';

type Tab = 'decks' | 'notes' | 'import' | 'settings' | 'stats' | 'study';

const HASH_TO_TAB: Record<string, Tab> = {
  '#decks': 'decks',
  '#notes': 'notes',
  '#import': 'import',
  '#settings': 'settings',
  '#stats': 'stats',
  '#study': 'study',
};

function getTabFromHash(): Tab {
  return HASH_TO_TAB[window.location.hash] || 'decks';
}

export default function App() {
  const [activeTab, setActiveTabState] = useState<Tab>(getTabFromHash);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [stats, setStats] = useState<StatsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [editCardId, setEditCardId] = useState<string | null>(null);
  const [editDeckId, setEditDeckId] = useState<string | null>(null);

  function setActiveTab(tab: Tab) {
    setActiveTabState(tab);
    window.location.hash = `#${tab}`;
  }

  const checkEditCardRequest = useCallback(async () => {
    try {
      const result = await chrome.storage.local.get(['editCardId', 'editDeckId']);
      if (result.editCardId && result.editDeckId) {
        setActiveTab('decks');
        setEditCardId(result.editCardId);
        setEditDeckId(result.editDeckId);
        await chrome.storage.local.remove(['editCardId', 'editDeckId']);
      }
    } catch (error) {
      console.error('Failed to check edit card request:', error);
    }
  }, []);

  // Load initial data
  useEffect(() => {
    void loadData();

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDarkMode(prefersDark);

    if (prefersDark) {
      document.documentElement.classList.add('dark');
    }

    void checkEditCardRequest();

    function onHashChange() {
      setActiveTabState(getTabFromHash());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [checkEditCardRequest]);

  async function loadData(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const [decksRes, cardsRes, settingsRes, statsRes, notesRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'get_decks' }),
        chrome.runtime.sendMessage({ type: 'get_cards' }),
        chrome.runtime.sendMessage({ type: 'get_settings' }),
        chrome.runtime.sendMessage({ type: 'get_stats' }),
        chrome.runtime.sendMessage({ type: 'get_notes' }),
      ]);

      if (decksRes.ok) setDecks(decksRes.data || []);
      if (cardsRes.ok) setCards(cardsRes.data || []);
      if (settingsRes.ok) setSettings(settingsRes.data);
      if (statsRes.ok) setStats(statsRes.data);
      if (notesRes.ok) setNotes(notesRes.data || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  function toggleDarkMode() {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
  }

  async function handleSaveDeck(deck: Omit<Deck, 'id' | 'createdAt' | 'updatedAt'> | Deck) {
    const response = await chrome.runtime.sendMessage({ type: 'save_deck', deck });
    if (response.ok) {
      await loadData();
    }
    return response;
  }

  async function handleDeleteDeck(deckId: string) {
    const response = await chrome.runtime.sendMessage({ type: 'delete_deck', deckId });
    if (response.ok) {
      await loadData();
    }
    return response;
  }

  async function handleSaveCard(card: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card) {
    const response = await chrome.runtime.sendMessage({ type: 'save_card', card });
    if (response.ok) {
      await loadData();
    }
    return response;
  }

  async function handleDeleteCard(cardId: string) {
    const response = await chrome.runtime.sendMessage({ type: 'delete_card', cardId });
    if (response.ok) {
      await loadData();
    }
    return response;
  }

  async function handleSaveSettings(newSettings: Partial<SettingsType>) {
    const response = await chrome.runtime.sendMessage({ type: 'set_settings', settings: newSettings });
    if (response.ok) {
      setSettings(response.data);
    }
    return response;
  }

  async function handleImport(importCards: Card[], deckId: string) {
    const response = await chrome.runtime.sendMessage({ 
      type: 'batch_import', 
      cards: importCards,
      deckId 
    });
    if (response.ok) {
      await loadData();
    }
    return response;
  }

  const tabs: { id: Tab; label: string; num: string }[] = [
    { id: 'study',    label: 'Study',      num: '01' },
    { id: 'decks',    label: 'Decks',      num: '02' },
    { id: 'notes',    label: 'Notes',      num: '03' },
    { id: 'import',   label: 'Import',     num: '04' },
    { id: 'settings', label: 'Settings',   num: '05' },
    { id: 'stats',    label: 'Statistics', num: '06' },
  ];

  const totalDue = cards.filter(c => c.due <= Date.now()).length;
  const streak = stats?.currentStreak ?? 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
        <div className="eyebrow animate-pulse">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      {/* Editorial header */}
      <header
        className="sticky top-0 z-50"
        style={{
          background: 'rgba(245, 241, 235, 0.92)',
          backdropFilter: 'saturate(160%) blur(8px)',
          WebkitBackdropFilter: 'saturate(160%) blur(8px)',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <div className="max-w-6xl mx-auto" style={{ padding: '24px 24px 0' }}>
          <div className="flex items-start justify-between gap-6">
            {/* Left: mark + display */}
            <div className="flex items-center" style={{ gap: 14 }}>
              <div
                className="flex items-center justify-center"
                style={{ width: 46, height: 46, background: 'var(--ink)', borderRadius: 8, flexShrink: 0 }}
              >
                <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
                  <rect x="14" y="16" width="36" height="3" fill="#FBF8F2" />
                  <rect x="14" y="26" width="28" height="3" fill="#FBF8F2" />
                  <rect x="14" y="36" width="32" height="3" fill="#FBF8F2" />
                  <path d="M 50 12 Q 60 32 50 52" fill="none" stroke="#C96442" strokeWidth="3" strokeLinecap="round" />
                  <circle cx="50" cy="46" r="3" fill="#C96442" />
                </svg>
              </div>
              <div>
                <div className="eyebrow" style={{ fontSize: 11 }}>Scroll · Learn</div>
                <h1 className="display" style={{ fontSize: 30, marginTop: 2, lineHeight: 1 }}>
                  The <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>quiet</span> feed.
                </h1>
              </div>
            </div>

            {/* Right: meta + actions */}
            <div className="text-right" style={{ paddingTop: 4 }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.12em' }}>
                {totalDue > 0 ? `${totalDue} DUE` : 'NOTHING DUE'} · STREAK {streak}
              </div>
              <div className="flex justify-end" style={{ gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className="btn btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  aria-label="Toggle theme"
                >
                  {darkMode ? 'Light' : 'Dark'}
                </button>
                <button
                  type="button"
                  className="btn btn-clay"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                  onClick={() => setActiveTab('study')}
                >
                  Begin study →
                </button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex" style={{ gap: 28, marginTop: 24 }}>
            {tabs.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className="flex items-center"
                  style={{
                    gap: 8,
                    padding: '14px 0',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: active ? '2px solid var(--clay)' : '2px solid transparent',
                    color: active ? 'var(--ink)' : 'var(--ink-3)',
                    fontFamily: "'Inter', system-ui, sans-serif",
                    fontWeight: 500,
                    fontSize: 13,
                    cursor: 'pointer',
                    marginBottom: -1,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: active ? 'var(--clay)' : 'var(--ink-4)',
                      letterSpacing: 0,
                    }}
                  >
                    {tab.num}
                  </span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto" style={{ padding: '40px 24px 56px' }}>
        {activeTab === 'study' && settings && (
          <StudySession
            decks={decks}
            cards={cards}
            settings={settings}
            onDataChange={() => loadData(false)}
            onSaveSettings={handleSaveSettings}
          />
        )}

        {activeTab === 'decks' && (
          <DeckList
            decks={decks}
            cards={cards}
            stats={stats}
            onSaveDeck={handleSaveDeck}
            onDeleteDeck={handleDeleteDeck}
            onSaveCard={handleSaveCard}
            onDeleteCard={handleDeleteCard}
            activeDeckId={settings?.activeDeckId ?? null}
            onSetActiveDeck={async (deckId) => {
              await handleSaveSettings({ activeDeckId: deckId });
            }}
            editCardId={editCardId}
            editDeckId={editDeckId}
            onEditCardHandled={() => { setEditCardId(null); setEditDeckId(null); }}
            onBeginStudy={() => setActiveTab('study')}
          />
        )}
        
        {activeTab === 'notes' && settings && (
          <NotesPanel
            notes={notes}
            settings={settings}
            onRefresh={() => loadData(false)}
          />
        )}

        {activeTab === 'import' && (
          <ImportPanel
            decks={decks}
            onImport={handleImport}
            onCreateDeck={handleSaveDeck}
          />
        )}
        
        {activeTab === 'settings' && settings && (
          <Settings
            decks={decks}
            settings={settings}
            onSave={handleSaveSettings}
          />
        )}
        
        {activeTab === 'stats' && stats && (
          <Stats
            stats={stats}
            decks={decks}
            cards={cards}
          />
        )}
      </main>
    </div>
  );
}
