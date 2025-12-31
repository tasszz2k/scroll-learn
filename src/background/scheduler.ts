import type { Card, Grade } from '../common/types';

/**
 * SM-2 Spaced Repetition Algorithm Implementation
 * 
 * Based on the SuperMemo SM-2 algorithm with modifications for simplicity.
 * 
 * Grade meanings:
 * - 0 = Again/Fail: Complete blackout, reset progress
 * - 1 = Hard: Significant difficulty, reduce ease
 * - 2 = Good: Correct with some effort
 * - 3 = Easy: Perfect recall, effortless
 */

// Constants
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const MAX_EASE = 3.5;
const MS_PER_DAY = 86400 * 1000;
const MS_PER_MINUTE = 60 * 1000;

// Relearn intervals for failed cards (in minutes)
const FAIL_INTERVAL_MINUTES = 10; // Show failed cards again after 10 minutes

// Initial intervals for new cards
const INITIAL_INTERVALS: Record<Grade, number> = {
  0: 1,    // 1 day (but repetitions reset)
  1: 1,    // 1 day
  2: 1,    // 1 day (first good review)
  3: 4,    // 4 days (easy on first try)
};

// Second review intervals
const SECOND_INTERVALS: Record<Grade, number> = {
  0: 1,
  1: 3,
  2: 6,
  3: 10,
};

/**
 * Update a card's scheduling based on the review grade
 * Returns a new card object with updated scheduling fields
 */
export function sm2Update(card: Card, grade: Grade): Card {
  const now = Date.now();
  
  // Clone card for immutable update
  const updated: Card = {
    ...card,
    updatedAt: now,
  };
  
  if (grade === 0) {
    // Again/Fail: Reset progress, show again soon (not tomorrow!)
    updated.repetitions = 0;
    updated.intervalDays = 0; // Will be shown again in minutes, not days
    updated.ease = Math.max(MIN_EASE, card.ease - 0.2);
    updated.lapses = card.lapses + 1;
    // Set due to 10 minutes from now instead of tomorrow
    updated.due = now + FAIL_INTERVAL_MINUTES * MS_PER_MINUTE;
    return updated;
  } else {
    // Successful recall
    updated.repetitions = card.repetitions + 1;
    
    // Calculate new interval based on repetition count
    if (card.repetitions === 0) {
      // First review
      updated.intervalDays = INITIAL_INTERVALS[grade];
    } else if (card.repetitions === 1) {
      // Second review
      updated.intervalDays = SECOND_INTERVALS[grade];
    } else {
      // Subsequent reviews: apply SM-2 formula
      const newInterval = calculateInterval(card.intervalDays, card.ease, grade);
      updated.intervalDays = newInterval;
    }
    
    // Update ease factor
    updated.ease = calculateNewEase(card.ease, grade);
  }
  
  // Calculate next due date
  updated.due = now + updated.intervalDays * MS_PER_DAY;
  
  return updated;
}

/**
 * Calculate new interval using SM-2 formula
 */
function calculateInterval(prevInterval: number, ease: number, grade: Grade): number {
  let newInterval: number;
  
  switch (grade) {
    case 1: // Hard
      // Reduce interval growth
      newInterval = Math.round(prevInterval * ease * 0.8);
      break;
    
    case 2: // Good
      // Standard interval growth
      newInterval = Math.round(prevInterval * ease);
      break;
    
    case 3: // Easy
      // Bonus interval growth
      newInterval = Math.round(prevInterval * ease * 1.3);
      break;
    
    default:
      newInterval = 1;
  }
  
  // Ensure minimum of 1 day, maximum of 365 days
  return Math.max(1, Math.min(365, newInterval));
}

/**
 * Calculate new ease factor based on grade
 */
function calculateNewEase(currentEase: number, grade: Grade): number {
  let delta: number;
  
  switch (grade) {
    case 0: // Again
      delta = -0.2;
      break;
    case 1: // Hard
      delta = -0.15;
      break;
    case 2: // Good
      delta = 0;
      break;
    case 3: // Easy
      delta = 0.15;
      break;
    default:
      delta = 0;
  }
  
  const newEase = currentEase + delta;
  
  // Clamp to valid range
  return Math.max(MIN_EASE, Math.min(MAX_EASE, newEase));
}

/**
 * Get scheduling info for a card
 */
export function getSchedulingInfo(card: Card): {
  isDue: boolean;
  daysUntilDue: number;
  dueDateString: string;
  intervalString: string;
  easePercentage: number;
} {
  const now = Date.now();
  const isDue = card.due <= now;
  const daysUntilDue = Math.ceil((card.due - now) / MS_PER_DAY);
  
  // Format due date
  const dueDate = new Date(card.due);
  const dueDateString = dueDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: dueDate.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
  
  // Format interval
  const intervalString = formatInterval(card.intervalDays);
  
  // Convert ease to percentage (2.5 = 250%)
  const easePercentage = Math.round(card.ease * 100);
  
  return {
    isDue,
    daysUntilDue,
    dueDateString,
    intervalString,
    easePercentage,
  };
}

/**
 * Format interval as human-readable string
 */
function formatInterval(days: number): string {
  if (days < 1) {
    return 'Less than a day';
  } else if (days === 1) {
    return '1 day';
  } else if (days < 7) {
    return `${days} days`;
  } else if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? '1 week' : `${weeks} weeks`;
  } else if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? '1 month' : `${months} months`;
  } else {
    const years = Math.round(days / 365);
    return years === 1 ? '1 year' : `${years} years`;
  }
}

/**
 * Preview what the next intervals would be for each grade
 */
export function previewNextIntervals(card: Card): Record<Grade, string> {
  const previews: Record<number, string> = {};
  
  for (const grade of [0, 1, 2, 3] as Grade[]) {
    const updated = sm2Update(card, grade);
    previews[grade] = formatInterval(updated.intervalDays);
  }
  
  return previews as Record<Grade, string>;
}

/**
 * Calculate retention rate based on review history
 */
export function calculateRetentionRate(
  reviews: Array<{ grade: Grade; timestamp: number }>,
  windowDays: number = 30
): number {
  const cutoff = Date.now() - windowDays * MS_PER_DAY;
  const recentReviews = reviews.filter(r => r.timestamp >= cutoff);
  
  if (recentReviews.length === 0) return 0;
  
  const successful = recentReviews.filter(r => r.grade >= 2).length;
  return successful / recentReviews.length;
}

/**
 * Estimate time to review a queue of cards
 */
export function estimateReviewTime(
  cards: Card[],
  avgSecondsPerCard: number = 15
): {
  minutes: number;
  formatted: string;
} {
  const totalSeconds = cards.length * avgSecondsPerCard;
  const minutes = Math.ceil(totalSeconds / 60);
  
  let formatted: string;
  if (minutes < 1) {
    formatted = 'Less than 1 minute';
  } else if (minutes === 1) {
    formatted = '1 minute';
  } else if (minutes < 60) {
    formatted = `${minutes} minutes`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    formatted = hours === 1 
      ? `1 hour ${remainingMinutes > 0 ? `${remainingMinutes} min` : ''}`
      : `${hours} hours ${remainingMinutes > 0 ? `${remainingMinutes} min` : ''}`;
  }
  
  return { minutes, formatted: formatted.trim() };
}

/**
 * Sort cards for optimal review order
 * Priority: overdue > new > learning
 */
export function sortCardsForReview(cards: Card[]): Card[] {
  const now = Date.now();
  
  return [...cards].sort((a, b) => {
    // New cards (never reviewed) come first
    const aIsNew = a.repetitions === 0;
    const bIsNew = b.repetitions === 0;
    if (aIsNew && !bIsNew) return -1;
    if (!aIsNew && bIsNew) return 1;
    
    // Then sort by how overdue they are
    const aOverdue = now - a.due;
    const bOverdue = now - b.due;
    
    return bOverdue - aOverdue; // More overdue first
  });
}

/**
 * Get card difficulty level based on history
 */
export function getCardDifficulty(card: Card): 'easy' | 'medium' | 'hard' {
  // Based on ease and lapse ratio
  const lapseRatio = card.lapses / Math.max(1, card.repetitions);
  
  if (card.ease >= 2.5 && lapseRatio < 0.1) {
    return 'easy';
  } else if (card.ease < 1.8 || lapseRatio > 0.3) {
    return 'hard';
  }
  return 'medium';
}

/**
 * Create initial scheduling for a new card
 */
export function initializeCard(card: Omit<Card, 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses'>): Card {
  return {
    ...card,
    due: Date.now(), // Due immediately
    intervalDays: 0,
    ease: DEFAULT_EASE,
    repetitions: 0,
    lapses: 0,
  } as Card;
}

