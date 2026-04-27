import type { Message, Response, Card, Deck, Note, NewNote, Settings, Stats, Grade } from '../common/types';
import { createCard, createDeck, createNote } from '../common/types';
import * as storage from '../common/storage';
import { sm2Update, sortCardsForReview } from './scheduler';

// Alarm names
const ALARM_REFRESH_QUEUE = 'refresh_due_queue';
const ALARM_CLEANUP = 'cleanup_expired';
const ALARM_PRUNE_NOTES = 'prune_notes';

/**
 * Initialize background service worker
 */
function initialize() {
  // Set up message listener
  chrome.runtime.onMessage.addListener(handleMessage);

  // Set up alarms for periodic tasks
  setupAlarms();

  // Listen for alarm events
  chrome.alarms.onAlarm.addListener(handleAlarm);

  // Run a prune sweep on startup to catch missed alarm runs
  pruneNotesNow().catch(err => console.error('[ScrollLearn] Initial note prune failed:', err));

  console.log('[ScrollLearn] Background service worker initialized');
}

async function pruneNotesNow(): Promise<void> {
  const settings = await storage.getSettings();
  await storage.pruneNotesOlderThan(settings.noteRetentionDays);
}

/**
 * Set up periodic alarms
 */
function setupAlarms() {
  // Refresh due queue every hour
  chrome.alarms.create(ALARM_REFRESH_QUEUE, {
    periodInMinutes: 60,
  });

  // Cleanup expired pauses/snoozes every 30 minutes
  chrome.alarms.create(ALARM_CLEANUP, {
    periodInMinutes: 30,
  });

  // Prune old notes twice daily
  chrome.alarms.create(ALARM_PRUNE_NOTES, {
    periodInMinutes: 60 * 12,
  });
}

/**
 * Handle alarm events
 */
async function handleAlarm(alarm: chrome.alarms.Alarm) {
  switch (alarm.name) {
    case ALARM_REFRESH_QUEUE:
      // Just trigger a refresh of the due queue
      await storage.getDueCards(100);
      break;
    
    case ALARM_CLEANUP:
      // Cleanup expired pauses and snoozes
      await storage.getPausedSites();
      await storage.getSnoozedCards();
      break;

    case ALARM_PRUNE_NOTES:
      await pruneNotesNow();
      break;
  }
}

/**
 * Main message handler
 */
function handleMessage(
  message: Message,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response: Response<unknown>) => void
): boolean {
  // Handle message asynchronously
  handleMessageAsync(message)
    .then(sendResponse)
    .catch(error => {
      console.error('[ScrollLearn] Message handler error:', error);
      sendResponse({ ok: false, error: String(error) });
    });
  
  // Return true to indicate async response
  return true;
}

/**
 * Async message handler implementation
 */
async function handleMessageAsync(message: Message): Promise<Response<unknown>> {
  switch (message.type) {
    case 'get_next_card_for_domain':
      return handleGetNextCard(message.domain);
    
    case 'card_answered':
      return handleCardAnswered(message.cardId, message.grade, message.responseTimeMs);
    
    case 'batch_import':
      return handleBatchImport(message.cards, message.deckId);
    
    case 'get_settings':
      return handleGetSettings();
    
    case 'set_settings':
      return handleSetSettings(message.settings);
    
    case 'get_decks':
      return handleGetDecks();
    
    case 'save_deck':
      return handleSaveDeck(message.deck);
    
    case 'delete_deck':
      return handleDeleteDeck(message.deckId);
    
    case 'get_cards':
      return handleGetCards(message.deckId);
    
    case 'save_card':
      return handleSaveCard(message.card);
    
    case 'delete_card':
      return handleDeleteCard(message.cardId);
    
    case 'get_stats':
      return handleGetStats();
    
    case 'pause_site':
      return handlePauseSite(message.domain, message.minutes);
    
    case 'disable_site':
      return handleDisableSite(message.domain);
    
    case 'skip_card':
      return handleSkipCard(message.cardId, message.snoozeMinutes);

    case 'open_dashboard':
      return handleOpenDashboard();

    case 'get_next_study_card':
      return handleGetNextStudyCard(message.deckId);

    case 'save_note':
      return handleSaveNote(message.note);

    case 'get_notes':
      return handleGetNotes();

    case 'delete_note':
      return handleDeleteNote(message.noteId);

    case 'clear_notes':
      return handleClearNotes();

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

/**
 * Select the next due card, optionally filtered by deck.
 * Shared logic used by both domain-based and standalone study flows.
 */
async function selectNextDueCard(filterDeckId?: string): Promise<Card | null> {
  // When filtering by deck, fetch that deck's cards directly to avoid the 100-card limit
  // missing cards from the target deck.
  const now = Date.now();
  let dueCards: Card[];
  if (filterDeckId) {
    const deckCards = await storage.getCards(filterDeckId);
    dueCards = deckCards.filter(c => c.due <= now);
  } else {
    dueCards = await storage.getDueCards(100);
  }
  if (dueCards.length === 0) return null;

  const decks = await storage.getDecks();
  const deckMap = new Map(decks.map(d => [d.id, d.name]));

  const sorted = sortCardsForReview(dueCards);
  const snoozedFlags = await Promise.all(sorted.map(card => storage.isCardSnoozed(card.id)));
  const availableCards = sorted.filter((_, index) => !snoozedFlags[index]);

  if (availableCards.length === 0) return null;

  const selectedCard = availableCards[0];
  const deckName = deckMap.get(selectedCard.deckId) || selectedCard.deckId;
  return { ...selectedCard, deckName };
}

/**
 * Get next due card for a domain (content script flow)
 */
async function handleGetNextCard(domain: string): Promise<Response<Card | null>> {
  try {
    console.log('[ScrollLearn Background] Getting next card for domain:', domain);

    // Check if site is paused
    if (await storage.isSitePaused(domain)) {
      console.log('[ScrollLearn Background] Site is paused');
      return { ok: true, data: null };
    }

    // Check if site is disabled in settings
    const settings = await storage.getSettings();
    const domainKey = extractDomainKey(domain);
    const domainSettings = settings.domainSettings[domainKey];

    if (domainSettings && !domainSettings.enabled) {
      console.log('[ScrollLearn Background] Site is disabled');
      return { ok: true, data: null };
    }

    // Get due cards using shared logic with deck rotation
    const dueCards = await storage.getDueCards(100);
    if (dueCards.length === 0) {
      console.log('[ScrollLearn Background] No due cards');
      return { ok: true, data: null };
    }

    const decks = await storage.getDecks();
    const deckMap = new Map(decks.map(d => [d.id, d.name]));

    const sorted = sortCardsForReview(dueCards);
    const snoozedFlags = await Promise.all(sorted.map(card => storage.isCardSnoozed(card.id)));
    const availableCards = sorted.filter((_, index) => !snoozedFlags[index]);

    if (availableCards.length === 0) {
      console.log('[ScrollLearn Background] All due cards are snoozed');
      return { ok: true, data: null };
    }

    // Keep serving the active deck until it has no due cards, then move to next due deck.
    const availableDeckIds = getAvailableDeckIds(availableCards, decks);
    let activeDeckId = settings.activeDeckId;

    if (activeDeckId && !decks.some(deck => deck.id === activeDeckId)) {
      activeDeckId = null;
    }

    let selectedDeckId: string | null = null;
    if (activeDeckId && availableDeckIds.includes(activeDeckId)) {
      selectedDeckId = activeDeckId;
    } else if (availableDeckIds.length > 0) {
      selectedDeckId = activeDeckId
        ? getNextDeckId(activeDeckId, availableDeckIds, decks)
        : availableDeckIds[0];
    }

    if (!selectedDeckId) {
      return { ok: true, data: null };
    }

    if (selectedDeckId !== settings.activeDeckId) {
      await storage.saveSettings({ activeDeckId: selectedDeckId });
    }

    const selectedCard = availableCards.find(card => card.deckId === selectedDeckId) || availableCards[0];
    console.log('[ScrollLearn Background] Returning card:', selectedCard.front.substring(0, 30));
    const deckName = deckMap.get(selectedCard.deckId) || selectedCard.deckId;
    return { ok: true, data: { ...selectedCard, deckName } };
  } catch (error) {
    console.error('[ScrollLearn Background] Error getting next card:', error);
    return { ok: false, error: String(error) };
  }
}

/**
 * Get next due card for standalone study (no domain checks, no deck rotation side effects)
 */
async function handleGetNextStudyCard(deckId?: string): Promise<Response<Card | null>> {
  try {
    const card = await selectNextDueCard(deckId);
    return { ok: true, data: card };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function getAvailableDeckIds(cards: Card[], decks: Deck[]): string[] {
  const cardDeckSet = new Set(cards.map(card => card.deckId));
  const orderedDeckIds = decks.map(deck => deck.id).filter(deckId => cardDeckSet.has(deckId));

  // Keep unknown deck ids (if any) at the end in card-order.
  const seen = new Set(orderedDeckIds);
  for (const card of cards) {
    if (!seen.has(card.deckId)) {
      orderedDeckIds.push(card.deckId);
      seen.add(card.deckId);
    }
  }

  return orderedDeckIds;
}

function getNextDeckId(activeDeckId: string, availableDeckIds: string[], decks: Deck[]): string | null {
  if (availableDeckIds.length === 0) return null;

  const deckOrder = decks.map(deck => deck.id);
  const orderedAvailable = deckOrder.filter(deckId => availableDeckIds.includes(deckId));
  for (const deckId of availableDeckIds) {
    if (!orderedAvailable.includes(deckId)) {
      orderedAvailable.push(deckId);
    }
  }

  const activeIndex = orderedAvailable.indexOf(activeDeckId);
  if (activeIndex === -1) {
    return orderedAvailable[0] || null;
  }

  for (let offset = 1; offset <= orderedAvailable.length; offset++) {
    const nextDeckId = orderedAvailable[(activeIndex + offset) % orderedAvailable.length];
    if (availableDeckIds.includes(nextDeckId)) {
      return nextDeckId;
    }
  }

  return null;
}

/**
 * Handle a card answer
 */
async function handleCardAnswered(
  cardId: string,
  grade: Grade,
  responseTimeMs: number
): Promise<Response<void>> {
  try {
    // Get the card
    const card = await storage.getCard(cardId);
    if (!card) {
      return { ok: false, error: 'Card not found' };
    }
    
    // Update scheduling with SM-2
    const updatedCard = sm2Update(card, grade);
    await storage.saveCard(updatedCard);
    
    // Record the review
    await storage.recordReview({
      cardId,
      deckId: card.deckId,
      timestamp: Date.now(),
      grade,
      responseTimeMs,
    });
    
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Batch import cards
 */
async function handleBatchImport(
  cards: Array<Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'>>,
  deckId: string
): Promise<Response<{ inserted: number }>> {
  try {
    // Create full card objects
    const fullCards = cards.map(cardData => createCard({
      ...cardData,
      deckId,
    }));
    
    // Batch import
    const inserted = await storage.batchImportCards(fullCards);
    
    // Update stats
    const stats = await storage.getStats();
    stats.totalCards = (await storage.getCards()).length;
    await storage.saveStats(stats);
    
    return { ok: true, data: { inserted } };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Get settings
 */
async function handleGetSettings(): Promise<Response<Settings>> {
  try {
    const settings = await storage.getSettings();
    return { ok: true, data: settings };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Update settings
 */
async function handleSetSettings(settings: Partial<Settings>): Promise<Response<Settings>> {
  try {
    const updated = await storage.saveSettings(settings);
    return { ok: true, data: updated };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Get all decks
 */
async function handleGetDecks(): Promise<Response<Deck[]>> {
  try {
    const decks = await storage.getDecks();
    return { ok: true, data: decks };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Save a deck (create or update)
 */
async function handleSaveDeck(
  deckData: Omit<Deck, 'id' | 'createdAt' | 'updatedAt'> | Deck
): Promise<Response<Deck>> {
  try {
    let deck: Deck;
    
    if ('id' in deckData && deckData.id) {
      // Update existing
      deck = await storage.saveDeck(deckData as Deck);
    } else {
      // Create new
      deck = createDeck(deckData as Omit<Deck, 'id' | 'createdAt' | 'updatedAt'>);
      deck = await storage.saveDeck(deck);
    }
    
    return { ok: true, data: deck };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Delete a deck
 */
async function handleDeleteDeck(deckId: string): Promise<Response<void>> {
  try {
    await storage.deleteDeck(deckId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Get cards (optionally filtered by deck)
 */
async function handleGetCards(deckId?: string): Promise<Response<Card[]>> {
  try {
    const cards = await storage.getCards(deckId);
    return { ok: true, data: cards };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Save a card (create or update)
 */
async function handleSaveCard(
  cardData: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card
): Promise<Response<Card>> {
  try {
    let card: Card;
    
    if ('id' in cardData && cardData.id) {
      // Update existing
      card = await storage.saveCard(cardData as Card);
    } else {
      // Create new
      card = createCard(cardData as Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'>);
      card = await storage.saveCard(card);
    }
    
    // Update total cards in stats
    const stats = await storage.getStats();
    stats.totalCards = (await storage.getCards()).length;
    await storage.saveStats(stats);
    
    return { ok: true, data: card };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Delete a card
 */
async function handleDeleteCard(cardId: string): Promise<Response<void>> {
  try {
    await storage.deleteCard(cardId);
    
    // Update total cards in stats
    const stats = await storage.getStats();
    stats.totalCards = (await storage.getCards()).length;
    await storage.saveStats(stats);
    
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Get statistics
 */
async function handleGetStats(): Promise<Response<Stats>> {
  try {
    const stats = await storage.getStats();
    
    // Update total cards count
    stats.totalCards = (await storage.getCards()).length;
    
    return { ok: true, data: stats };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Pause a site for X minutes
 */
async function handlePauseSite(domain: string, minutes: number): Promise<Response<void>> {
  try {
    await storage.pauseSite(domain, minutes);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Disable a site permanently
 */
async function handleDisableSite(domain: string): Promise<Response<void>> {
  try {
    const settings = await storage.getSettings();
    const domainKey = extractDomainKey(domain);
    
    settings.domainSettings[domainKey] = {
      ...settings.domainSettings[domainKey],
      enabled: false,
    };
    
    await storage.saveSettings(settings);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Skip/snooze a card
 */
async function handleSkipCard(cardId: string, snoozeMinutes: number): Promise<Response<void>> {
  try {
    await storage.snoozeCard(cardId, snoozeMinutes);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Open the dashboard in a new tab
 */
async function handleOpenDashboard(): Promise<Response<void>> {
  try {
    const dashboardUrl = chrome.runtime.getURL('index.html');
    await chrome.tabs.create({ url: dashboardUrl });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Save a captured selection as a note
 */
async function handleSaveNote(noteData: NewNote): Promise<Response<Note>> {
  try {
    const note = createNote(noteData);
    const saved = await storage.saveNote(note);
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleGetNotes(): Promise<Response<Note[]>> {
  try {
    const notes = await storage.getNotes();
    return { ok: true, data: notes };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleDeleteNote(noteId: string): Promise<Response<void>> {
  try {
    await storage.deleteNote(noteId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleClearNotes(): Promise<Response<void>> {
  try {
    await storage.clearNotes();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Extract domain key from full domain
 * e.g., "www.facebook.com" -> "facebook.com"
 */
function extractDomainKey(domain: string): string {
  return domain.replace(/^(www\.|m\.)/, '');
}

// Initialize on script load
initialize();
