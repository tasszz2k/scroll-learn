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
  backExtra?: string; // Optional rich, reveal-only content (markdown-lite)
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
  high: number;  // >= this for grade 3 (default: 1.0)
  medium: number; // >= this for grade 2 (default: 1.0)
  low: number;   // >= this for grade 1 (default: 1.0)
}

export type TranslateDirection = 'auto' | 'en->vi' | 'vi->en';

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
  allowSkip: boolean; // Default true - allows users to skip cards
  hideFacebookReels: boolean;
  hideFacebookSponsored: boolean;
  hideFacebookSuggested: boolean;
  hideInstagramReels: boolean;
  hideInstagramSponsored: boolean;
  hideInstagramSuggested: boolean;
  hideYouTubeShorts: boolean;
  hideFacebookStrangers: boolean;
  hideInstagramStrangers: boolean;
  // Note capture
  noteCaptureAllowlist: string[];
  noteMinLength: number;
  noteRetentionDays: number;
  noteTranslateDirection: TranslateDirection;
  noteAutoTranslate: boolean;
  noteToastDurationSeconds: number;
  // Speak mode
  autoSpeakAnswer: boolean; // Default true. Auto-pronounce the correct answer on success/retry-success.
  // Hugging Face access token used by the 'kokoro-api' TTS provider to call
  // the hexgrad/Kokoro-TTS Space directly via its Gradio queue API.
  kokoroApiToken: string;
  // ElevenLabs API key used by the 'elevenlabs-api' TTS provider. Free
  // tokens at elevenlabs.io/app/settings/api-keys include the same ~10k
  // monthly credits as the browser-driven path; bypassing the page makes
  // the round-trip a single POST instead of a tab-driven automation.
  elevenLabsApiKey: string;
  // Whether the Shadow player exposes the in-browser 'kokoro-local' engine.
  // Disabled by default because it carries a one-time ~92 MB model download
  // and only WebGPU/WASM-capable browsers run it smoothly. When false, the
  // engine pill is hidden from the player, the per-script readiness column
  // omits the KL badge, and a previously-saved 'kokoro-local' selection
  // falls back to Web Speech.
  enableKokoroLocal: boolean;
  // Free Gemini API key from aistudio.google.com/app/apikey. When set the
  // router prefers a direct REST call over driving gemini.google.com via the
  // content script. Empty string -> always use the browser-driven path.
  geminiApiKey: string;
  // Free-form personal context sent as systemInstruction with every API call
  // (and prepended to the first turn on web fallback). Lets the tutor adapt
  // to the learner's mother tongue, level, goals, and preferred feedback style.
  geminiPersonalContext: string;
  // Default model selection. 'auto' walks the rotation defined by
  // geminiAutoStrategy; an explicit id pins one model and falls through to
  // web on quota exhaustion.
  geminiPreferredModel: GeminiModelChoice;
  // Two walk orders for 'auto'. 'volume' burns the 500-RPD lite pool first
  // (preserves daily capacity); 'quality' spends the flagship 20-RPD pools
  // first for sharper answers, then drops into the lite pool.
  geminiAutoStrategy: GeminiAutoStrategy;
}

// Free-tier Gemini API model picker for Settings -> AI provider. Slugs match
// the IDs accepted by generativelanguage.googleapis.com/v1beta/models/<id>;
// the gemini-3 series is still in preview and carries the '-preview' suffix
// in the API even though Google's docs render the friendly name without it.
// RPM/RPD numbers were read from the user's actual Google AI Studio project
// view (ai.google.dev/gemini-api/docs/rate-limits is the spec, the project
// page applies tier overrides). HAND-CURATED -- do NOT regenerate from a
// model. Wrong slugs strand a learner on the slow web fallback because the
// REST endpoint returns 404 ("models/<id> is not found").
export type GeminiApiModelId =
  | 'gemini-3.1-flash-lite-preview'
  | 'gemini-3-flash-preview'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite';

export type GeminiModelChoice = 'auto' | GeminiApiModelId;
export type GeminiAutoStrategy = 'quality' | 'volume';

// Ordered for the Settings dropdown: 'auto' first, then explicit models sorted
// by RPD descending so the cheapest pool is the obvious explicit pick.
export const GEMINI_API_MODELS: ReadonlyArray<{ id: GeminiApiModelId; label: string; rpd: number }> = [
  { id: 'gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite-preview', rpd: 500 },
  { id: 'gemini-3-flash-preview',        label: 'gemini-3-flash-preview',        rpd: 20 },
  { id: 'gemini-2.5-flash',              label: 'gemini-2.5-flash',              rpd: 20 },
  { id: 'gemini-2.5-flash-lite',         label: 'gemini-2.5-flash-lite',         rpd: 20 },
];

export const DEFAULT_SETTINGS: Settings = {
  showAfterNPosts: 10,
  pauseMinutesAfterQuiz: 0,
  activeDeckId: null,
  eliminateChars: '.,!?()\'"',
  lowercaseNormalization: true,
  domainSettings: {
    'facebook.com': { enabled: true },
    'youtube.com': { enabled: false },
    'instagram.com': { enabled: true },
  },
  fuzzyThresholds: {
    exact: 1.0,
    high: 1.0,
    medium: 1.0,
    low: 1.0,
  },
  enableKeyboardShortcuts: true,
  showKeyboardHints: true,
  allowSkip: false,
  hideFacebookReels: true,
  hideFacebookSponsored: true,
  hideFacebookSuggested: true,
  hideInstagramReels: false,
  hideInstagramSponsored: true,
  hideInstagramSuggested: true,
  hideYouTubeShorts: true,
  hideFacebookStrangers: true,
  hideInstagramStrangers: true,
  noteCaptureAllowlist: ['app.zim.vn'],
  noteMinLength: 2,
  noteRetentionDays: 0,
  noteTranslateDirection: 'auto',
  noteAutoTranslate: true,
  noteToastDurationSeconds: 10,
  autoSpeakAnswer: true,
  kokoroApiToken: '',
  elevenLabsApiKey: '',
  enableKokoroLocal: false,
  geminiApiKey: '',
  geminiPersonalContext: '',
  geminiPreferredModel: 'auto',
  geminiAutoStrategy: 'volume',
};

export type TranslateLang = 'en' | 'vi';

// Re-exported from translate/wordFamily so consumers can import note-shape
// helpers from a single place.
export type { DictionarySense, PartOfSpeech } from './translate';
export type { DerivedForm } from './wordFamily';
import type { DictionarySense } from './translate';
import type { DerivedForm } from './wordFamily';

// Notes feature
export interface Note {
  id: string;
  text: string;
  url: string;
  pageTitle: string;
  domain: string;
  createdAt: number;
  translation?: string;
  translationLang?: TranslateLang;
  // Single-word enrichment. Both fields are only populated when the captured
  // selection is a single word (see isSingleWord). senses lists POS-grouped
  // translations; derivedForms is the morphological family (English source only).
  senses?: DictionarySense[];
  derivedForms?: DerivedForm[];
}

export type NewNote = Omit<Note, 'id' | 'createdAt'>;

// Notebooks feature: manually-authored Obsidian-style markdown documents.
// Metadata lives in chrome.storage.local (so onChanged live-sync stays cheap);
// the markdown body and image attachments live in IndexedDB via notebookStore.
export interface Notebook {
  id: string;
  title: string;
  // '/Demo/Subfolder' style flat path. '' (empty string) means root. Folders
  // are inferred from these strings; there is no separate folder entity.
  folderPath: string;
  tags: string[];
  // Free-form key/value rows shown in the editor's Properties block. Keys are
  // arbitrary strings (e.g. 'type', 'author', 'source'); values are plain
  // strings rendered as YAML front-matter on .md export.
  properties: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export type NewNotebook = Omit<Notebook, 'id' | 'createdAt' | 'updatedAt'>;

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
  // Optional for back-compat with stored payloads written before these fields
  // existed; readers must treat undefined the same as 0.
  practiceMs?: number;          // Sum of responseTimeMs accrued today.
  shadowSec?: number;           // Total shadow-practice seconds.
  conversationCount?: number;   // Sidebar chat turns sent.
  notesAdded?: number;          // Notes captured today (post-dedupe).
  // AI pronunciation check (Shadow tab) -- only saved runs (avg score >=
  // LOW_SCORE_THRESHOLD) are counted, so this measures real attempts.
  pronCheckRuns?: number;       // Count of saved pron-check runs today.
  pronCheckAvgScore?: number;   // Running mean of (pronunciation+naturalness+fluency)/3 across today's runs.
  pronCheckBestScore?: number;  // Highest single-run average score recorded today.
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

export interface OpenSidePanelMessage {
  type: 'open_side_panel';
}

export interface GetNextStudyCardMessage {
  type: 'get_next_study_card';
  deckId?: string;
}

export interface SaveNoteMessage {
  type: 'save_note';
  note: NewNote;
}

export interface GetNotesMessage {
  type: 'get_notes';
}

export interface DeleteNoteMessage {
  type: 'delete_note';
  noteId: string;
}

export interface ClearNotesMessage {
  type: 'clear_notes';
}

// Notebook metadata + body messages. Body and attachment storage stays on the
// dashboard side (IndexedDB) so the body never travels through the message
// channel; the background only owns the metadata list.
export interface GetNotebooksMessage {
  type: 'get_notebooks';
}

export interface SaveNotebookMessage {
  type: 'save_notebook';
  // Either an existing Notebook (update) or a NewNotebook (create).
  notebook: NewNotebook | Notebook;
}

export interface DeleteNotebookMessage {
  type: 'delete_notebook';
  notebookId: string;
}

// Folder rename / drag-move: every notebook whose folderPath starts with
// `fromPath` is rewritten to start with `toPath`. Use empty 'fromPath' to
// move every root-level notebook into a folder.
export interface MoveNotebookFolderMessage {
  type: 'move_notebook_folder';
  fromPath: string;
  toPath: string;
}

export interface CheckForUpdateMessage {
  type: 'check_for_update';
}

export interface GetUpdateInfoMessage {
  type: 'get_update_info';
}

export interface InstallUpdateMessage {
  type: 'install_update';
}

// AI provider automation (Gemini)
export type GeminiJobStage =
  | 'opening'
  | 'attaching'
  | 'pasting'
  | 'submitting'
  | 'streaming'
  | 'extracting'
  | 'done'
  | 'error'
  | 'fallback';

// 'cards' is the legacy note->quiz import flow that pastes a prompt and
// extracts a CSV at the end. 'explain' is the AI-support flow that streams the
// full text response back to the dashboard token-by-token.
export type GeminiJobMode = 'cards' | 'explain';

// Optional file attachment (e.g. an audio recording for pronunciation check).
// The content script decodes this into a File and uploads it before pasting
// the prompt.
export interface GeminiJobAudio {
  base64: string;       // raw base64 (no data: prefix)
  mimeType: string;     // e.g. 'audio/webm'
  filename: string;     // e.g. 'pronunciation-take.webm'
}

export interface GeminiJob {
  jobId: string;
  prompt: string;
  // Optional for back-compat with any older queued job; defaults to 'cards'.
  mode?: GeminiJobMode;
  audio?: GeminiJobAudio;
  createdAt: number;
}

export interface GeminiJobStatusMessage {
  type: 'gemini_job_status';
  jobId: string;
  stage: GeminiJobStage;
  detail?: string;
}

export interface GeminiResultMessage {
  type: 'gemini_result';
  jobId: string;
  ok: boolean;
  csv?: string;
  raw?: string;
  // Final raw text from explain-mode jobs (no CSV extraction performed).
  text?: string;
  error?: string;
}

export interface GeminiStreamChunkMessage {
  type: 'gemini_stream_chunk';
  jobId: string;
  // Full accumulated text snapshot, not a delta. Sending whole snapshots is
  // simpler and idempotent: the renderer just shows the latest.
  text: string;
  done: boolean;
}

// Shadow practice (English shadowing) types

// Job protocol for cloud TTS providers (ElevenLabs, Kokoro). Mirrors the
// Gemini job/result/status pattern but for audio output: the dashboard pushes
// a TTSJob to chrome.storage, the provider's content script picks it up,
// drives the page, and posts back a TTSJobStatus stream + a final TTSJobResult.
export type TTSJobStage =
  | 'opening'        // Window is being created
  | 'navigating'     // Tab is loading the provider page
  | 'configuring'    // Selecting model, voice, etc.
  | 'submitting'     // Pasting text and clicking Generate
  | 'queued'         // Cloud queued the job (Kokoro Space under load)
  | 'capturing'      // Audio is being recorded / fetched
  | 'done'
  | 'error';

export interface TTSJob {
  jobId: string;
  providerId: TTSProviderId;
  voice: string;        // Provider-specific voice id (e.g. 'Rachel' for 11L, 'af_heart' for Kokoro)
  text: string;
  modelHint?: string;   // e.g. 'flash-v2.5' so the script can lock the model
  createdAt: number;
}

export interface TTSJobStatusMessage {
  type: 'tts_job_status';
  jobId: string;
  stage: TTSJobStage;
  detail?: string;
  // Gradio-style queue position when stage === 'queued'.
  queuePosition?: number;
}

export interface TTSJobResultMessage {
  type: 'tts_result';
  jobId: string;
  ok: boolean;
  // Base64-encoded audio bytes, decoded on the dashboard side. Inline rather
  // than a /file URL because the dashboard origin may not have the cookie/CORS
  // grants the provider page does.
  audioBase64?: string;
  mime?: string;        // e.g. 'audio/mpeg' or 'audio/wav'
  // Optional credit count scraped from the page. Dashboard shows it in a pill.
  creditsRemaining?: number;
  error?: string;
}

// Which TTS engine the shadowing player uses to render audio.
//
// - 'web-speech': browser's built-in Web Speech API. Always-on fallback,
//   offline, no quota, voice quality varies by OS.
// - 'elevenlabs-api': calls api.elevenlabs.io directly with a user-supplied
//   API key. Same Flash v2.5 model and ~10k monthly credits as a logged-in
//   browser session, but a single fetch round-trip with no automation.
// - 'kokoro-api': calls the public hexgrad/Kokoro-TTS HuggingFace Space via
//   its Gradio queue API, authenticated with a Hugging Face access token.
//   Free tier shares the Space's daily ZeroGPU quota (~4 GPU-min/day).
// - 'kokoro-local': runs the Kokoro-82M ONNX model 100% in-browser via
//   kokoro-js (Transformers.js + WASM/WebGPU). One-time ~92 MB model
//   download from the HF CDN, then no network. Offscreen-document hosted
//   so the heavy inference doesn't block the dashboard tab and doesn't
//   need a service-worker that supports WASM/WebGPU.
export type TTSProviderId = 'web-speech' | 'elevenlabs-api' | 'kokoro-api' | 'kokoro-local';

export interface ShadowLine {
  speaker: string;            // 'A' | 'B' | 'C' | ...
  text: string;
  glossVi?: string;           // Optional Vietnamese gloss for the line (level <= B1)
  ipaFocus?: string[];        // Phoneme symbols (without slashes) the model flagged for this line
}

export type ShadowLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export interface ShadowScript {
  id: string;
  title: string;
  level: ShadowLevel;
  speakerCount: number;
  durationSec: number;
  rate: number;               // Default playback rate at the time of generation
  targetWords: string[];
  context: string;
  lines: ShadowLine[];
  createdAt: number;
}

// Per-phoneme reception (listening) and production (speaking) accuracy. New
// optional fields default to undefined for entries written before they
// existed; readers must treat undefined the same as 0.
export interface IpaProgressEntry {
  correct: number;            // listening drill correct
  total: number;              // listening drill attempts
  lastSeen: number;           // Unix ms
  productionCorrect?: number; // speaking-tab passes
  productionTotal?: number;   // speaking-tab attempts
  firstSeen?: number;         // Unix ms; set on first ever record
  masteredAt?: number;        // Unix ms; set once when isMastered first flips true
}

export type IpaProgress = Record<string, IpaProgressEntry>;

// Daily-practice calendar for the Foundation header's streak counter. Stored
// as deduped YYYY-MM-DD strings so the streak survives clock-skew across
// devices and the comparison is purely string-based.
export interface IpaStudyStats {
  practiceDates: string[];
}

// AI pronunciation check (Shadow practice). One run per recording.
export interface PronCheckScores {
  pronunciation: number;     // 0-100
  naturalness: number;       // 0-100
  fluency: number;           // 0-100
}

// problemWords carries the IPA tag(s) Gemini flagged for that miss, so
// aggregation can roll up by phoneme as well as by word. Empty phonemes[]
// is allowed (e.g. wrong word entirely, no specific phoneme blame).
//
// Each flag falls into one of two buckets:
//   - 'pronunciation' (confidence 'high'): audio-confirmed phoneme-level error.
//   - 'uncertain_asr_mismatch' (confidence 'low'): the recognizer heard a
//     substitute but the audio didn't clearly show a mispronunciation; common
//     on proper nouns, acronyms, and technical vocab where the browser's ASR
//     fails on its own. These are surfaced to the learner with a softer label
//     and excluded from the practice-plan tallies.
// All bucket fields are optional for back-compat with older stored runs;
// renderers and aggregators default to confidence 'high' / type 'pronunciation'
// when missing.
export type PronCheckConfidence = 'high' | 'low';
export type PronCheckIssueType = 'pronunciation' | 'uncertain_asr_mismatch';

export interface PronCheckProblemWord {
  word: string;
  phonemes: string[];        // IPA symbols without slashes, e.g. ['θ']
  reason?: string;           // optional one-liner
  confidence?: PronCheckConfidence;
  issueType?: PronCheckIssueType;
  asrHeard?: string;         // what the browser recognizer caught here, if applicable
}

export interface PronCheckLineNote {
  idx: number;               // line index in ShadowScript.lines
  said: string;              // what the model heard
  problemWords: PronCheckProblemWord[];
  tip: string;               // short coaching tip
}

export interface PronCheckReport {
  scores: PronCheckScores;
  summary: string;           // markdown-lite paragraph
  lines: PronCheckLineNote[];
}

export interface PronCheckRun {
  id: string;                // generateId()
  createdAt: number;         // Unix ms
  durationSec: number;       // length of the recording
  report: PronCheckReport;
}

// Messages for Shadow + IPA persistence
export interface GetShadowScriptsMessage {
  type: 'get_shadow_scripts';
}
export interface SaveShadowScriptMessage {
  type: 'save_shadow_script';
  script: ShadowScript;
}
export interface DeleteShadowScriptMessage {
  type: 'delete_shadow_script';
  scriptId: string;
}
export interface GetIpaProgressMessage {
  type: 'get_ipa_progress';
}
export interface SetIpaProgressMessage {
  type: 'set_ipa_progress';
  progress: IpaProgress;
}
export interface GetIpaStatsMessage {
  type: 'get_ipa_stats';
}
export interface SetIpaStatsMessage {
  type: 'set_ipa_stats';
  stats: IpaStudyStats;
}

// Practice / engagement counters surfaced in the Statistics tab.
export interface RecordShadowPracticeMessage {
  type: 'record_shadow_practice';
  ms: number;
}

export interface RecordConversationMessage {
  type: 'record_conversation';
}

export interface RecordPronCheckMessage {
  type: 'record_pron_check';
  // Average of the three axis scores (0-100) for the run that was just saved.
  averageScore: number;
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
  | OpenDashboardMessage
  | OpenSidePanelMessage
  | GetNextStudyCardMessage
  | SaveNoteMessage
  | GetNotesMessage
  | DeleteNoteMessage
  | ClearNotesMessage
  | GetNotebooksMessage
  | SaveNotebookMessage
  | DeleteNotebookMessage
  | MoveNotebookFolderMessage
  | CheckForUpdateMessage
  | GetUpdateInfoMessage
  | InstallUpdateMessage
  | GeminiJobStatusMessage
  | GeminiResultMessage
  | GeminiStreamChunkMessage
  | TTSJobStatusMessage
  | TTSJobResultMessage
  | GetShadowScriptsMessage
  | SaveShadowScriptMessage
  | DeleteShadowScriptMessage
  | GetIpaProgressMessage
  | SetIpaProgressMessage
  | GetIpaStatsMessage
  | SetIpaStatsMessage
  | RecordShadowPracticeMessage
  | RecordConversationMessage
  | RecordPronCheckMessage;

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
  backExtra?: string;
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
  NOTES: 'scrolllearn_notes',
  NOTEBOOKS: 'scrolllearn_notebooks',
  // One-shot flag set by the dashboard after the bundled sample
  // notebooks are seeded on first install. Once true we never seed again
  // even if the user empties the Notebooks tab.
  NOTEBOOKS_SEEDED: 'scrolllearn_notebooks_seeded',
  UPDATE_INFO: 'scrolllearn_update_info',
  SHADOW_SCRIPTS: 'scrolllearn_shadow_scripts',
  SHADOW_PRON_HISTORY: 'scrolllearn_shadow_pron_history',
  IPA_PROGRESS: 'scrolllearn_ipa_progress',
  IPA_STATS: 'scrolllearn_ipa_stats',
  NOTEBOOK_VIEW_MODE: 'scrolllearn_notebook_view_mode',
  // Per-model free-tier counters for the Gemini API path. Contents:
  // Record<GeminiApiModelId, { dayBucket, dayCount, minuteBucket, minuteCount, cooldownUntil? }>
  GEMINI_API_USAGE: 'scrolllearn_gemini_api_usage',
} as const;

// Update Info
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  checkedAt: number;
  error?: string;
}

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

// Create new note with defaults
export function createNote(data: NewNote): Note {
  return {
    ...data,
    id: generateId(),
    createdAt: Date.now(),
  };
}

// Create new notebook metadata with defaults. Body lives separately in
// IndexedDB and is empty until the user starts typing.
export function createNotebook(data: NewNotebook): Notebook {
  const now = Date.now();
  return {
    ...data,
    id: generateId(),
    createdAt: now,
    updatedAt: now,
  };
}
