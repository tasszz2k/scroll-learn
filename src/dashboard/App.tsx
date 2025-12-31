import { useState, useEffect } from 'react';
import DeckList from './components/DeckList';
import ImportPanel from './components/ImportPanel';
import Settings from './components/Settings';
import Stats from './components/Stats';
import type { Deck, Card, Settings as SettingsType, Stats as StatsType } from '../common/types';

type Tab = 'decks' | 'import' | 'settings' | 'stats';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('decks');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [stats, setStats] = useState<StatsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // Load initial data
  useEffect(() => {
    loadData();
    
    // Check for dark mode preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDarkMode(prefersDark);
    
    if (prefersDark) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [decksRes, cardsRes, settingsRes, statsRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'get_decks' }),
        chrome.runtime.sendMessage({ type: 'get_cards' }),
        chrome.runtime.sendMessage({ type: 'get_settings' }),
        chrome.runtime.sendMessage({ type: 'get_stats' }),
      ]);

      if (decksRes.ok) setDecks(decksRes.data || []);
      if (cardsRes.ok) setCards(cardsRes.data || []);
      if (settingsRes.ok) setSettings(settingsRes.data);
      if (statsRes.ok) setStats(statsRes.data);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
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

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'decks',
      label: 'Decks',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
    },
    {
      id: 'import',
      label: 'Import',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17,8 12,3 7,8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      ),
    },
    {
      id: 'stats',
      label: 'Statistics',
      icon: (
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
        <div className="animate-pulse text-surface-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-surface-200 dark:border-surface-800 bg-white/80 dark:bg-surface-900/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/icons/icon48.png" 
              alt="ScrollLearn" 
              className="w-10 h-10 rounded-xl"
            />
            <div>
              <h1 className="text-xl font-semibold text-surface-900 dark:text-surface-50">ScrollLearn</h1>
              <p className="text-sm text-surface-500">Learn while you scroll</p>
            </div>
          </div>
          
          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            aria-label="Toggle dark mode"
          >
            {darkMode ? (
              <svg className="w-5 h-5 text-surface-600 dark:text-surface-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-surface-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>
        </div>
        
        {/* Tabs */}
        <nav className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.id
                    ? 'text-primary-600 border-primary-600 dark:text-primary-400 dark:border-primary-400'
                    : 'text-surface-500 border-transparent hover:text-surface-700 dark:hover:text-surface-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {activeTab === 'decks' && (
          <DeckList
            decks={decks}
            cards={cards}
            onSaveDeck={handleSaveDeck}
            onDeleteDeck={handleDeleteDeck}
            onSaveCard={handleSaveCard}
            onDeleteCard={handleDeleteCard}
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

