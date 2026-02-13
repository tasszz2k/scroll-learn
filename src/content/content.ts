/**
 * ScrollLearn Content Script
 * 
 * Main content script that:
 * - Detects the current domain
 * - Observes feed changes with MutationObserver
 * - Injects quiz cards after N posts
 * - Manages scroll blocking during quiz
 */

import type { Card, Settings } from '../common/types';
import { DEFAULT_SETTINGS } from '../common/types';
import { facebookDetector, getVisiblePosts, type DomainDetector } from './fb';
import { youtubeDetector, isYouTubeFeedPage, isYouTubeWatchPage } from './youtube';
import { instagramDetector, isInstagramFeedPage } from './instagram';
import { similarity } from '../common/fuzzy';
import { normalizeText } from '../common/parser';

// State
let currentDetector: DomainDetector | null = null;
let settings: Settings = DEFAULT_SETTINGS;
const scrolledPastPostIds: Set<string> = new Set(); // Posts user has scrolled past
let scrolledPastCount = 0; // Simple counter for posts scrolled past
let lastScrollY = 0; // Track scroll position to detect direction
let isQuizActive = false;
let observer: MutationObserver | null = null;
let currentCard: Card | null = null;
let scrollBlockHandler: ((e: Event) => void) | null = null;
let isRetryMode = false;
let shuffledIndices: number[] = []; // Track shuffled option order for current MCQ card

// Session stats
interface SessionStats {
  todayTotal: number;
  todayCorrect: number;
  todayIncorrect: number;
  sessionCorrect: number;
  sessionIncorrect: number;
  currentStreak: number;
}
const sessionStats: SessionStats = {
  todayTotal: 0,
  todayCorrect: 0,
  todayIncorrect: 0,
  sessionCorrect: 0,
  sessionIncorrect: 0,
  currentStreak: 0,
};

// Quiz container ID
const QUIZ_CONTAINER_ID = 'scrolllearn-quiz-root';
const BLOCKER_ID = 'scrolllearn-scroll-blocker';
const DELETE_CONFIRM_ID = 'scrolllearn-delete-confirm';

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('extension context invalidated');
}

/**
 * Initialize content script
 */
async function initialize() {
  console.log('[ScrollLearn] Initializing content script...');
  
  // Detect domain
  currentDetector = detectDomain();
  if (!currentDetector) {
    console.log('[ScrollLearn] No detector for this domain');
    return;
  }
  
  console.log(`[ScrollLearn] Using ${currentDetector.name} detector`);
  
  // Load settings
  await loadSettings();

  // Listen for settings changes and reload
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.settings) {
      console.log('[ScrollLearn] Settings changed, reloading...');
      loadSettings();
    }
  });

  // Check if site is enabled
  const domainKey = getDomainKey();
  const domainSettings = settings.domainSettings[domainKey];
  if (domainSettings && !domainSettings.enabled) {
    console.log('[ScrollLearn] Site is disabled');
    return;
  }
  
  // Start observing
  startObserver();
  
  // Initial check
  checkAndInjectQuiz();
}

/**
 * Detect which domain we're on
 */
function detectDomain(): DomainDetector | null {
  const hostname = window.location.hostname;
  
  if (facebookDetector.domain.test(hostname)) {
    return facebookDetector;
  }
  
  if (youtubeDetector.domain.test(hostname)) {
    // Only activate on feed pages
    if (isYouTubeFeedPage() || isYouTubeWatchPage()) {
      return youtubeDetector;
    }
  }
  
  if (instagramDetector.domain.test(hostname)) {
    // Only activate on feed/explore pages
    if (isInstagramFeedPage()) {
      return instagramDetector;
    }
  }
  
  return null;
}

/**
 * Get domain key for settings
 */
function getDomainKey(): string {
  const hostname = window.location.hostname;
  return hostname.replace(/^(www\.|m\.)/, '');
}

/**
 * Load settings from background
 */
async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_settings' });
    if (response.ok && response.data) {
      settings = response.data;
    }
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return;
    console.error('[ScrollLearn] Failed to load settings:', error);
  }
}

/**
 * Load today's stats from background
 */
async function loadTodayStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get_stats' });
    if (response.ok && response.data) {
      const stats = response.data;
      const today = new Date().toISOString().split('T')[0];
      const todayData = stats.dailyStats?.find((d: { date: string }) => d.date === today);
      if (todayData) {
        sessionStats.todayTotal = todayData.reviews || 0;
        sessionStats.todayCorrect = todayData.correct || 0;
        sessionStats.todayIncorrect = todayData.incorrect || 0;
      }
      sessionStats.currentStreak = stats.currentStreak || 0;
    }
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return;
    console.error('[ScrollLearn] Failed to load stats:', error);
  }
}

/**
 * Start scroll listener to detect when user scrolls past posts
 */
function startObserver() {
  if (!currentDetector) return;
  
  const container = currentDetector.getFeedContainer();
  if (!container) {
    console.log('[ScrollLearn] No feed container found, retrying...');
    setTimeout(startObserver, 1000);
    return;
  }
  
  console.log('[ScrollLearn] Feed container found, starting scroll listener');
  
  // Throttle function - only check every 500ms during scroll
  let lastScrollCheck = 0;
  const throttledCheck = () => {
    const now = Date.now();
    if (now - lastScrollCheck < 500) return;
    lastScrollCheck = now;
    
    if (!isQuizActive) {
      checkAndInjectQuiz();
    }
  };
  
  // Listen for scroll events - this is the primary trigger
  window.addEventListener('scroll', throttledCheck, { passive: true });
  
  // Also use MutationObserver as backup for infinite scroll loading
  // but with much longer debounce to avoid false triggers
  let debounceTimer: number | null = null;
  observer = new MutationObserver(() => {
    if (isQuizActive) return;
    
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      checkAndInjectQuiz();
    }, 1000); // Long debounce - only for catching new posts loaded via infinite scroll
  });
  
  observer.observe(container, {
    childList: true,
    subtree: true,
  });
  
  console.log('[ScrollLearn] Scroll listener and observer started');
}

/**
 * Check if we should inject a quiz and do it
 */
async function checkAndInjectQuiz() {
  if (!currentDetector || isQuizActive) return;
  
  const currentScrollY = window.scrollY;
  const scrollDelta = currentScrollY - lastScrollY;
  
  // Only count when scrolling DOWN
  if (scrollDelta <= 0) {
    lastScrollY = currentScrollY;
    return;
  }
  
  lastScrollY = currentScrollY;
  
  // Get all visible posts
  const posts = getVisiblePosts(currentDetector);
  
  // Count posts that we haven't seen before
  // Simply count any valid post with a unique ID - this works with Facebook's virtual DOM
  let newPostsThisCheck = 0;
  for (const post of posts) {
    const postId = currentDetector.getPostId(post);
    if (!postId) continue;
    
    if (!scrolledPastPostIds.has(postId)) {
      scrolledPastPostIds.add(postId);
      scrolledPastCount++;
      newPostsThisCheck++;
      console.log('[ScrollLearn] New post found:', postId, 'Total:', scrolledPastCount);
    }
  }
  
  if (newPostsThisCheck > 0) {
    console.log('[ScrollLearn] Posts this check:', posts.length, 'New:', newPostsThisCheck, 'Total unique:', scrolledPastCount, 'Target:', settings.showAfterNPosts);
  }
  
  // Check if we should show a quiz
  if (scrolledPastCount >= settings.showAfterNPosts) {
    console.log('[ScrollLearn] Triggering quiz...');
    await showQuiz();
  }
}

/**
 * Show a quiz card
 */
async function showQuiz() {
  if (isQuizActive) return;
  
  // Load today's stats before showing quiz
  await loadTodayStats();
  
  console.log('[ScrollLearn] Requesting card from background...');
  
  // Request next card from background
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'get_next_card_for_domain',
      domain: getDomainKey(),
    });
    
    console.log('[ScrollLearn] Background response:', response);
    
    if (!response.ok || !response.data) {
      console.log('[ScrollLearn] No cards due - make sure you have imported cards in the extension!');
      scrolledPastPostIds.clear(); scrolledPastCount = 0;
      return;
    }
    
    currentCard = response.data as Card;
    isQuizActive = true;
    
    // Reset counter but pre-populate with visible posts so they aren't re-counted after quiz
    scrolledPastCount = 0;
    scrolledPastPostIds.clear();
    if (currentDetector) {
      const visiblePosts = getVisiblePosts(currentDetector);
      for (const post of visiblePosts) {
        const postId = currentDetector.getPostId(post);
        if (postId) {
          scrolledPastPostIds.add(postId);
        }
      }
      console.log('[ScrollLearn] Pre-populated', visiblePosts.length, 'posts, count reset to 0');
    }
    
    console.log('[ScrollLearn] Showing card:', currentCard.front.substring(0, 50));
    
    // Inject quiz UI
    injectQuizUI(currentCard);
    
    // Record start time for response time tracking
    (window as unknown as { ssQuizStartTime: number }).ssQuizStartTime = Date.now();
    
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return;
    console.error('[ScrollLearn] Failed to get card:', error);
  }
}

/**
 * Inject quiz UI into the page
 */
function injectQuizUI(card: Card) {
  // CRITICAL: Save scroll position BEFORE any DOM changes
  const savedScrollY = window.scrollY;
  const savedScrollX = window.scrollX;
  
  // Remove any existing quiz
  removeQuizUI();
  
  // Block scrolling
  enableScrollBlock();
  
  // Create scroll blocker overlay
  const blocker = document.createElement('div');
  blocker.id = BLOCKER_ID;
  blocker.className = 'scrolllearn-scroll-blocker';
  document.body.appendChild(blocker);
  
  // Create quiz container
  const container = document.createElement('div');
  container.id = QUIZ_CONTAINER_ID;
  container.className = 'scrolllearn-quiz-container scrolllearn-quiz-floating';
  
  // Build quiz HTML based on card type
  container.innerHTML = buildQuizHTML(card);
  
  document.body.appendChild(container);
  
  // Add event listeners
  setupQuizEventListeners(card);
  
  // Focus first interactive element (but prevent scroll)
  const firstButton = container.querySelector('button, input');
  if (firstButton instanceof HTMLElement) {
    firstButton.focus({ preventScroll: true });
  }
  
  // CRITICAL: Restore scroll position after all DOM changes
  // Use multiple frames to ensure it sticks on Instagram/SPAs
  window.scrollTo(savedScrollX, savedScrollY);
  requestAnimationFrame(() => {
    window.scrollTo(savedScrollX, savedScrollY);
    setTimeout(() => {
      window.scrollTo(savedScrollX, savedScrollY);
    }, 0);
  });
}

/**
 * Enable scroll blocking
 */
function enableScrollBlock() {
  // Prevent scroll events - this is the most reliable method
  scrollBlockHandler = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  window.addEventListener('wheel', scrollBlockHandler, { passive: false });
  window.addEventListener('touchmove', scrollBlockHandler, { passive: false });
  
  // Only set overflow:hidden for Facebook (not Instagram - it causes scroll reset)
  const isInstagram = window.location.hostname.includes('instagram');
  if (!isInstagram) {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  
  // Prevent keyboard scrolling (but allow typing in inputs)
  document.addEventListener('keydown', preventScrollKeys);
}

/**
 * Disable scroll blocking
 */
function disableScrollBlock() {
  // Remove overflow styles (safe to call even if not set)
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
  
  // Remove event listeners
  if (scrollBlockHandler) {
    window.removeEventListener('wheel', scrollBlockHandler);
    window.removeEventListener('touchmove', scrollBlockHandler);
    scrollBlockHandler = null;
  }
  
  document.removeEventListener('keydown', preventScrollKeys);
}

/**
 * Prevent keyboard keys that cause scrolling
 */
function preventScrollKeys(e: KeyboardEvent) {
  const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
  const target = e.target as HTMLElement;
  
  // Allow if user is typing in an input
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
    return;
  }
  
  if (scrollKeys.includes(e.key)) {
    e.preventDefault();
  }
}

/**
 * Update the stats display with animation after answering
 */
function updateStatsDisplay(grade: 0 | 1 | 2 | 3) {
  const statsContainer = document.querySelector('.scrolllearn-quiz-stats');
  if (!statsContainer) return;
  
  const isCorrect = grade >= 2;
  const scoreChange = isCorrect ? '+1' : '-1';
  const indicatorClass = isCorrect ? 'correct' : 'incorrect';
  
  // Create floating score indicator
  const indicator = document.createElement('div');
  indicator.className = `scrolllearn-quiz-score-indicator ${indicatorClass}`;
  indicator.textContent = scoreChange;
  
  // Position near the score stat
  const scoreStat = statsContainer.querySelector('.scrolllearn-quiz-stat-score');
  if (scoreStat) {
    scoreStat.appendChild(indicator);
    
    // Update the score value
    const scoreValue = scoreStat.querySelector('.scrolllearn-quiz-stat-value');
    if (scoreValue) {
      const sessionScore = sessionStats.sessionCorrect - sessionStats.sessionIncorrect;
      const scoreClass = sessionScore >= 0 ? 'positive' : 'negative';
      scoreValue.textContent = sessionScore >= 0 ? `+${sessionScore}` : `${sessionScore}`;
      scoreStat.classList.remove('positive', 'negative');
      scoreStat.classList.add(scoreClass);
    }
    
    // Remove indicator after animation
    setTimeout(() => indicator.remove(), 1000);
  }
  
  // Update today total
  const todayStat = statsContainer.querySelector('.scrolllearn-quiz-stat:first-child .scrolllearn-quiz-stat-value');
  if (todayStat) {
    todayStat.textContent = String(sessionStats.todayTotal);
  }
  
  // Update accuracy
  const accuracy = sessionStats.todayTotal > 0 
    ? Math.round((sessionStats.todayCorrect / sessionStats.todayTotal) * 100) 
    : 0;
  const accuracyStat = statsContainer.querySelectorAll('.scrolllearn-quiz-stat')[1]?.querySelector('.scrolllearn-quiz-stat-value');
  if (accuracyStat) {
    accuracyStat.textContent = `${accuracy}%`;
  }
}

/**
 * Build stats bar HTML for the quiz
 */
function buildStatsHTML(deckName?: string): string {
  const { todayTotal, todayCorrect, sessionCorrect, sessionIncorrect, currentStreak } = sessionStats;
  
  // Calculate accuracy percentage
  const accuracy = todayTotal > 0 ? Math.round((todayCorrect / todayTotal) * 100) : 0;
  
  // Session score display
  const sessionScore = sessionCorrect - sessionIncorrect;
  const sessionScoreDisplay = sessionScore >= 0 ? `+${sessionScore}` : `${sessionScore}`;
  
  // Inline styles to override Facebook CSS
  const rowStyle = `display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; padding: 0 0 16px 0; margin-bottom: 16px; border-bottom: 1px solid rgba(0,0,0,0.1);`;
  const pillBase = `display: inline-flex; align-items: center; font-size: 12px; font-weight: 500; padding: 6px 14px; border-radius: 100px; cursor: help;`;
  
  const purpleStyle = `${pillBase} background: #f3e8ff; color: #7c3aed;`;
  const blueStyle = `${pillBase} background: #e0f2fe; color: #0369a1;`;
  const greenStyle = `${pillBase} background: #dcfce7; color: #15803d;`;
  const tealStyle = `${pillBase} background: #ccfbf1; color: #0f766e;`;
  const redStyle = `${pillBase} background: #fee2e2; color: #b91c1c;`;
  const orangeStyle = `${pillBase} background: #ffedd5; color: #c2410c;`;
  
  const sessionStyle = sessionScore >= 0 ? tealStyle : redStyle;
  
  // Truncate deck name if too long
  const displayDeck = deckName ? (deckName.length > 20 ? deckName.substring(0, 18) + '...' : deckName) : null;
  
  return `
    <div style="${rowStyle}">
      ${displayDeck ? `<span style="${purpleStyle}" data-tooltip="Current deck: ${escapeHTML(deckName || '')}">${escapeHTML(displayDeck)}</span>` : ''}
      <span style="${blueStyle}" data-tooltip="${todayTotal} questions answered (${todayCorrect} correct)">${todayTotal} today</span>
      <span style="${greenStyle}" data-tooltip="${accuracy}% of answers correct">${accuracy}%</span>
      <span style="${sessionStyle}" data-tooltip="Session: ${sessionCorrect} correct, ${sessionIncorrect} wrong">${sessionScoreDisplay}</span>
      ${currentStreak > 0 ? `<span style="${orangeStyle}" data-tooltip="${currentStreak} day learning streak!">${currentStreak} streak</span>` : ''}
    </div>
  `;
}

/**
 * Build quiz HTML based on card type
 */
function buildQuizHTML(card: Card): string {
  const brandSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`;
  
  let optionsHTML = '';
  let inputHTML = '';
  
  switch (card.kind) {
    case 'mcq-single':
      optionsHTML = buildMCQOptions(card, false);
      break;
    
    case 'mcq-multi':
      optionsHTML = buildMCQOptions(card, true);
      break;
    
    case 'text':
      inputHTML = `
        <div class="scrolllearn-quiz-input-container">
          <input
            type="text"
            class="scrolllearn-quiz-input"
            id="ss-text-input"
            placeholder="Type your answer..."
            autocomplete="off"
            aria-label="Your answer"
          />
        </div>
      `;
      break;
    
    case 'cloze':
      inputHTML = buildClozeHTML(card);
      break;
    
    case 'audio':
      inputHTML = `
        <div class="scrolllearn-quiz-audio">
          <button class="scrolllearn-quiz-audio-btn" id="ss-play-audio" aria-label="Play audio">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <span>Listen and type your answer</span>
        </div>
        <div class="scrolllearn-quiz-input-container">
          <input
            type="text"
            class="scrolllearn-quiz-input"
            id="ss-text-input"
            placeholder="Type what you hear..."
            autocomplete="off"
            aria-label="Your answer"
          />
        </div>
        <audio id="ss-audio-player" src="${card.mediaUrl || ''}" preload="auto"></audio>
      `;
      break;
  }
  
  // Build stats bar with deck name
  const statsHTML = buildStatsHTML(card.deckName || card.deckId);
  
  return `
    <div class="scrolllearn-quiz" role="dialog" aria-modal="true" aria-labelledby="ss-question">
      <div class="scrolllearn-quiz-header">
        <div class="scrolllearn-quiz-brand">
          ${brandSVG}
          <span>ScrollLearn</span>
        </div>
        <span class="scrolllearn-quiz-deck">${card.deckId ? 'Quiz Time' : 'Quick Quiz'}</span>
      </div>
      
      ${statsHTML}
      
      <div class="scrolllearn-quiz-question" id="ss-question">
        ${escapeHTML(card.front)}
      </div>
      
      ${optionsHTML}
      ${inputHTML}
      
      <div class="scrolllearn-quiz-feedback" id="ss-feedback" style="display: none;"></div>
      
      <div class="scrolllearn-quiz-actions" id="ss-actions">
        <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-primary" id="ss-submit">
          Submit Answer
        </button>
      </div>
      
      ${settings.showKeyboardHints ? `
        <div class="scrolllearn-quiz-keyboard-hint">
          ${card.kind.startsWith('mcq') ? 'Press 1-4 to select, Enter to submit' : 'Press Enter to submit'}${settings.allowSkip ? ', Esc to skip' : ''}
        </div>
      ` : ''}

      <div class="scrolllearn-quiz-toolbar">
        ${settings.allowSkip ? `
          <button class="scrolllearn-quiz-toolbar-btn" id="ss-skip" aria-label="Skip this card">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            Skip
          </button>
        ` : ''}
        <button class="scrolllearn-quiz-toolbar-btn" id="ss-edit" aria-label="Edit this card">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          Edit
        </button>
        <button class="scrolllearn-quiz-toolbar-btn scrolllearn-quiz-toolbar-btn-danger" id="ss-delete" aria-label="Delete this card">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          Delete
        </button>
      </div>
    </div>
  `;
}

/**
 * Fisher-Yates shuffle algorithm
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Build MCQ options HTML with shuffled order
 */
function buildMCQOptions(card: Card, isMulti: boolean): string {
  if (!card.options) return '';

  // Create array of indices and shuffle them
  const indices = card.options.map((_, i) => i);
  shuffledIndices = shuffleArray(indices);

  const options = shuffledIndices.map((originalIndex, displayPosition) => {
    const key = displayPosition + 1;
    const option = card.options![originalIndex];
    const indicator = isMulti
      ? '<div class="scrolllearn-quiz-checkbox"></div>'
      : '';

    return `
      <button
        class="scrolllearn-quiz-option"
        data-index="${originalIndex}"
        aria-pressed="false"
        role="${isMulti ? 'checkbox' : 'radio'}"
      >
        <span class="scrolllearn-quiz-option-key">${key}</span>
        <span class="scrolllearn-quiz-option-text">${escapeHTML(option)}</span>
        ${indicator}
      </button>
    `;
  }).join('');

  return `
    <div class="scrolllearn-quiz-options" role="${isMulti ? 'group' : 'radiogroup'}" aria-label="Answer options">
      ${options}
    </div>
  `;
}

/**
 * Parse cloze answers from card.back for display purposes
 * card.back format: "answer1, answer2, answer3"
 */
function parseClozeAnswersFromBack(back: string): string[] {
  // Split by comma and trim each answer
  return back.split(',').map(ans => ans.trim());
}

/**
 * Build cloze (fill-in-the-blank) HTML
 */
function buildClozeHTML(card: Card): string {
  // Replace {{answer}} with input fields
  let blankIndex = 0;
  const html = card.front.replace(/\{\{([^}]+)\}\}/g, () => {
    const inputId = `ss-cloze-${blankIndex}`;
    blankIndex++;
    return `<span class="scrolllearn-quiz-cloze-blank"><input type="text" id="${inputId}" autocomplete="off" /></span>`;
  });
  
  return `
    <div class="scrolllearn-quiz-cloze">
      ${html}
    </div>
  `;
}

/**
 * Setup event listeners for the quiz
 */
function setupQuizEventListeners(card: Card) {
  const container = document.getElementById(QUIZ_CONTAINER_ID);
  if (!container) return;
  
  // MCQ option selection
  const options = container.querySelectorAll('.scrolllearn-quiz-option');
  options.forEach(option => {
    option.addEventListener('click', () => {
      if (option.classList.contains('disabled')) return;
      
      if (card.kind === 'mcq-single') {
        // Single select: deselect others
        options.forEach(o => {
          o.classList.remove('selected');
          o.setAttribute('aria-pressed', 'false');
        });
      }
      
      option.classList.toggle('selected');
      option.setAttribute('aria-pressed', option.classList.contains('selected').toString());
    });
  });
  
  // Submit button
  const submitBtn = document.getElementById('ss-submit');
  submitBtn?.addEventListener('click', () => handleSubmit(card));
  
  // Skip button
  const skipBtn = document.getElementById('ss-skip');
  skipBtn?.addEventListener('click', () => handleSkip(card));

  // Edit button
  const editBtn = document.getElementById('ss-edit');
  editBtn?.addEventListener('click', () => handleEdit(card));

  // Delete button
  const deleteBtn = document.getElementById('ss-delete');
  deleteBtn?.addEventListener('click', () => handleDelete(card));

  // Audio play button
  const playBtn = document.getElementById('ss-play-audio');
  playBtn?.addEventListener('click', () => {
    const audio = document.getElementById('ss-audio-player') as HTMLAudioElement;
    audio?.play();
  });

  // Keyboard shortcuts
  if (settings.enableKeyboardShortcuts) {
    document.addEventListener('keydown', handleKeyDown);
  }

  // Setup tooltips for stats
  setupTooltips(container);
}

/**
 * Setup tooltip listeners for stat elements
 */
function setupTooltips(container: HTMLElement) {
  // Create a persistent tooltip container at the top level
  let tooltipWrapper = document.getElementById('scrolllearn-tooltip-wrapper');
  if (!tooltipWrapper) {
    tooltipWrapper = document.createElement('div');
    tooltipWrapper.id = 'scrolllearn-tooltip-wrapper';
    tooltipWrapper.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
    `;
    document.documentElement.appendChild(tooltipWrapper);
  }
  
  let tooltipEl: HTMLElement | null = null;
  
  const showTooltip = (e: MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    const text = target.getAttribute('data-tooltip');
    if (!text || !tooltipWrapper) return;
    
    // Remove any existing tooltip
    tooltipEl?.remove();
    
    // Create tooltip element with inline styles to avoid CSS conflicts
    tooltipEl = document.createElement('div');
    tooltipEl.style.cssText = `
      position: fixed;
      background: #1e293b;
      color: #ffffff;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 400;
      line-height: 1.4;
      max-width: 250px;
      text-align: center;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: normal;
      word-wrap: break-word;
    `;
    tooltipEl.textContent = text;
    tooltipWrapper.appendChild(tooltipEl);
    
    // Position it above the element
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltipEl.getBoundingClientRect();
    
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.top - tooltipRect.height - 8;
    
    // Keep within viewport
    if (left < 8) left = 8;
    if (left + tooltipRect.width > window.innerWidth - 8) {
      left = window.innerWidth - tooltipRect.width - 8;
    }
    if (top < 8) {
      top = rect.bottom + 8; // Show below if no room above
    }
    
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    
    // Show with animation
    requestAnimationFrame(() => {
      if (tooltipEl) tooltipEl.style.opacity = '1';
    });
  };
  
  const hideTooltip = () => {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  };
  
  // Attach to all elements with data-tooltip
  const statsElements = container.querySelectorAll('[data-tooltip]');
  statsElements.forEach(el => {
    el.addEventListener('mouseenter', showTooltip as EventListener);
    el.addEventListener('mouseleave', hideTooltip);
  });
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyDown(e: KeyboardEvent) {
  if (!isQuizActive || !currentCard) return;
  
  const container = document.getElementById(QUIZ_CONTAINER_ID);
  if (!container) return;

  // Pause quiz shortcuts while a confirmation dialog is open.
  if (document.getElementById(DELETE_CONFIRM_ID)) return;
  
  // Number keys for MCQ
  if (currentCard.kind.startsWith('mcq') && e.key >= '1' && e.key <= '9') {
    const index = parseInt(e.key) - 1;
    const options = container.querySelectorAll('.scrolllearn-quiz-option');
    if (options[index]) {
      (options[index] as HTMLElement).click();
    }
    e.preventDefault();
  }
  
  // Enter to submit (or confirm during retry mode)
  if (e.key === 'Enter' && !e.shiftKey) {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON') {
      if (isRetryMode) {
        handleRetrySubmit(currentCard);
      } else {
        handleSubmit(currentCard);
      }
      e.preventDefault();
    }
  }
  
  // Escape to skip (only if skip is allowed)
  if (e.key === 'Escape' && settings.allowSkip) {
    handleSkip(currentCard);
    e.preventDefault();
  }
}

/**
 * Handle answer submission
 */
async function handleSubmit(card: Card) {
  const container = document.getElementById(QUIZ_CONTAINER_ID);
  if (!container) return;
  
  let userAnswer: string | number | number[];
  
  switch (card.kind) {
    case 'mcq-single': {
      const selected = container.querySelector('.scrolllearn-quiz-option.selected');
      if (!selected) {
        showFeedback('Please select an answer', 'error');
        return;
      }
      userAnswer = parseInt(selected.getAttribute('data-index') || '0');
      break;
    }
    
    case 'mcq-multi': {
      const selected = container.querySelectorAll('.scrolllearn-quiz-option.selected');
      if (selected.length === 0) {
        showFeedback('Please select at least one answer', 'error');
        return;
      }
      userAnswer = Array.from(selected).map(el => parseInt(el.getAttribute('data-index') || '0'));
      break;
    }
    
    case 'text':
    case 'audio': {
      const input = document.getElementById('ss-text-input') as HTMLInputElement;
      if (!input || !input.value.trim()) {
        showFeedback('Please type your answer', 'error');
        return;
      }
      userAnswer = input.value.trim();
      break;
    }
    
    case 'cloze': {
      const inputs = container.querySelectorAll('.scrolllearn-quiz-cloze-blank input');
      const answers: string[] = [];
      inputs.forEach(input => {
        answers.push((input as HTMLInputElement).value.trim());
      });
      if (answers.some(a => !a)) {
        showFeedback('Please fill in all blanks', 'error');
        return;
      }
      userAnswer = answers.join('|'); // Combine for grading
      break;
    }
    
    default:
      return;
  }
  
  // Grade the answer locally (background will also grade)
  const grade = gradeAnswerLocally(card, userAnswer);
  
  // Update session stats
  sessionStats.todayTotal++;
  if (grade >= 2) {
    sessionStats.todayCorrect++;
    sessionStats.sessionCorrect++;
    sessionStats.currentStreak++;
  } else {
    sessionStats.todayIncorrect++;
    sessionStats.sessionIncorrect++;
    sessionStats.currentStreak = 0;
  }
  
  // Update stats display
  updateStatsDisplay(grade);
  
  // Show feedback
  showAnswerFeedback(card, grade);
  
  // Disable further interaction
  disableQuizInteraction();
  
  // Send answer to background
  const startTime = Date.now();
  try {
    await chrome.runtime.sendMessage({
      type: 'card_answered',
      cardId: card.id,
      grade,
      responseTimeMs: startTime - ((window as unknown as { ssQuizStartTime?: number }).ssQuizStartTime ?? startTime) || 5000,
    });
  } catch (error) {
    console.error('[ScrollLearn] Failed to record answer:', error);
  }
  
  // If wrong answer (grade < 2), show retry practice for text/audio/cloze, else next card
  // If correct (grade >= 2), show continue button
  if (grade < 2) {
    if (card.kind === 'text' || card.kind === 'audio' || card.kind === 'cloze') {
      showRetryPractice(card);
    } else {
      showNextCardButton();
    }
  } else {
    showContinueButton();
  }
}

/**
 * Grade answer locally (simplified grading for immediate feedback)
 */
function gradeAnswerLocally(card: Card, userAnswer: string | number | number[]): 0 | 1 | 2 | 3 {
  switch (card.kind) {
    case 'mcq-single':
      return userAnswer === card.correct ? 3 : 0;
    
    case 'mcq-multi': {
      const correct = card.correct as number[];
      const selected = userAnswer as number[];
      const correctSet = new Set(correct);
      
      let matches = 0;
      for (const idx of selected) {
        if (correctSet.has(idx)) matches++;
      }
      
      const score = matches / Math.max(correct.length, selected.length);
      if (score >= 0.9) return 3;
      if (score >= 0.6) return 2;
      if (score >= 0.2) return 1;
      return 0;
    }
    
    case 'text':
    case 'audio': {
      // Normalize both answers using the same logic as grading.ts
      const normalizedInput = normalizeText(
        userAnswer as string,
        settings.eliminateChars,
        settings.lowercaseNormalization
      );

      // Get canonical answer or normalize card.back
      const canonicalAnswers = card.canonicalAnswers || [
        normalizeText(card.back, settings.eliminateChars, settings.lowercaseNormalization)
      ];

      // Check exact match first
      for (const answer of canonicalAnswers) {
        if (normalizedInput === answer) return 3;
      }

      // Find best fuzzy match
      let bestScore = 0;
      for (const answer of canonicalAnswers) {
        const score = calculateSimpleSimilarity(normalizedInput, answer);
        bestScore = Math.max(bestScore, score);
      }

      // Use thresholds from settings
      if (bestScore >= settings.fuzzyThresholds.high) return 3;
      if (bestScore >= settings.fuzzyThresholds.medium) return 2;
      if (bestScore >= settings.fuzzyThresholds.low) return 1;
      return 0;
    }
    
    case 'cloze': {
      const inputs = (userAnswer as string).split('|');
      const expected = card.canonicalAnswers || [];

      let totalScore = 0;
      for (let i = 0; i < expected.length; i++) {
        const normalizedInput = normalizeText(
          inputs[i] || '',
          settings.eliminateChars,
          settings.lowercaseNormalization
        );
        const normalizedExpected = expected[i] || '';

        // Exact match
        if (normalizedInput === normalizedExpected) {
          totalScore += 3;
        } else {
          // Fuzzy match using proper similarity
          const sim = calculateSimpleSimilarity(normalizedInput, normalizedExpected);
          if (sim >= settings.fuzzyThresholds.high) totalScore += 3;
          else if (sim >= settings.fuzzyThresholds.medium) totalScore += 2;
          else if (sim >= settings.fuzzyThresholds.low) totalScore += 1;
        }
      }

      const avgScore = totalScore / expected.length;
      if (avgScore >= 2.5) return 3;
      if (avgScore >= 1.5) return 2;
      if (avgScore >= 0.5) return 1;
      return 0;
    }
    
    default:
      return 0;
  }
}

/**
 * Calculate similarity using proper Levenshtein distance
 * Normalized answers should be passed in (use normalizeText)
 */
function calculateSimpleSimilarity(a: string, b: string): number {
  // Use the proper Levenshtein-based similarity from fuzzy.ts
  return similarity(a, b);
}

/**
 * Show feedback message
 */
function showFeedback(message: string, type: 'success' | 'error' | 'partial') {
  const feedback = document.getElementById('ss-feedback');
  if (!feedback) return;
  
  feedback.textContent = message;
  feedback.className = `scrolllearn-quiz-feedback ${type}`;
  feedback.style.display = 'flex';
}

/**
 * Show answer feedback with correct answer
 */
function showAnswerFeedback(card: Card, grade: 0 | 1 | 2 | 3) {
  const container = document.getElementById(QUIZ_CONTAINER_ID);
  if (!container) return;

  let type: 'success' | 'error' | 'partial';
  let message: string;

  if (grade >= 2) {
    type = 'success';
    message = grade === 3 ? 'Perfect!' : 'Good job!';
    // Always show correct answer for reference, even when correct
    const correctAnswer = getCorrectAnswerDisplay(card);
    message += ` The answer: ${correctAnswer}`;
    showFeedback(message, type);
  } else if (grade === 1) {
    type = 'partial';
    message = 'Almost there...';
    const correctAnswer = getCorrectAnswerDisplay(card);
    message += `. The answer was: ${correctAnswer}`;
    showFeedback(message, type);
  } else {
    type = 'error';
    // For wrong answers on text/audio/cloze, show diff-style feedback
    if (card.kind === 'text' || card.kind === 'audio') {
      const input = document.getElementById('ss-text-input') as HTMLInputElement;
      const userAnswer = input?.value.trim() || '';
      // Use card.back for display (has proper capitalization)
      const correctAnswer = card.back;
      showInitialWrongAnswerDiff(userAnswer, correctAnswer);
    } else if (card.kind === 'cloze') {
      const inputs = document.querySelectorAll('.scrolllearn-quiz-cloze-blank input') as NodeListOf<HTMLInputElement>;
      const userAnswers = Array.from(inputs).map(inp => (inp as HTMLInputElement).value.trim());
      // For cloze, card.back contains the full answer, parse it for blanks
      const expected = parseClozeAnswersFromBack(card.back);
      showInitialWrongAnswerDiff(userAnswers.join(' / '), expected.join(' / '));
    } else {
      // MCQ - use simple message
      message = 'Not quite right';
      const correctAnswer = getCorrectAnswerDisplay(card);
      message += `. The answer was: ${correctAnswer}`;
      showFeedback(message, type);
    }
  }

  // Highlight correct/incorrect options for MCQ
  if (card.kind.startsWith('mcq')) {
    const options = container.querySelectorAll('.scrolllearn-quiz-option');
    options.forEach((option) => {
      const originalIndex = parseInt(option.getAttribute('data-index') || '0');

      if (card.kind === 'mcq-single') {
        if (originalIndex === card.correct) {
          option.classList.add('correct');
        } else if (option.classList.contains('selected')) {
          option.classList.add('incorrect');
        }
      } else {
        const correct = card.correct as number[];
        if (correct.includes(originalIndex)) {
          option.classList.add('correct');
        } else if (option.classList.contains('selected')) {
          option.classList.add('incorrect');
        }
      }
    });
  }
}

/**
 * Show diff-style feedback for initial wrong answer (with reinforcement message)
 */
function showInitialWrongAnswerDiff(userAnswer: string, correctAnswer: string) {
  const feedback = document.getElementById('ss-feedback');
  if (!feedback) return;

  const inlineDiff = generateInlineDiff(userAnswer, correctAnswer);

  const diffHTML = `
    <div style="text-align: left; font-size: 13px; line-height: 1.8;">
      <div style="margin-bottom: 8px; font-weight: 600;">Not quite right — here's the difference:</div>
      <div style="font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace; padding: 8px; background: #f8fafc; border-radius: 6px; word-break: break-word; margin-bottom: 8px;">
        ${inlineDiff}
      </div>
      <div style="font-size: 12px; color: #64748b;">Now try typing the correct answer below ↓</div>
    </div>
  `;

  feedback.innerHTML = diffHTML;
  feedback.className = 'scrolllearn-quiz-feedback error';
  feedback.style.display = 'flex';
}

/**
 * Get correct answer for display
 */
function getCorrectAnswerDisplay(card: Card): string {
  switch (card.kind) {
    case 'mcq-single':
      return card.options?.[card.correct as number] || card.back;
    case 'mcq-multi':
      return (card.correct as number[]).map(i => card.options?.[i]).join(', ') || card.back;
    default:
      return card.back;
  }
}

/**
 * Disable quiz interaction after answering
 */
function disableQuizInteraction() {
  const container = document.getElementById(QUIZ_CONTAINER_ID);
  if (!container) return;
  
  // Disable options
  const options = container.querySelectorAll('.scrolllearn-quiz-option');
  options.forEach(option => {
    option.classList.add('disabled');
  });
  
  // Disable inputs
  const inputs = container.querySelectorAll('input');
  inputs.forEach(input => {
    input.disabled = true;
  });
  
  // Hide submit button
  const submitBtn = document.getElementById('ss-submit');
  if (submitBtn) {
    submitBtn.style.display = 'none';
  }
}

/**
 * Show continue button after answering correctly
 */
function showContinueButton() {
  const actionsContainer = document.getElementById('ss-actions');
  if (!actionsContainer) return;
  
  actionsContainer.innerHTML = `
    <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-primary" id="ss-continue">
      Continue Scrolling
    </button>
  `;
  
  const continueBtn = document.getElementById('ss-continue');
  continueBtn?.addEventListener('click', () => {
    closeQuiz();
    
    // Apply pause if configured
    if (settings.pauseMinutesAfterQuiz > 0) {
      chrome.runtime.sendMessage({
        type: 'pause_site',
        domain: getDomainKey(),
        minutes: settings.pauseMinutesAfterQuiz,
      });
    }
  });
  
  continueBtn?.focus();
}

/**
 * Show next card button after answering incorrectly
 */
function showNextCardButton() {
  const actionsContainer = document.getElementById('ss-actions');
  if (!actionsContainer) return;

  actionsContainer.innerHTML = `
    <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-primary" id="ss-next-card">
      Next Question
    </button>
    ${settings.allowSkip ? `
      <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-secondary" id="ss-skip-continue">
        Skip & Continue
      </button>
    ` : ''}
  `;

  const nextCardBtn = document.getElementById('ss-next-card');
  nextCardBtn?.addEventListener('click', async () => {
    await loadNextCard();
  });
  
  const skipBtn = document.getElementById('ss-skip-continue');
  skipBtn?.addEventListener('click', () => {
    closeQuiz();
  });
  
  nextCardBtn?.focus();
}

/**
 * Show retry practice mode — user must retype the correct answer before proceeding
 */
function showRetryPractice(card: Card) {
  isRetryMode = true;
  const actionsContainer = document.getElementById('ss-actions');
  if (!actionsContainer) return;

  if (card.kind === 'text' || card.kind === 'audio') {
    const input = document.getElementById('ss-text-input') as HTMLInputElement;
    if (input) {
      input.disabled = false;
      input.placeholder = 'Edit your answer or retype the correct answer...';
      input.focus();
      // Select all text so user can easily replace if they want
      input.select();
    }
  } else if (card.kind === 'cloze') {
    const inputs = document.querySelectorAll('.scrolllearn-quiz-cloze-blank input') as NodeListOf<HTMLInputElement>;
    inputs.forEach(input => {
      input.disabled = false;
    });
    inputs[0]?.focus();
    inputs[0]?.select();
  }

  actionsContainer.innerHTML = `
    <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-primary" id="ss-retry-confirm">
      Confirm
    </button>
    ${settings.allowSkip ? `
      <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-secondary" id="ss-retry-skip">
        Skip & Next
      </button>
    ` : ''}
  `;

  document.getElementById('ss-retry-confirm')?.addEventListener('click', () => handleRetrySubmit(card));

  if (settings.allowSkip) {
    document.getElementById('ss-retry-skip')?.addEventListener('click', () => {
      isRetryMode = false;
      showNextCardButton();
    });
  }
}

/**
 * Handle retry practice submission — check if the retyped answer matches
 */
function handleRetrySubmit(card: Card) {
  if (card.kind === 'text' || card.kind === 'audio') {
    const input = document.getElementById('ss-text-input') as HTMLInputElement;
    if (!input || !input.value.trim()) {
      showFeedback('Type the correct answer to continue', 'error');
      return;
    }
    const userInput = input.value.trim().toLowerCase();
    const correct = card.back.toLowerCase();
    if (userInput === correct) {
      isRetryMode = false;
      // Clear the feedback since they got it right this time
      const feedback = document.getElementById('ss-feedback');
      if (feedback) feedback.style.display = 'none';
      showNextCardButton();
    } else {
      input.classList.add('scrolllearn-shake');
      setTimeout(() => input.classList.remove('scrolllearn-shake'), 500);
      // Use card.back for display (has proper capitalization)
      const correctAnswer = card.back;
      const userOriginal = input.value.trim(); // Keep original casing for diff
      showRetryDiff(userOriginal, correctAnswer);
    }
  } else if (card.kind === 'cloze') {
    const inputs = document.querySelectorAll('.scrolllearn-quiz-cloze-blank input') as NodeListOf<HTMLInputElement>;
    const expected = parseClozeAnswersFromBack(card.back);
    let allCorrect = true;

    inputs.forEach((input, i) => {
      const userVal = input.value.trim().toLowerCase();
      const expVal = (expected[i] || '').toLowerCase();
      if (userVal !== expVal) {
        allCorrect = false;
        input.classList.add('scrolllearn-shake');
        setTimeout(() => input.classList.remove('scrolllearn-shake'), 500);
      }
    });

    if (allCorrect) {
      isRetryMode = false;
      // Clear the feedback since they got it right this time
      const feedback = document.getElementById('ss-feedback');
      if (feedback) feedback.style.display = 'none';
      showNextCardButton();
    } else {
      // Show diff for cloze blanks using original answer from card.back
      const userAnswers = Array.from(inputs).map(inp => (inp as HTMLInputElement).value.trim());
      const expectedOriginal = parseClozeAnswersFromBack(card.back);
      showRetryDiff(userAnswers.join(' / '), expectedOriginal.join(' / '));
    }
  }
}

/**
 * Generate inline diff HTML with character-level highlighting
 * Uses case-insensitive comparison but preserves original casing in display
 */
function generateInlineDiff(userAnswer: string, correctAnswer: string): string {
  const userLower = userAnswer.toLowerCase();
  const correctLower = correctAnswer.toLowerCase();

  // Simple diff: find common prefix and suffix (case-insensitive comparison)
  let prefixLen = 0;
  while (prefixLen < userLower.length && prefixLen < correctLower.length &&
         userLower[prefixLen] === correctLower[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (suffixLen < userLower.length - prefixLen &&
         suffixLen < correctLower.length - prefixLen &&
         userLower[userLower.length - 1 - suffixLen] === correctLower[correctLower.length - 1 - suffixLen]) {
    suffixLen++;
  }

  // Use CORRECT answer's casing for prefix/suffix (not user's)
  const prefix = escapeHTML(correctAnswer.substring(0, prefixLen));
  const suffix = escapeHTML(correctAnswer.substring(correctAnswer.length - suffixLen));

  const userMiddle = escapeHTML(userAnswer.substring(prefixLen, userAnswer.length - suffixLen));
  const correctMiddle = escapeHTML(correctAnswer.substring(prefixLen, correctAnswer.length - suffixLen));

  // If completely different, show both on separate lines
  if (prefixLen === 0 && suffixLen === 0) {
    return `
      <div style="margin-bottom: 4px;">
        <span style="color: #dc2626; background: #fee2e2; padding: 2px 4px; border-radius: 3px; text-decoration: line-through;">${escapeHTML(userAnswer)}</span>
      </div>
      <div>
        <span style="color: #16a34a; background: #dcfce7; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${escapeHTML(correctAnswer)}</span>
      </div>
    `;
  }

  // Show inline diff with highlighted changes
  // Empty userMiddle means they only have part of the answer
  if (!userMiddle) {
    return `
      <div>
        ${prefix}<span style="color: #16a34a; background: #dcfce7; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${correctMiddle}</span>${suffix}
      </div>
    `;
  }

  // Both have different middle sections
  return `
    <div>
      ${prefix}<span style="color: #dc2626; background: #fee2e2; padding: 2px 4px; border-radius: 3px; text-decoration: line-through;">${userMiddle}</span><span style="color: #16a34a; background: #dcfce7; padding: 2px 4px; border-radius: 3px; font-weight: 600;">${correctMiddle}</span>${suffix}
    </div>
  `;
}

/**
 * Show a diff-style comparison between user's answer and correct answer
 */
function showRetryDiff(userAnswer: string, correctAnswer: string) {
  const feedback = document.getElementById('ss-feedback');
  if (!feedback) return;

  const inlineDiff = generateInlineDiff(userAnswer, correctAnswer);

  const diffHTML = `
    <div style="text-align: left; font-size: 13px; line-height: 1.8;">
      <div style="margin-bottom: 8px; font-weight: 600;">Not quite — compare:</div>
      <div style="font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace; padding: 8px; background: #f8fafc; border-radius: 6px; word-break: break-word;">
        ${inlineDiff}
      </div>
    </div>
  `;

  feedback.innerHTML = diffHTML;
  feedback.className = 'scrolllearn-quiz-feedback error';
  feedback.style.display = 'flex';
}

/**
 * Load and display the next card
 */
async function loadNextCard() {
  console.log('[ScrollLearn] Loading next card...');
  isRetryMode = false;
  shuffledIndices = [];

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'get_next_card_for_domain',
      domain: getDomainKey(),
    });
    
    if (!response.ok || !response.data) {
      console.log('[ScrollLearn] No more cards available');
      // Show message and allow continuing
      showFeedback('No more cards available. You can continue scrolling!', 'success');
      const actionsContainer = document.getElementById('ss-actions');
      if (actionsContainer) {
        actionsContainer.innerHTML = `
          <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-primary" id="ss-continue">
            Continue Scrolling
          </button>
        `;
        document.getElementById('ss-continue')?.addEventListener('click', () => closeQuiz());
      }
      return;
    }
    
    currentCard = response.data as Card;
    console.log('[ScrollLearn] Showing next card:', currentCard.front.substring(0, 50));
    
    // Update the quiz UI with the new card
    const container = document.getElementById(QUIZ_CONTAINER_ID);
    if (container) {
      container.innerHTML = buildQuizHTML(currentCard);
      setupQuizEventListeners(currentCard);
      
      // Focus first interactive element
      const firstButton = container.querySelector('button, input');
      if (firstButton instanceof HTMLElement) {
        firstButton.focus();
      }
    }
    
    // Record start time for response time tracking
    (window as unknown as { ssQuizStartTime: number }).ssQuizStartTime = Date.now();
    
  } catch (error) {
    console.error('[ScrollLearn] Failed to load next card:', error);
    closeQuiz();
  }
}

/**
 * Handle skip button
 */
async function handleSkip(card: Card) {
  try {
    await chrome.runtime.sendMessage({
      type: 'skip_card',
      cardId: card.id,
      snoozeMinutes: 10,
    });
    closeQuiz();
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return;
    console.error('[ScrollLearn] Failed to skip:', error);
  }
}

/**
 * Handle edit button - opens dashboard to edit the card
 */
async function handleEdit(card: Card) {
  // Store card ID to edit in local storage for dashboard to pick up
  await chrome.storage.local.set({ editCardId: card.id, editDeckId: card.deckId });

  // Open dashboard via background script
  await chrome.runtime.sendMessage({ type: 'open_dashboard' });
  closeQuiz();
}

/**
 * Handle delete button - deletes the card after confirmation
 */
async function handleDelete(card: Card) {
  const confirmed = await showDeleteConfirmationDialog();
  if (!confirmed) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'delete_card',
      cardId: card.id,
    });
    closeQuiz();
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return;
    console.error('[ScrollLearn] Failed to delete:', error);
  }
}

/**
 * Show custom confirmation dialog for destructive card delete action
 */
function showDeleteConfirmationDialog(): Promise<boolean> {
  const container = document.getElementById(QUIZ_CONTAINER_ID);
  if (!container) return Promise.resolve(false);

  document.getElementById(DELETE_CONFIRM_ID)?.remove();

  return new Promise(resolve => {
    const dialog = document.createElement('div');
    dialog.id = DELETE_CONFIRM_ID;
    dialog.className = 'scrolllearn-quiz-container scrolllearn-confirm-backdrop';
    dialog.innerHTML = `
      <div class="scrolllearn-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ss-confirm-title" aria-describedby="ss-confirm-description">
        <h3 class="scrolllearn-confirm-title" id="ss-confirm-title">Delete this card?</h3>
        <p class="scrolllearn-confirm-description" id="ss-confirm-description">This action cannot be undone.</p>
        <div class="scrolllearn-confirm-actions">
          <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-ghost" id="ss-confirm-cancel">Cancel</button>
          <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-danger" id="ss-confirm-delete">Delete</button>
        </div>
      </div>
    `;

    const cancelBtn = dialog.querySelector('#ss-confirm-cancel') as HTMLButtonElement | null;
    const deleteBtn = dialog.querySelector('#ss-confirm-delete') as HTMLButtonElement | null;

    let settled = false;
    const close = (result: boolean) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      dialog.remove();
      resolve(result);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!document.getElementById(DELETE_CONFIRM_ID)) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
        return;
      }

      if (e.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'BUTTON') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
      }
    };

    dialog.addEventListener('click', e => {
      if (e.target === dialog) {
        close(false);
      }
    });
    cancelBtn?.addEventListener('click', () => close(false));
    deleteBtn?.addEventListener('click', () => close(true));

    document.body.appendChild(dialog);
    cancelBtn?.focus();
    document.addEventListener('keydown', onKeyDown, true);
  });
}

/**
 * Close and remove quiz UI
 */
function closeQuiz() {
  removeQuizUI();
  isQuizActive = false;
  isRetryMode = false;
  currentCard = null;
  shuffledIndices = [];
  
  // Remove keyboard listener
  document.removeEventListener('keydown', handleKeyDown);
  
  // IMPORTANT: Pre-populate the set with all currently visible posts
  // This prevents immediately triggering another quiz after closing
  if (currentDetector) {
    const visiblePosts = getVisiblePosts(currentDetector);
    for (const post of visiblePosts) {
      const postId = currentDetector.getPostId(post);
      if (postId && !scrolledPastPostIds.has(postId)) {
        scrolledPastPostIds.add(postId);
        // Don't increment scrolledPastCount - these are "seen" but not "scrolled past"
      }
    }
    console.log('[ScrollLearn] Pre-populated', visiblePosts.length, 'visible posts after quiz close');
  }
}

/**
 * Remove quiz UI elements
 */
function removeQuizUI() {
  // Disable scroll blocking first
  disableScrollBlock();
  
  const confirmDialog = document.getElementById(DELETE_CONFIRM_ID);
  confirmDialog?.remove();

  const container = document.getElementById(QUIZ_CONTAINER_ID);
  container?.remove();
  
  const blocker = document.getElementById(BLOCKER_ID);
  blocker?.remove();
}

/**
 * Escape HTML for safe rendering
 */
function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
