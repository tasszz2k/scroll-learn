// Card Types
export type CardKind = 'mcq-single' | 'mcq-multi' | 'text' | 'cloze' | 'audio';

export type Grade = 0 | 1 | 2 | 3;

export interface Card {
  id: string;
  deckId: string;
  deckName?: string; // Populated when fetched for quiz
  kind: CardKind;
  front: string;
  back: string;
  options?: string[];
  correct?: number | number[]; // Index(es) for MCQ
  canonicalAnswers?: string[]; // Acceptable text answers
  acceptedRegex?: string; // Optional regex for text matching
  mediaUrl?: string; // Audio URL for audio cards
  tags?: string[];
  
  // SM-2 Scheduling Fields
  due: number; // Unix timestamp in ms
  intervalDays: number;
  ease: number; // Default 2.5
  repetitions: number;
  lapses: number;
  
  // Metadata
  createdAt: number;
  updatedAt: number;
}

export interface Deck {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

// Settings Types
export interface DomainSettings {
  enabled: boolean;
  customSelectors?: string[];
}

export interface FuzzyThresholds {
  exact: number; // Score for exact match (default: grade 3)
  high: number; // >= this for grade 3 (default: 0.95)
  medium: number; // >= this for grade 2 (default: 0.85)
  low: number; // >= this for grade 1 (default: 0.7)
}

export interface Settings {
  showAfterNPosts: number; // Default 5
  pauseMinutesAfterQuiz: number; // Default 0
  activeDeckId: string | null; // Deck currently prioritized for quizzes
  eliminateChars: string; // Default ".,!?()'\"" 
  lowercaseNormalization: boolean; // Default true
  domainSettings: Record<string, DomainSettings>;
  fuzzyThresholds: FuzzyThresholds;
  enableKeyboardShortcuts: boolean; // Default true
  showKeyboardHints: boolean; // Default true
}

export const DEFAULT_SETTINGS: Settings = {
  showAfterNPosts: 5,
  pauseMinutesAfterQuiz: 0,
  activeDeckId: null,
  eliminateChars: '.,!?()\'"',
  lowercaseNormalization: true,
  domainSettings: {
    'facebook.com': { enabled: true },
    'youtube.com': { enabled: true },
    'instagram.com': { enabled: true },
  },
  fuzzyThresholds: {
    exact: 1.0,
    high: 0.95,
    medium: 0.85,
    low: 0.7,
  },
  enableKeyboardShortcuts: true,
  showKeyboardHints: true,
};

// Review Statistics
export interface ReviewRecord {
  cardId: string;
  deckId: string;
  timestamp: number;
  grade: Grade;
  responseTimeMs: number;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  reviews: number;
  correct: number;
  incorrect: number;
  averageEase: number;
}

export interface Stats {
  totalReviews: number;
  totalCards: number;
  averageAccuracy: number;
  currentStreak: number;
  longestStreak: number;
  lastReviewDate: string | null;
  dailyStats: DailyStats[];
  reviewHistory: ReviewRecord[];
}

// Message Types for Chrome Runtime Communication
export interface GetNextCardMessage {
  type: 'get_next_card_for_domain';
  domain: string;
}

export interface CardAnsweredMessage {
  type: 'card_answered';
  cardId: string;
  grade: Grade;
  responseTimeMs: number;
}

export interface BatchImportMessage {
  type: 'batch_import';
  cards: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'>[];
  deckId: string;
}

export interface GetSettingsMessage {
  type: 'get_settings';
}

export interface SetSettingsMessage {
  type: 'set_settings';
  settings: Partial<Settings>;
}

export interface GetDecksMessage {
  type: 'get_decks';
}

export interface SaveDeckMessage {
  type: 'save_deck';
  deck: Omit<Deck, 'id' | 'createdAt' | 'updatedAt'> | Deck;
}

export interface DeleteDeckMessage {
  type: 'delete_deck';
  deckId: string;
}

export interface GetCardsMessage {
  type: 'get_cards';
  deckId?: string;
}

export interface SaveCardMessage {
  type: 'save_card';
  card: Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'> | Card;
}

export interface DeleteCardMessage {
  type: 'delete_card';
  cardId: string;
}

export interface GetStatsMessage {
  type: 'get_stats';
}

export interface PauseSiteMessage {
  type: 'pause_site';
  domain: string;
  minutes: number;
}

export interface DisableSiteMessage {
  type: 'disable_site';
  domain: string;
}

export interface SkipCardMessage {
  type: 'skip_card';
  cardId: string;
  snoozeMinutes: number;
}

export interface OpenDashboardMessage {
  type: 'open_dashboard';
}

export type Message =
  | GetNextCardMessage
  | CardAnsweredMessage
  | BatchImportMessage
  | GetSettingsMessage
  | SetSettingsMessage
  | GetDecksMessage
  | SaveDeckMessage
  | DeleteDeckMessage
  | GetCardsMessage
  | SaveCardMessage
  | DeleteCardMessage
  | GetStatsMessage
  | PauseSiteMessage
  | DisableSiteMessage
  | SkipCardMessage
  | OpenDashboardMessage;

// Response Types
export interface SuccessResponse<T = undefined> {
  ok: true;
  data?: T;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

export type Response<T = undefined> = SuccessResponse<T> | ErrorResponse;

// Import Types
export interface ParsedCard {
  front: string;
  back: string;
  kind: CardKind;
  options?: string[];
  correct?: number | number[];
  canonicalAnswers?: string[];
  mediaUrl?: string;
  tags?: string[];
  deckName?: string;
}

export interface ParseResult {
  cards: ParsedCard[];
  errors: ParseError[];
}

export interface ParseError {
  line: number;
  message: string;
  raw: string;
}

// Utility Types
export type NewCard = Omit<Card, 'id' | 'due' | 'intervalDays' | 'ease' | 'repetitions' | 'lapses' | 'createdAt' | 'updatedAt'>;
export type NewDeck = Omit<Deck, 'id' | 'createdAt' | 'updatedAt'>;

// Storage Keys
export const STORAGE_KEYS = {
  DECKS: 'scrolllearn_decks',
  CARDS: 'scrolllearn_cards',
  SETTINGS: 'scrolllearn_settings',
  STATS: 'scrolllearn_stats',
  REVIEW_HISTORY: 'scrolllearn_review_history',
  PAUSED_SITES: 'scrolllearn_paused_sites',
  DUE_QUEUE: 'scrolllearn_due_queue',
} as const;

// Generate unique ID
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

// Create new card with defaults
export function createCard(data: NewCard): Card {
  const now = Date.now();
  return {
    ...data,
    id: generateId(),
    due: now, // Due immediately
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// Create new deck with defaults
export function createDeck(data: NewDeck): Deck {
  const now = Date.now();
  return {
    ...data,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
}
