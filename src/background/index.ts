import type { Message, Response, Card, Deck, Settings, Stats, Grade } from '../common/types';
import { createCard, createDeck } from '../common/types';
import * as storage from '../common/storage';
import { sm2Update, sortCardsForReview } from './scheduler';

// Alarm names
const ALARM_REFRESH_QUEUE = 'refresh_due_queue';
const ALARM_CLEANUP = 'cleanup_expired';

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
  
  console.log('[ScrollLearn] Background service worker initialized');
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

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

/**
 * Get next due card for a domain
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
    
    // Get all cards first for debugging
    const allCards = await storage.getCards();
    console.log('[ScrollLearn Background] Total cards in storage:', allCards.length);
    
    // Get due cards
    const dueCards = await storage.getDueCards(100);
    console.log('[ScrollLearn Background] Due cards:', dueCards.length);
    
    if (dueCards.length === 0) {
      console.log('[ScrollLearn Background] No due cards. Make sure you have imported cards!');
      return { ok: true, data: null };
    }
    
    // Sort for optimal review order
    const sorted = sortCardsForReview(dueCards);
    
    // Get all decks to lookup deck names
    const decks = await storage.getDecks();
    const deckMap = new Map(decks.map(d => [d.id, d.name]));
    
    // Find first card that isn't snoozed
    for (const card of sorted) {
      if (!(await storage.isCardSnoozed(card.id))) {
        console.log('[ScrollLearn Background] Returning card:', card.front.substring(0, 30));
        // Add deck name to the card
        const deckName = deckMap.get(card.deckId) || card.deckId;
        return { ok: true, data: { ...card, deckName } };
      }
    }
    
    console.log('[ScrollLearn Background] All due cards are snoozed');
    return { ok: true, data: null };
  } catch (error) {
    console.error('[ScrollLearn Background] Error getting next card:', error);
    return { ok: false, error: String(error) };
  }
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
 * Extract domain key from full domain
 * e.g., "www.facebook.com" -> "facebook.com"
 */
function extractDomainKey(domain: string): string {
  return domain.replace(/^(www\.|m\.)/, '');
}

// Initialize on script load
initialize();

