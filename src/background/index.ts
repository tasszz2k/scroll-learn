import type {
  Message,
  Response,
  Card,
  Deck,
  Note,
  NewNote,
  Notebook,
  NewNotebook,
  Settings,
  Stats,
  Grade,
  TranslateLang,
  UpdateInfo,
  ShadowScript,
  IpaProgress,
  IpaStudyStats,
} from '../common/types';
import { createCard, createDeck, createNote, createNotebook } from '../common/types';
import * as storage from '../common/storage';
import { deletePronCheckHistoryFor } from '../common/shadowPronHistory';
import { detectVietnamese, isSingleWord, translate, translateWithDictionary } from '../common/translate';
import { wordFamilyFor } from '../common/wordFamily';
import { sm2Update, sortCardsForReview } from './scheduler';
import {
  ALARM_CHECK_UPDATE,
  checkForUpdate,
  getStoredUpdateInfo,
  handleUpdateAlarm,
  installUpdate,
  setupUpdateAlarm,
} from './updater';

// Alarm names
const ALARM_REFRESH_QUEUE = 'refresh_due_queue';
const ALARM_CLEANUP = 'cleanup_expired';
const ALARM_PRUNE_NOTES = 'prune_notes';

// kokoro-local offscreen document for in-browser Kokoro TTS inference.
const KOKORO_OFFSCREEN_PATH = 'src/offscreen/kokoroOffscreen.html';

interface KokoroLocalSynthRequest {
  type: 'kokoro_local_synth';
  reqId: string;
  text: string;
  voice: string;
}

interface KokoroLocalCloseRequest {
  type: 'kokoro_local_close';
  target: 'background';
}

function isKokoroLocalRequest(msg: unknown): msg is KokoroLocalSynthRequest {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown; target?: unknown };
  // Forwarded copies carry target='offscreen' and must not loop back through
  // the relay; only the original (untargeted) dashboard send is for us.
  return m.type === 'kokoro_local_synth' && m.target !== 'offscreen';
}

function isKokoroLocalCloseRequest(msg: unknown): msg is KokoroLocalCloseRequest {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown; target?: unknown };
  return m.type === 'kokoro_local_close' && m.target === 'background';
}

async function ensureKokoroOffscreen(): Promise<void> {
  // chrome.offscreen.hasDocument was added in Chrome 116; older builds need
  // the legacy try/catch on createDocument. We feature-detect to avoid a
  // confusing "hasDocument is not a function" in 109-115.
  const ns = chrome.offscreen as
    | (typeof chrome.offscreen & { hasDocument?: () => Promise<boolean> })
    | undefined;
  if (!ns || typeof ns.createDocument !== 'function') {
    throw new Error('chrome.offscreen is unavailable. Reload the extension at chrome://extensions.');
  }
  if (typeof ns.hasDocument === 'function') {
    if (await ns.hasDocument()) return;
  }
  try {
    await ns.createDocument({
      url: chrome.runtime.getURL(KOKORO_OFFSCREEN_PATH),
      // WORKERS so we can spawn the ONNX runtime; BLOBS so we can ferry
      // audio Blobs back. Listed in the order Chrome prefers.
      reasons: ['WORKERS' as chrome.offscreen.Reason, 'BLOBS' as chrome.offscreen.Reason],
      justification: 'In-browser Kokoro TTS inference for the Shadow player.',
    });
  } catch (err) {
    // Treat "Only a single offscreen document may be created" as success --
    // a previous create call won the race.
    const message = err instanceof Error ? err.message : String(err);
    if (!/single offscreen document/i.test(message)) {
      throw err;
    }
  }
}

async function closeKokoroOffscreen(): Promise<void> {
  const ns = chrome.offscreen as
    | (typeof chrome.offscreen & { hasDocument?: () => Promise<boolean> })
    | undefined;
  if (!ns || typeof ns.closeDocument !== 'function') return;
  if (typeof ns.hasDocument === 'function') {
    if (!(await ns.hasDocument())) return;
  }
  try {
    await ns.closeDocument();
  } catch {
    /* nothing actionable -- document was already gone */
  }
}

async function handleKokoroLocalRelay(req: KokoroLocalSynthRequest): Promise<unknown> {
  await ensureKokoroOffscreen();
  // Forward to the offscreen document. chrome.runtime.sendMessage with no
  // tab target broadcasts to every extension context except this sender;
  // only the offscreen handler matches target='offscreen' and replies.
  return chrome.runtime.sendMessage({ ...req, target: 'offscreen' });
}

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

  // Run an update check on startup so the badge shows up promptly
  checkForUpdate().catch(err => console.error('[ScrollLearn] Initial update check failed:', err));

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

  // Check for new releases every 6 hours
  setupUpdateAlarm();
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

    case ALARM_CHECK_UPDATE:
      await handleUpdateAlarm();
      break;
  }
}

/**
 * Main message handler
 */
function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: Response<unknown>) => void
): boolean {
  // AI-automation messages are point-to-point between the Gemini content
  // script and the dashboard page. The background has nothing to add here, so
  // bail out without claiming the response channel — that lets the dashboard's
  // listener answer instead.
  if (
    message.type === 'gemini_job_status' ||
    message.type === 'gemini_result' ||
    message.type === 'gemini_stream_chunk'
  ) {
    return false;
  }

  // kokoro-local relay: chrome.runtime can't address a specific document, so
  // the dashboard sends synth requests to the background, we ensure the
  // offscreen exists and forward, and we relay its reply back. Forwarded
  // requests carry target='offscreen' so the offscreen handler matches and
  // the dashboard's other listeners ignore them.
  if (isKokoroLocalRequest(message)) {
    handleKokoroLocalRelay(message)
      .then(sendResponse as (response: unknown) => void)
      .catch((err) => {
        const error = err instanceof Error ? err.message : String(err);
        (sendResponse as (response: unknown) => void)({ ok: false, error });
      });
    return true;
  }
  if (isKokoroLocalCloseRequest(message)) {
    closeKokoroOffscreen()
      .catch((err) => console.warn('[ScrollLearn] failed to close kokoro-local offscreen', err))
      .finally(() => (sendResponse as (response: unknown) => void)({ ok: true }));
    return true;
  }

  // chrome.sidePanel.open() requires the originating user gesture to still be
  // in scope, so we must call it synchronously from this handler — not from
  // the async worker below — and resolve the response immediately.
  if (message.type === 'open_side_panel') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'No sender tab' });
      return false;
    }
    // If the extension was upgraded but not reloaded at chrome://extensions,
    // the new "sidePanel" permission isn't granted yet and the namespace is
    // undefined. Detect this clearly so the content script can tell the user
    // exactly what to do.
    const sp = (chrome as unknown as { sidePanel?: typeof chrome.sidePanel }).sidePanel;
    if (!sp || typeof sp.open !== 'function' || typeof sp.setOptions !== 'function') {
      sendResponse({
        ok: false,
        error: 'Side panel API unavailable. Reload the extension at chrome://extensions (Chrome 116+ required).',
      });
      return false;
    }
    try {
      void sp.setOptions({
        tabId,
        path: 'src/sidebar/sidebar.html',
        enabled: true,
      });
      void sp.open({ tabId });
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  }

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

    case 'get_notebooks':
      return handleGetNotebooks();

    case 'save_notebook':
      return handleSaveNotebook(message.notebook);

    case 'delete_notebook':
      return handleDeleteNotebook(message.notebookId);

    case 'move_notebook_folder':
      return handleMoveNotebookFolder(message.fromPath, message.toPath);

    case 'check_for_update':
      return handleCheckForUpdate();

    case 'get_update_info':
      return handleGetUpdateInfo();

    case 'install_update':
      return installUpdate();

    case 'get_shadow_scripts':
      return handleGetShadowScripts();

    case 'save_shadow_script':
      return handleSaveShadowScript(message.script);

    case 'delete_shadow_script':
      return handleDeleteShadowScript(message.scriptId);

    case 'get_ipa_progress':
      return handleGetIpaProgress();

    case 'set_ipa_progress':
      return handleSetIpaProgress(message.progress);

    case 'get_ipa_stats':
      return handleGetIpaStats();

    case 'set_ipa_stats':
      return handleSetIpaStats(message.stats);

    case 'record_shadow_practice':
      try {
        await storage.recordShadowMs(message.ms);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }

    case 'record_conversation':
      try {
        await storage.recordConversationTurn();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }

    case 'record_pron_check':
      try {
        await storage.recordPronCheckRun(message.averageScore);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error) };
      }

    default:
      return { ok: false, error: 'Unknown message type' };
  }
}

async function handleGetShadowScripts(): Promise<Response<ShadowScript[]>> {
  try {
    const scripts = await storage.getShadowScripts();
    return { ok: true, data: scripts };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleSaveShadowScript(script: ShadowScript): Promise<Response<ShadowScript>> {
  try {
    const saved = await storage.saveShadowScript(script);
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleDeleteShadowScript(scriptId: string): Promise<Response<void>> {
  try {
    await storage.deleteShadowScript(scriptId);
    // History is keyed off the script id, so it has no purpose once the script
    // is gone -- clear it in the same step to keep storage tidy.
    await deletePronCheckHistoryFor(scriptId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleGetIpaProgress(): Promise<Response<IpaProgress>> {
  try {
    const progress = await storage.getIpaProgress();
    return { ok: true, data: progress };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleSetIpaProgress(progress: IpaProgress): Promise<Response<IpaProgress>> {
  try {
    const saved = await storage.saveIpaProgress(progress);
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleGetIpaStats(): Promise<Response<IpaStudyStats>> {
  try {
    const stats = await storage.getIpaStats();
    return { ok: true, data: stats };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleSetIpaStats(stats: IpaStudyStats): Promise<Response<IpaStudyStats>> {
  try {
    const saved = await storage.saveIpaStats(stats);
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleCheckForUpdate(): Promise<Response<UpdateInfo>> {
  try {
    const info = await checkForUpdate();
    return { ok: true, data: info };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleGetUpdateInfo(): Promise<Response<UpdateInfo | null>> {
  try {
    const info = await getStoredUpdateInfo();
    return { ok: true, data: info };
  } catch (error) {
    return { ok: false, error: String(error) };
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

    const decks = await storage.getDecks();
    const deckMap = new Map(decks.map(d => [d.id, d.name]));

    let activeDeckId = settings.activeDeckId;
    if (activeDeckId && !decks.some(deck => deck.id === activeDeckId)) {
      activeDeckId = null;
    }

    // Serve from the active deck directly so its cards aren't shadowed by the
    // global 100-card slice when other decks have many older overdue cards.
    if (activeDeckId) {
      const card = await selectNextDueCard(activeDeckId);
      if (card) {
        console.log('[ScrollLearn Background] Returning card from active deck:', card.front.substring(0, 30));
        return { ok: true, data: card };
      }
    }

    // Active deck is exhausted (or none set): rotate across all due decks.
    const dueCards = await storage.getDueCards(100);
    if (dueCards.length === 0) {
      console.log('[ScrollLearn Background] No due cards');
      return { ok: true, data: null };
    }

    const sorted = sortCardsForReview(dueCards);
    const snoozedFlags = await Promise.all(sorted.map(card => storage.isCardSnoozed(card.id)));
    const availableCards = sorted.filter((_, index) => !snoozedFlags[index]);

    if (availableCards.length === 0) {
      console.log('[ScrollLearn Background] All due cards are snoozed');
      return { ok: true, data: null };
    }

    const availableDeckIds = getAvailableDeckIds(availableCards, decks);
    let selectedDeckId: string | null = null;
    if (availableDeckIds.length > 0) {
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
 * Save a captured selection as a note. When auto-translate is enabled,
 * translate the captured text inline so the translation is persisted on
 * the note and visible immediately in the dashboard.
 */
async function handleSaveNote(noteData: NewNote): Promise<Response<Note>> {
  try {
    const settings = await storage.getSettings();
    let enriched: NewNote = noteData;

    if (settings.noteAutoTranslate) {
      const text = noteData.text.trim();
      if (text) {
        const { from, to } = resolveTranslateDirection(text, settings.noteTranslateDirection);
        if (from !== to) {
          try {
            if (isSingleWord(text)) {
              const { translation, senses } = await translateWithDictionary(text, from, to);
              const trimmed = translation.trim();
              if (trimmed && trimmed.toLowerCase() !== text.toLowerCase()) {
                enriched = { ...noteData, translation: trimmed, translationLang: to };
              }
              if (senses.length > 0) {
                enriched = { ...enriched, senses };
              }
              // Derivational family is English-only by design (rules + dict are en).
              if (from === 'en') {
                const primaryPos = senses[0]?.pos ?? 'other';
                const derivedForms = await wordFamilyFor(text.toLowerCase(), primaryPos);
                if (derivedForms.length > 0) {
                  enriched = { ...enriched, derivedForms };
                }
              }
            } else {
              const translated = (await translate(text, from, to)).trim();
              // Skip if the endpoint returned the same string (means it could not translate)
              if (translated && translated.toLowerCase() !== text.toLowerCase()) {
                enriched = { ...noteData, translation: translated, translationLang: to };
              }
            }
          } catch (err) {
            console.warn('[ScrollLearn] auto-translate failed:', err);
          }
        }
      }
    }

    const note = createNote(enriched);
    const saved = await storage.saveNote(note);
    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function resolveTranslateDirection(
  text: string,
  direction: Settings['noteTranslateDirection'],
): { from: TranslateLang; to: TranslateLang } {
  if (direction === 'en->vi') return { from: 'en', to: 'vi' };
  if (direction === 'vi->en') return { from: 'vi', to: 'en' };
  return detectVietnamese(text)
    ? { from: 'vi', to: 'en' }
    : { from: 'en', to: 'vi' };
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

async function handleGetNotebooks(): Promise<Response<Notebook[]>> {
  try {
    const notebooks = await storage.getNotebooks();
    return { ok: true, data: notebooks };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleSaveNotebook(
  data: NewNotebook | Notebook,
): Promise<Response<Notebook>> {
  try {
    let notebook: Notebook;
    if ('id' in data && data.id) {
      notebook = await storage.saveNotebook(data as Notebook);
    } else {
      notebook = createNotebook(data as NewNotebook);
      notebook = await storage.saveNotebook(notebook);
    }
    return { ok: true, data: notebook };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

// Body and attachment cleanup must happen on the dashboard side because the
// service worker lacks IndexedDB access in MV3. The dashboard removes the
// body + attachments first, then sends 'delete_notebook' for the metadata.
async function handleDeleteNotebook(notebookId: string): Promise<Response<void>> {
  try {
    await storage.deleteNotebook(notebookId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

async function handleMoveNotebookFolder(
  fromPath: string,
  toPath: string,
): Promise<Response<{ moved: number }>> {
  try {
    const moved = await storage.moveNotebookFolder(fromPath, toPath);
    return { ok: true, data: { moved } };
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
