import type { Card, Deck, Settings, Stats, ReviewRecord } from './types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from './types';

// Batch size for chunked operations
const BATCH_SIZE = 100;

// Generic storage helpers
async function get<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] !== undefined ? (result[key] as T) : defaultValue;
  } catch {
    return defaultValue;
  }
}

async function set<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

// Deck Operations
export async function getDecks(): Promise<Deck[]> {
  return get<Deck[]>(STORAGE_KEYS.DECKS, []);
}

export async function saveDecks(decks: Deck[]): Promise<void> {
  await set(STORAGE_KEYS.DECKS, decks);
}

export async function getDeck(deckId: string): Promise<Deck | undefined> {
  const decks = await getDecks();
  return decks.find(d => d.id === deckId);
}

export async function saveDeck(deck: Deck): Promise<Deck> {
  const decks = await getDecks();
  const index = decks.findIndex(d => d.id === deck.id);
  const updatedDeck = { ...deck, updatedAt: Date.now() };
  
  if (index >= 0) {
    decks[index] = updatedDeck;
  } else {
    decks.push(updatedDeck);
  }
  
  await saveDecks(decks);
  return updatedDeck;
}

export async function deleteDeck(deckId: string): Promise<void> {
  // Delete deck
  const decks = await getDecks();
  await saveDecks(decks.filter(d => d.id !== deckId));
  
  // Delete all cards in deck
  const cards = await getCards();
  await saveCards(cards.filter(c => c.deckId !== deckId));
}

// Card Operations
export async function getCards(deckId?: string): Promise<Card[]> {
  const cards = await get<Card[]>(STORAGE_KEYS.CARDS, []);
  if (deckId) {
    return cards.filter(c => c.deckId === deckId);
  }
  return cards;
}

export async function saveCards(cards: Card[]): Promise<void> {
  await set(STORAGE_KEYS.CARDS, cards);
}

export async function getCard(cardId: string): Promise<Card | undefined> {
  const cards = await getCards();
  return cards.find(c => c.id === cardId);
}

export async function saveCard(card: Card): Promise<Card> {
  const cards = await getCards();
  const index = cards.findIndex(c => c.id === card.id);
  const updatedCard = { ...card, updatedAt: Date.now() };
  
  if (index >= 0) {
    cards[index] = updatedCard;
  } else {
    cards.push(updatedCard);
  }
  
  await saveCards(cards);
  return updatedCard;
}

export async function deleteCard(cardId: string): Promise<void> {
  const cards = await getCards();
  await saveCards(cards.filter(c => c.id !== cardId));
}

// Batch Import with Chunking
export async function batchImportCards(newCards: Card[]): Promise<number> {
  const existingCards = await getCards();
  const allCards = [...existingCards];
  
  // Process in chunks to avoid hitting storage limits
  for (let i = 0; i < newCards.length; i += BATCH_SIZE) {
    const chunk = newCards.slice(i, i + BATCH_SIZE);
    allCards.push(...chunk);
    
    // Save after each chunk
    await saveCards(allCards);
  }
  
  return newCards.length;
}

// Settings Operations
export async function getSettings(): Promise<Settings> {
  const settings = await get<Partial<Settings>>(STORAGE_KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await set(STORAGE_KEYS.SETTINGS, updated);
  return updated;
}

// Stats Operations
export async function getStats(): Promise<Stats> {
  return get<Stats>(STORAGE_KEYS.STATS, {
    totalReviews: 0,
    totalCards: 0,
    averageAccuracy: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastReviewDate: null,
    dailyStats: [],
    reviewHistory: [],
  });
}

export async function saveStats(stats: Stats): Promise<void> {
  await set(STORAGE_KEYS.STATS, stats);
}

export async function recordReview(record: ReviewRecord): Promise<void> {
  const stats = await getStats();
  const today = new Date().toISOString().split('T')[0];
  
  // Add to review history
  stats.reviewHistory.push(record);
  
  // Keep only last 1000 reviews in history
  if (stats.reviewHistory.length > 1000) {
    stats.reviewHistory = stats.reviewHistory.slice(-1000);
  }
  
  // Update totals
  stats.totalReviews++;
  
  // Update daily stats
  let todayStats = stats.dailyStats.find(d => d.date === today);
  if (!todayStats) {
    todayStats = {
      date: today,
      reviews: 0,
      correct: 0,
      incorrect: 0,
      averageEase: 0,
    };
    stats.dailyStats.push(todayStats);
  }
  
  todayStats.reviews++;
  if (record.grade >= 2) {
    todayStats.correct++;
  } else {
    todayStats.incorrect++;
  }
  
  // Update streak
  if (stats.lastReviewDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    if (stats.lastReviewDate === yesterdayStr) {
      stats.currentStreak++;
    } else if (stats.lastReviewDate !== today) {
      stats.currentStreak = 1;
    }
    
    stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
    stats.lastReviewDate = today;
  }
  
  // Recalculate average accuracy
  const totalCorrect = stats.dailyStats.reduce((sum, d) => sum + d.correct, 0);
  const totalReviews = stats.dailyStats.reduce((sum, d) => sum + d.reviews, 0);
  stats.averageAccuracy = totalReviews > 0 ? totalCorrect / totalReviews : 0;
  
  // Keep only last 90 days of daily stats
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];
  stats.dailyStats = stats.dailyStats.filter(d => d.date >= cutoffStr);
  
  await saveStats(stats);
}

// Due Queue Operations
export async function getDueCards(limit: number = 100): Promise<Card[]> {
  const now = Date.now();
  const cards = await getCards();
  
  return cards
    .filter(c => c.due <= now)
    .sort((a, b) => a.due - b.due)
    .slice(0, limit);
}

export async function getNextCardForDomain(_domain: string): Promise<Card | null> {
  // For now, domain doesn't affect card selection
  // Could be extended to filter by deck tags or card categories
  const dueCards = await getDueCards(1);
  return dueCards[0] || null;
}

// Paused Sites Operations
interface PausedSite {
  domain: string;
  until: number; // Unix timestamp
}

export async function getPausedSites(): Promise<PausedSite[]> {
  const sites = await get<PausedSite[]>(STORAGE_KEYS.PAUSED_SITES, []);
  // Filter out expired pauses
  const now = Date.now();
  return sites.filter(s => s.until > now);
}

export async function pauseSite(domain: string, minutes: number): Promise<void> {
  const sites = await getPausedSites();
  const until = Date.now() + minutes * 60 * 1000;
  
  const existing = sites.find(s => s.domain === domain);
  if (existing) {
    existing.until = until;
  } else {
    sites.push({ domain, until });
  }
  
  await set(STORAGE_KEYS.PAUSED_SITES, sites);
}

export async function isSitePaused(domain: string): Promise<boolean> {
  const sites = await getPausedSites();
  return sites.some(s => s.domain === domain);
}

// Snoozed Cards Operations
interface SnoozedCard {
  cardId: string;
  until: number;
}

const SNOOZED_CARDS_KEY = 'scrolllearn_snoozed_cards';

export async function getSnoozedCards(): Promise<SnoozedCard[]> {
  const cards = await get<SnoozedCard[]>(SNOOZED_CARDS_KEY, []);
  const now = Date.now();
  return cards.filter(c => c.until > now);
}

export async function snoozeCard(cardId: string, minutes: number): Promise<void> {
  const cards = await getSnoozedCards();
  const until = Date.now() + minutes * 60 * 1000;
  
  const existing = cards.find(c => c.cardId === cardId);
  if (existing) {
    existing.until = until;
  } else {
    cards.push({ cardId, until });
  }
  
  await set(SNOOZED_CARDS_KEY, cards);
}

export async function isCardSnoozed(cardId: string): Promise<boolean> {
  const cards = await getSnoozedCards();
  return cards.some(c => c.cardId === cardId);
}

// Export all cards as JSON
export async function exportDeck(deckId: string): Promise<{ deck: Deck; cards: Card[] } | null> {
  const deck = await getDeck(deckId);
  if (!deck) return null;
  
  const cards = await getCards(deckId);
  return { deck, cards };
}

// Export all data
export async function exportAllData(): Promise<{
  decks: Deck[];
  cards: Card[];
  settings: Settings;
  stats: Stats;
}> {
  const [decks, cards, settings, stats] = await Promise.all([
    getDecks(),
    getCards(),
    getSettings(),
    getStats(),
  ]);
  
  return { decks, cards, settings, stats };
}

// Import all data
export async function importAllData(data: {
  decks?: Deck[];
  cards?: Card[];
  settings?: Partial<Settings>;
}): Promise<void> {
  if (data.decks) {
    await saveDecks(data.decks);
  }
  if (data.cards) {
    await saveCards(data.cards);
  }
  if (data.settings) {
    await saveSettings(data.settings);
  }
}

// Clear all data
export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
}

