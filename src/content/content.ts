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

// State
let currentDetector: DomainDetector | null = null;
let settings: Settings = DEFAULT_SETTINGS;
let scrolledPastPostIds: Set<string> = new Set(); // Posts user has scrolled past
let scrolledPastCount = 0; // Simple counter for posts scrolled past
let lastScrollY = 0; // Track scroll position to detect direction
let isQuizActive = false;
let observer: MutationObserver | null = null;
let currentCard: Card | null = null;
let scrollBlockHandler: ((e: Event) => void) | null = null;

// Session stats
interface SessionStats {
  todayTotal: number;
  todayCorrect: number;
  todayIncorrect: number;
  sessionCorrect: number;
  sessionIncorrect: number;
  currentStreak: number;
}
let sessionStats: SessionStats = {
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
  for (const post of posts) {
    const postId = currentDetector.getPostId(post);
    if (!postId) continue;
    
    if (!scrolledPastPostIds.has(postId)) {
      scrolledPastPostIds.add(postId);
      scrolledPastCount++;
    }
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
    scrolledPastPostIds.clear(); scrolledPastCount = 0; // Reset counter after showing quiz
    
    console.log('[ScrollLearn] Showing card:', currentCard.front.substring(0, 50));
    
    // Inject quiz UI
    injectQuizUI(currentCard);
    
    // Record start time for response time tracking
    (window as unknown as { ssQuizStartTime: number }).ssQuizStartTime = Date.now();
    
  } catch (error) {
    console.error('[ScrollLearn] Failed to get card:', error);
  }
}

/**
 * Inject quiz UI into the page
 */
function injectQuizUI(card: Card) {
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
  
  // Focus first interactive element
  const firstButton = container.querySelector('button, input');
  if (firstButton instanceof HTMLElement) {
    firstButton.focus();
  }
}

/**
 * Enable scroll blocking
 */
function enableScrollBlock() {
  // Simple approach: just prevent scroll events without moving body
  // This preserves scroll position on Facebook's complex layout
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  
  // Prevent scroll events
  scrollBlockHandler = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  window.addEventListener('wheel', scrollBlockHandler, { passive: false });
  window.addEventListener('touchmove', scrollBlockHandler, { passive: false });
  
  // Prevent keyboard scrolling (but allow typing in inputs)
  document.addEventListener('keydown', preventScrollKeys);
}

/**
 * Disable scroll blocking
 */
function disableScrollBlock() {
  // Remove overflow styles
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
          ${card.kind.startsWith('mcq') ? 'Press 1-4 to select, Enter to submit' : 'Press Enter to submit'}
        </div>
      ` : ''}
      
      <div class="scrolllearn-quiz-toolbar">
        <button class="scrolllearn-quiz-toolbar-btn" id="ss-pause" aria-label="Pause for 30 minutes">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          Pause 30m
        </button>
        <button class="scrolllearn-quiz-toolbar-btn" id="ss-skip" aria-label="Skip this card">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          Skip
        </button>
      </div>
    </div>
  `;
}

/**
 * Build MCQ options HTML
 */
function buildMCQOptions(card: Card, isMulti: boolean): string {
  if (!card.options) return '';
  
  const options = card.options.map((option, index) => {
    const key = index + 1;
    const indicator = isMulti 
      ? '<div class="scrolllearn-quiz-checkbox"></div>'
      : '';
    
    return `
      <button 
        class="scrolllearn-quiz-option" 
        data-index="${index}"
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
  
  // Pause button
  const pauseBtn = document.getElementById('ss-pause');
  pauseBtn?.addEventListener('click', () => handlePause());
  
  // Skip button
  const skipBtn = document.getElementById('ss-skip');
  skipBtn?.addEventListener('click', () => handleSkip(card));
  
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
  
  // Number keys for MCQ
  if (currentCard.kind.startsWith('mcq') && e.key >= '1' && e.key <= '9') {
    const index = parseInt(e.key) - 1;
    const options = container.querySelectorAll('.scrolllearn-quiz-option');
    if (options[index]) {
      (options[index] as HTMLElement).click();
    }
    e.preventDefault();
  }
  
  // Enter to submit
  if (e.key === 'Enter' && !e.shiftKey) {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON') {
      handleSubmit(currentCard);
      e.preventDefault();
    }
  }
  
  // Escape to skip
  if (e.key === 'Escape') {
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
  
  // If wrong answer (grade < 2), show next card after a brief delay
  // If correct (grade >= 2), show continue button
  if (grade < 2) {
    showNextCardButton();
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
      const input = (userAnswer as string).toLowerCase().trim();
      const canonical = card.canonicalAnswers?.[0]?.toLowerCase() || card.back.toLowerCase();
      
      if (input === canonical) return 3;
      
      // Simple fuzzy check
      const similarity = calculateSimpleSimilarity(input, canonical);
      if (similarity >= 0.95) return 3;
      if (similarity >= 0.85) return 2;
      if (similarity >= 0.7) return 1;
      return 0;
    }
    
    case 'cloze': {
      const inputs = (userAnswer as string).split('|');
      const expected = card.canonicalAnswers || [];
      
      let totalScore = 0;
      for (let i = 0; i < expected.length; i++) {
        const input = inputs[i]?.toLowerCase() || '';
        const exp = expected[i]?.toLowerCase() || '';
        
        if (input === exp) {
          totalScore += 3;
        } else {
          const sim = calculateSimpleSimilarity(input, exp);
          if (sim >= 0.85) totalScore += 2;
          else if (sim >= 0.7) totalScore += 1;
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
 * Simple similarity calculation for content script
 */
function calculateSimpleSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  // Simple character match ratio
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) {
      matches++;
    }
  }
  
  return matches / longer.length;
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
  } else if (grade === 1) {
    type = 'partial';
    message = 'Almost there...';
  } else {
    type = 'error';
    message = 'Not quite right';
  }
  
  // Add correct answer for wrong answers
  if (grade < 2) {
    const correctAnswer = getCorrectAnswerDisplay(card);
    message += `. The answer was: ${correctAnswer}`;
  }
  
  showFeedback(message, type);
  
  // Highlight correct/incorrect options for MCQ
  if (card.kind.startsWith('mcq')) {
    const options = container.querySelectorAll('.scrolllearn-quiz-option');
    options.forEach((option, index) => {
      if (card.kind === 'mcq-single') {
        if (index === card.correct) {
          option.classList.add('correct');
        } else if (option.classList.contains('selected')) {
          option.classList.add('incorrect');
        }
      } else {
        const correct = card.correct as number[];
        if (correct.includes(index)) {
          option.classList.add('correct');
        } else if (option.classList.contains('selected')) {
          option.classList.add('incorrect');
        }
      }
    });
  }
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
    <button class="scrolllearn-quiz-btn scrolllearn-quiz-btn-secondary" id="ss-skip-continue">
      Skip & Continue
    </button>
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
 * Load and display the next card
 */
async function loadNextCard() {
  console.log('[ScrollLearn] Loading next card...');
  
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
 * Handle pause button
 */
async function handlePause() {
  try {
    await chrome.runtime.sendMessage({
      type: 'pause_site',
      domain: getDomainKey(),
      minutes: 30,
    });
    closeQuiz();
  } catch (error) {
    console.error('[ScrollLearn] Failed to pause:', error);
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
    console.error('[ScrollLearn] Failed to skip:', error);
  }
}

/**
 * Close and remove quiz UI
 */
function closeQuiz() {
  removeQuizUI();
  isQuizActive = false;
  currentCard = null;
  
  // Remove keyboard listener
  document.removeEventListener('keydown', handleKeyDown);
}

/**
 * Remove quiz UI elements
 */
function removeQuizUI() {
  // Disable scroll blocking first
  disableScrollBlock();
  
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

