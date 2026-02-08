import { useState, useEffect, useRef } from 'react';
import type { Deck, Card, Response } from '../../common/types';
import CardEditor from './CardEditor';

interface DeckListProps {
  decks: Deck[];
  cards: Card[];
  onSaveDeck: (deck: Omit<Deck, 'id' | 'createdAt' | 'updatedAt'> | Deck) => Promise<Response<Deck>>;
  onDeleteDeck: (deckId: string) => Promise<Response<void>>;
  onSaveCard: (card: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card) => Promise<Response<Card>>;
  onDeleteCard: (cardId: string) => Promise<Response<void>>;
  editCardId?: string | null;
  editDeckId?: string | null;
  onEditCardHandled?: () => void;
}

export default function DeckList({
  decks,
  cards,
  onSaveDeck,
  onDeleteDeck,
  onSaveCard,
  onDeleteCard,
  editCardId,
  editDeckId,
  onEditCardHandled,
}: DeckListProps) {
  const [expandedDeck, setExpandedDeck] = useState<string | null>(null);
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [showNewCard, setShowNewCard] = useState(false);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckDescription, setNewDeckDescription] = useState('');
  const pendingScrollCardIdRef = useRef<string | null>(null);

  // Handle edit card request from quiz
  useEffect(() => {
    if (editCardId && editDeckId && cards.length > 0) {
      const cardToEdit = cards.find(c => c.id === editCardId);
      if (cardToEdit) {
        setExpandedDeck(editDeckId);
        setEditingCard(cardToEdit);
        pendingScrollCardIdRef.current = cardToEdit.id;
      }
      onEditCardHandled?.();
    }
  }, [editCardId, editDeckId, cards, onEditCardHandled]);

  useEffect(() => {
    const targetCardId = pendingScrollCardIdRef.current;
    if (!targetCardId || editingCard?.id !== targetCardId) return;

    let rafId = 0;
    const timeoutId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(() => {
        const cardContainer = document.getElementById(`card-row-${targetCardId}`);
        cardContainer?.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const firstInput = cardContainer?.querySelector('input, textarea, select') as HTMLElement | null;
        firstInput?.focus({ preventScroll: true });
      });
      pendingScrollCardIdRef.current = null;
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [editingCard, expandedDeck]);

  function getCardsForDeck(deckId: string): Card[] {
    return cards.filter(c => c.deckId === deckId);
  }

  function getDueCount(deckId: string): number {
    const now = Date.now();
    return getCardsForDeck(deckId).filter(c => c.due <= now).length;
  }

  async function handleCreateDeck() {
    if (!newDeckName.trim()) return;
    
    await onSaveDeck({
      name: newDeckName.trim(),
      description: newDeckDescription.trim(),
    });
    
    setNewDeckName('');
    setNewDeckDescription('');
    setShowNewDeck(false);
  }

  async function handleUpdateDeck() {
    if (!editingDeck || !editingDeck.name.trim()) return;
    
    await onSaveDeck(editingDeck);
    setEditingDeck(null);
  }

  async function handleDeleteDeck(deckId: string) {
    if (confirm('Delete this deck and all its cards? This cannot be undone.')) {
      await onDeleteDeck(deckId);
    }
  }

  async function handleExportDeck(deck: Deck) {
    const deckCards = getCardsForDeck(deck.id);
    const exportData = { deck, cards: deckCards };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Your Decks</h2>
          <p className="text-surface-500 mt-1">
            {decks.length} {decks.length === 1 ? 'deck' : 'decks'}, {cards.length} total cards
          </p>
        </div>
        <button
          onClick={() => setShowNewDeck(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Deck
        </button>
      </div>

      {/* New Deck Form */}
      {showNewDeck && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900 animate-slide-down">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Create New Deck</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Name</label>
              <input
                type="text"
                className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                value={newDeckName}
                onChange={e => setNewDeckName(e.target.value)}
                placeholder="e.g., Spanish Vocabulary"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Description (optional)</label>
              <input
                type="text"
                className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                value={newDeckDescription}
                onChange={e => setNewDeckDescription(e.target.value)}
                placeholder="e.g., Common words and phrases"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateDeck} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500">Create Deck</button>
              <button onClick={() => setShowNewDeck(false)} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-surface-200 text-surface-900 hover:bg-surface-300 focus:ring-surface-400 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Decks List */}
      {decks.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900 text-center py-12">
          <div className="w-16 h-16 bg-surface-100 dark:bg-surface-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-surface-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-2">No decks yet</h3>
          <p className="text-surface-500 mb-4">Create your first deck to start learning!</p>
          <button onClick={() => setShowNewDeck(true)} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500">
            Create Your First Deck
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {decks.map(deck => {
            const deckCards = getCardsForDeck(deck.id);
            const dueCount = getDueCount(deck.id);
            const isExpanded = expandedDeck === deck.id;
            
            return (
              <div key={deck.id} className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900 p-0 overflow-hidden">
                {/* Deck Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
                  onClick={() => setExpandedDeck(isExpanded ? null : deck.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        dueCount > 0 
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-500'
                      }`}>
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-surface-900 dark:text-surface-50">{deck.name}</h3>
                        {deck.description && (
                          <p className="text-sm text-surface-500">{deck.description}</p>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm font-medium text-surface-900 dark:text-surface-50">
                          {deckCards.length} cards
                        </div>
                        {dueCount > 0 && (
                          <div className="text-sm text-primary-600 dark:text-primary-400">
                            {dueCount} due
                          </div>
                        )}
                      </div>
                      
                      <svg
                        className={`w-5 h-5 text-surface-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="6,9 12,15 18,9" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="border-t border-surface-200 dark:border-surface-800">
                    {/* Deck Actions */}
                    <div className="p-4 bg-surface-50 dark:bg-surface-800/50 flex gap-2 flex-wrap">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCard(null);
                          setShowNewCard(true);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        Add Card
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingDeck(deck);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium bg-surface-200 text-surface-700 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-200 dark:hover:bg-surface-600 transition-colors"
                      >
                        Edit Deck
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExportDeck(deck);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium bg-surface-200 text-surface-700 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-200 dark:hover:bg-surface-600 transition-colors"
                      >
                        Export
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteDeck(deck.id);
                        }}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                      >
                        Delete
                      </button>
                    </div>

                    {/* Cards List */}
                    <div className="divide-y divide-surface-200 dark:divide-surface-800">
                      {showNewCard && (
                        <div className="p-4">
                          <CardEditor
                            deckId={deck.id}
                            onSave={async (card) => {
                              await onSaveCard(card);
                              setShowNewCard(false);
                            }}
                            onCancel={() => setShowNewCard(false)}
                          />
                        </div>
                      )}
                      
                      {deckCards.length === 0 && !showNewCard ? (
                        <div className="p-8 text-center text-surface-500">
                          No cards in this deck yet
                        </div>
                      ) : (
                        deckCards.map(card => (
                          <div key={card.id} id={`card-row-${card.id}`} className="p-4">
                            {editingCard?.id === card.id ? (
                              <CardEditor
                                card={card}
                                deckId={deck.id}
                                onSave={async (updatedCard) => {
                                  await onSaveCard(updatedCard);
                                  setEditingCard(null);
                                }}
                                onCancel={() => setEditingCard(null)}
                              />
                            ) : (
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                      card.kind === 'mcq-single' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                                      card.kind === 'mcq-multi' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                                      card.kind === 'text' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                                      card.kind === 'cloze' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
                                      'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300'
                                    }`}>
                                      {card.kind}
                                    </span>
                                    {card.due <= Date.now() && (
                                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                                        Due
                                      </span>
                                    )}
                                  </div>
                                  <p className="font-medium text-surface-900 dark:text-surface-50 truncate">
                                    {card.front}
                                  </p>
                                  <p className="text-sm text-surface-500 truncate">
                                    {card.back}
                                  </p>
                                </div>
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => setEditingCard(card)}
                                    className="p-2 text-surface-400 hover:text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-800 rounded"
                                  >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm('Delete this card?')) {
                                        onDeleteCard(card.id);
                                      }
                                    }}
                                    className="p-2 text-surface-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                                  >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="3,6 5,6 21,6" />
                                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Deck Modal */}
      {editingDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900 w-full max-w-md mx-4 animate-slide-up">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-surface-50 mb-4">Edit Deck</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Name</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                  value={editingDeck.name}
                  onChange={e => setEditingDeck({ ...editingDeck, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Description</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                  value={editingDeck.description}
                  onChange={e => setEditingDeck({ ...editingDeck, description: e.target.value })}
                />
              </div>
              <div className="flex gap-2">
                <button onClick={handleUpdateDeck} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500">Save Changes</button>
                <button onClick={() => setEditingDeck(null)} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-surface-200 text-surface-900 hover:bg-surface-300 focus:ring-surface-400 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
