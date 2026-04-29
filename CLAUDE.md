# ScrollLearn — Project Rules

## Project Overview

ScrollLearn is a Chrome Extension (Manifest V3) that turns social media scrolling into learning time. It injects spaced-repetition flashcard quizzes into social media feeds (Facebook, YouTube, Instagram) after every N posts scrolled.

## Tech Stack

- **Runtime**: Chrome Extensions API (Manifest V3)
- **UI**: React 19 + TypeScript 5.9 (strict mode)
- **Styling**: Tailwind CSS 4
- **Build**: Vite 7 + @crxjs/vite-plugin
- **Testing**: Vitest
- **Linting**: ESLint 9 (flat config) with typescript-eslint, react-hooks, react-refresh

## Commands

- `npm run dev` — Start Vite dev server (port 5173)
- `npm run build` — Type-check then build (`tsc -b && vite build`)
- `npm run test` — Run all tests (`vitest run`)
- `npm run test:watch` — Run tests in watch mode
- `npm run lint` — Run ESLint

## Architecture

### Layer Overview

```
src/
├── background/    # Service worker — message handling, scheduling, alarms
├── content/       # Content scripts — feed detection, quiz injection, scroll tracking
├── dashboard/     # React SPA — deck/card management, import, settings, stats
├── popup/         # Extension popup UI
├── common/        # Shared code — types, storage, parser, grading, fuzzy matching
├── assets/        # Icons and images
└── styles/        # CSS files
```

### Communication Pattern

Content scripts ↔ Background service worker via `chrome.runtime.sendMessage`. All message types are defined as a discriminated union (`Message`) in `src/common/types.ts`. Responses use `Response<T> = SuccessResponse<T> | ErrorResponse`.

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Types | `src/common/types.ts` | All interfaces, message types, factory functions (`createCard`, `createDeck`, `generateId`) |
| Storage | `src/common/storage.ts` | Chrome Storage API wrapper, CRUD for decks/cards/settings/stats; permanent note dedup by normalized text with enrichment merge |
| Scheduler | `src/background/scheduler.ts` | SM-2 spaced repetition algorithm |
| Grading | `src/common/grading.ts` | Answer evaluation per card type |
| Fuzzy | `src/common/fuzzy.ts` | Levenshtein, Damerau-Levenshtein, Jaro-Winkler similarity |
| Parser | `src/common/parser.ts` | Import parsing (Simple, CSV, JSON formats); CSV honors RFC 4180 multi-line quoted cells for `backExtra` |
| Markdown-lite | `src/common/markdown.ts` | Tiny safe parser/renderer for the `backExtra` reveal panel (paragraphs, `* ` bullets, `**bold**`, indented continuation lines) |
| Speak | `src/common/speak.ts` | Web Speech API wrapper; powers `SpeakButton` and the optional auto-pronounce on success |
| Speech Recognition | `src/common/speechRecognition.ts` | `webkitSpeechRecognition` wrapper. `recognizeOnce()` resolves with `{ transcript, confidence }`; rejects with a typed `RecognizeError` (`code: 'permission' | 'no-speech' | 'aborted' | 'unsupported' | 'other'`) so callers can render the right UI. Used by the Foundation Speak tab to grade pronunciation against the target via `combinedSimilarity`. |
| Translate | `src/common/translate.ts` | Public Google translate endpoint; `translateWithDictionary` adds the `dt=bd` block for POS-grouped senses on single-word captures |
| Word Family | `src/common/wordFamily.ts` | Datamuse-backed morphological family lookup for English single-word note captures (rules + API; English source only) |
| Feed detectors | `src/content/fb.ts`, `youtube.ts`, `instagram.ts` | Domain-specific feed post detection |
| Blocker | `src/content/blocker.ts` | Hides Reels/Shorts, Sponsored, Suggested, Strangers content; tracks per-category counts |
| Study Session | `src/dashboard/components/study/` | Standalone study mode — StudySession, QuizCard, AnswerFeedback, RenderBackExtra, SpeakButton, utils |
| Shadow | `src/dashboard/components/shadow/` | English shadowing tab. Foundation: `ipa/phonemes.ts` (44-phoneme curated list), `IpaExplorer`, `IpaDrill`, `IpaProgressHeader`, `PhonemeLab`, `PronunciationCheck`, `phonemeVideos.ts`, `useIpaProgress`. Practice: `ShadowComposer`, `ShadowPlayer`, `ShadowScriptList`, `ShadowGuide`, `ShadowPanel`, `prompts.ts`, `useShadowGen.ts`, `stages.ts`. Routes: `#shadow:foundation` and `#shadow:practice`. Storage keys: `STORAGE_KEYS.SHADOW_SCRIPTS`, `STORAGE_KEYS.IPA_PROGRESS`, `STORAGE_KEYS.IPA_STATS`. The shadowing player drives a four-stage practice loop (Listen → Slow shadow → Full shadow → Blind shadow) defined declaratively in `stages.ts`; both `ShadowGuide` and `ShadowPlayer` consume that array so docs and UI cannot drift. The `phonemes.ts` 44-phoneme list is hand-curated — do NOT regenerate from a model. The `phonemeVideos.ts` BBC Learning English mapping is also hand-curated — wrong IDs silently embed unrelated clips, so empty-by-default is preferred over invented entries. Foundation lab opens on phoneme card click and counts as practice for the streak; Speak tab uses `recognizeOnce` + `combinedSimilarity` (≥0.85 pass / ≥0.6 close / else miss) and only logs the first attempt per target word. Scripts are produced via Gemini's `mode: 'explain'` text branch and parsed by `parseShadowJSON` (strips fences and surrounding chatter). |
| TTS | `src/common/tts/` | Pluggable text-to-speech layer. `index.ts` exposes the `TTSProvider` interface and `TTS_PROVIDERS` registry (ordered: `elevenlabs-api` → `kokoro-api` → `web-speech`). `audioCache.ts` is an IndexedDB-backed Blob cache keyed by `(providerId, voice, text)` with LRU eviction at 100 MB. `playback.ts` plays Blobs through `HTMLAudioElement`. `elevenLabsVoices.ts` and `kokoroVoices.ts` are hand-curated voice catalogs with assignment helpers (round-robin by gender for ElevenLabs; uniform-random distinct-per-cast for Kokoro). `elevenlabsApi.ts` calls `api.elevenlabs.io` directly with a user-supplied API key (Settings → ElevenLabs API key); `kokoroApi.ts` calls the public `hexgrad/Kokoro-TTS` HuggingFace Space via its Gradio queue API with a Hugging Face access token (Settings → Kokoro API token). Both providers cache successful generations so replays are free; both fall back to Web Speech if their pipeline errors so the line still plays. The `kokoro-api` path needs the existing `hexgrad-kokoro-tts.hf.space` host permission already in the manifest. |
| Notebooks (storage) | `src/common/notebookStore.ts` | IndexedDB wrapper for notebook bodies and image attachments. DB `scrolllearn_notebooks_db` with two stores: `bodies` (id -> markdown string) and `attachments` (id -> Blob + metadata). Mirrors the layout of `tts/audioCache.ts`. Exposes body CRUD (`getBody`, `saveBody`, `deleteBody`) and attachment helpers (`putAttachment`, `getAttachment`, `getAttachmentURL` (object URL), `listAttachments`, `deleteAttachment`, `deleteAllForNotebook`). Bodies and attachments live in IDB so they never bloat `chrome.storage.local`; only metadata (id, title, folderPath, tags, properties, timestamps) lives in `STORAGE_KEYS.NOTEBOOKS` so the existing `chrome.storage.onChanged` live-sync still works between dashboard and side panel. |
| Notebooks (search) | `src/common/notebookSearch.ts` | Two ranked-search helpers shared by `Cmd/Ctrl+P` (quick-open over titles + tags) and `Cmd/Ctrl+Shift+F` (full-text scan that loads bodies from `notebookStore` in batches of 50). Both return `NotebookSearchHit[]` ordered by score; full-text additionally returns a snippet around the first match. `scoreNotebookHitsSync` exists for direct unit tests without IDB. |
| Notebooks (export) | `src/common/notebookExport.ts` | Per-notebook `.md` export with YAML front-matter (`title`, `tags`, `created`, `updated`, plus any custom `properties`) and a whole-tree `.zip` writer. The ZIP path uses a tiny in-tree implementation (STORE method, CRC-32 checksum, `Uint8Array` → `ArrayBuffer` for Blob compatibility) so we don't pull in JSZip. Filenames are sanitized and disambiguated when multiple notebooks share the same title. `downloadBlob` triggers the actual browser download. |
| Notebooks (templates) | `src/common/notebookTemplates.ts` | Five learning-focused starter templates (`Blank`, `Daily learning log`, `Concept note`, `Book or article note`, `Lecture or talk note`) with `defaultTitle`, `defaultTags`, `defaultFolderPath`, `properties`, and `body`. `instantiateTemplate` resolves `{{date}}`/`{{datetime}}` placeholders at creation time; `findTemplate` looks up by id. The 5 templates are hand-curated -- do NOT regenerate from a model. |
| Notebooks (UI) | `src/dashboard/components/notebooks/` | Authoring surface: `NotebooksPanel` (root, owns active notebook + view mode + search/AI/template-picker overlays; supports `embedded` compact mode for the side panel where the tree becomes a slide-in overlay and the AI panel becomes a bottom sheet), `FolderTree` (folder/notebook CRUD + drag-and-drop move + per-row context menu), `NotebookEditor` (raw markdown `<textarea>` + toolbar + keyboard shortcuts + slash menu + Edit/Preview/Live toggle; `forwardRef`-exposes `insertAtCursor` so the AI panel can paste back at the user's caret), `NotebookPreview` (renders markdown via `marked` + `DOMPurify`; resolves `attachment://<id>` URLs to blob URLs lazily and revokes them via `revokeAllAttachmentUrls` on teardown), `PropertiesPanel` (tags + custom k/v properties), `SlashMenu` (line-start `/` palette), `SearchBar` (Cmd+P quick-open / Cmd+Shift+F full-text), `TemplatePicker` (modal + 5 starter templates), `NotebookAiPanel` (Summarize / Ask / Generate quiz, reuses `useGeminiAssist` for explain mode and `useGeminiAutomation` for cards mode), `notebookPrompts.ts` (Gemini prompt builders), `editorCommands.ts` (pure markdown transformations and slash-insert helper). The `useNotebookAutosave` hook (in `src/dashboard/hooks/`) debounces body writes to IndexedDB at 800ms and flushes on `visibilitychange`, `pagehide`, and notebook switch. |
| Guide | `src/dashboard/components/Guide.tsx` | Self-documenting walkthrough rendered at `#guide` |

### Path Alias

`@/` maps to `src/` — use `@/common/types` instead of relative paths.

## Card Types

- `text` — Free-form text answer with fuzzy matching. Wrong answers trigger retry practice mode.
- `mcq-single` — Single-choice multiple choice. Options are shuffled each time card is shown.
- `mcq-multi` — Multiple correct answers. Options are shuffled each time card is shown.
- `cloze` — Fill-in-the-blank (`{{answer}}` syntax). Wrong answers trigger retry practice mode.
- `audio` — Audio playback with text response. Wrong answers trigger retry practice mode.

Every card kind also accepts an optional **`backExtra`** field — markdown-lite content (paragraphs, `* ` bullets, `**bold**`, indented continuation lines) shown only after the learner answers, both in the in-feed quiz and in the dashboard study session and card preview.

## SM-2 Algorithm Details

- Grades: 0 (Again), 1 (Hard), 2 (Good), 3 (Easy)
- Ease factor range: 1.3–3.5 (default 2.5)
- Failed cards (grade 0) reschedule to **10 minutes** (not next day)
- Max interval: 365 days

## Coding Conventions

- **TypeScript strict mode** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` are all enabled
- **Immutable updates** — Scheduler and grading return new objects, never mutate inputs
- **Discriminated unions** — Use `type` field for message discrimination (e.g., `message.type === 'get_next_card_for_domain'`)
- **Factory functions** — Use `createCard()` and `createDeck()` from `types.ts` for new entities (they handle ID generation, timestamps, SM-2 defaults)
- **No external dependencies for core logic** — Fuzzy matching, scheduling, parsing are all implemented from scratch
- **Chrome Storage API** — All persistent state lives in `chrome.storage.local` via the storage module. Never access storage directly.
- **Storage keys** — Use `STORAGE_KEYS` constants from `types.ts`

## Testing

- Tests live in `tests/` at the project root
- Test files use `*.test.ts` naming
- Currently covers: parser, SM-2 scheduler, notes storage/dedup, translate dictionary parsing, word-family lookup, updater
- Run a specific test: `npx vitest run tests/parser.test.ts`

## Quiz Interaction Features

### Retry-to-Practice Mode
When users answer text/audio/cloze cards incorrectly (grade < 2):
1. The incorrect grade is recorded to SM-2 (card reschedules to 10 min)
2. Input field is re-enabled with placeholder "Type the correct answer to continue..."
3. User must retype the correct answer (case-insensitive exact match) to proceed
4. Wrong retry attempts show inline diff-style feedback with character-level highlighting
5. Correct retry clears feedback and shows "Next Question" button
6. MCQ cards skip retry mode (selecting correct option isn't meaningful practice)

### Answer Feedback
- **Text/Audio/Cloze wrong answers**: Inline diff showing user's answer (red strikethrough) vs correct answer (green highlight)
- **MCQ wrong answers**: Visual highlighting of correct (green) and incorrect (red) selected options
- **Diff algorithm**: Case-insensitive comparison but displays correct answer's original casing/punctuation

### MCQ Option Shuffling
- Options are shuffled using Fisher-Yates algorithm each time card is shown
- Prevents memorizing option positions instead of actual content
- `data-index` attribute preserves original index for grading
- Display keys (1, 2, 3, 4) remain sequential

## Content Blocker

The blocker (`src/content/blocker.ts`) hides unwanted content using three detection layers:

1. **CSS injection** -- Immediate, flicker-free hiding for elements with stable selectors (e.g., `div[data-pagelet*="Reels"]`).
2. **MutationObserver** -- Scans newly added DOM nodes for text-based markers (Sponsored, Suggested) and navigation elements.
3. **Periodic scan** (every 2s) -- Re-scans unhidden elements to catch late attribute changes from Facebook's React reconciliation.

### Facebook Reels Navigation Hiding
Facebook renders the Reels button differently across surfaces:
- **Mobile tab bar**: `<a aria-label="Reels" href="/reel/?s=tab">` -- detected by aria-label + href
- **Desktop top bar**: `<a aria-label="Reels">` with SVG icon -- detected by aria-label
- **Desktop sidebar**: Plain `<div>` elements with text "Reels" and no `<a>` wrapper -- detected by walking up from the text `<span>` to the first ancestor containing an icon (`<i>`, `<svg>`, `<img>`) in a sibling branch

### Blocked Count Tracking
`hideElement(el, category)` accepts a `BlockCategory` (`reels` | `shorts` | `sponsored` | `suggested` | `strangers` | `other`). Counts are stored in a `BlockedCounts` record. The popup queries both `getBlockedCount()` (total) and `getBlockedCounts()` (per-category) via `get_blocked_count` message, and shows a hover tooltip on the badge with a per-category breakdown.

### Facebook Sponsored Detection
Facebook obfuscates "Sponsored" using character-level `<span>` elements with CSS reordering and decoy characters. Detection uses: `data-ad-rendering-role` attributes, `aria-labelledby` references, `getBoundingClientRect`-based visible text reconstruction, and plain text fallback.

## Common Gotchas

- Extension context can be invalidated on reload — content scripts handle `chrome.runtime` errors gracefully
- Batch imports chunk at 100 cards per batch to avoid Chrome Storage limits
- Feed detectors use MutationObserver for dynamic content — be careful with selector changes on social media sites
- The `due` field on cards is a Unix timestamp in milliseconds (not seconds)
- Retry practice uses exact match (no fuzzy matching) — users must type answer exactly right
- Shuffled MCQ indices are stored in module-level `shuffledIndices` array, reset on card change
- Dashboard `loadData(showLoading)` accepts a boolean — pass `false` when refreshing from study session to avoid unmounting components and losing local state (streak, stats)
- Dashboard uses hash-based routing (`#study`, `#shadow`, `#shadow:foundation`, `#shadow:practice`, `#decks`, `#notebooks`, `#notes`, `#import`, `#settings`, `#stats`, `#guide`) — the popup links to these hashes directly. Hashes prefixed with `#shadow` all resolve to the Shadow tab; `ShadowPanel` reads the suffix internally to pick the Foundation or Practice section
- Dashboard subscribes to `chrome.storage.onChanged` and `visibilitychange` to silently re-fetch notes/cards/decks/stats/settings when the background updates them; use this pattern instead of polling
- Note dedup is permanent and case/whitespace-insensitive (see `normalizeNoteText` in `storage.ts`). Re-saving the same text returns the original note and merges in any new enrichment (`translation`, `senses`, `derivedForms`) the original lacked
- `backExtra` is markdown-lite only (no nested formatting, no links, no images). The renderer escapes HTML before applying markup so user content cannot inject markup. CSV imports must wrap multi-line `backExtra` in double quotes and double internal `"`s — the parser honors RFC 4180 quoted-newline cells
- **Notebooks vs. Bookmarks**: the existing "Notes" tab (storage key `scrolllearn_notes`, hash `#notes`, internal id `'notes'`) was renamed to **"Bookmarks"** in the UI only; storage key, hash, and id are intentionally unchanged so no migration runs. The new **"Notebooks"** tab (`STORAGE_KEYS.NOTEBOOKS = scrolllearn_notebooks`, hash `#notebooks`) is a separate authoring surface for long-form markdown documents. Bookmarks is a web-capture buffer; Notebooks is for manual writing.
- **Notebook storage split**: only metadata (id, title, folderPath, tags, properties, timestamps) lives in `chrome.storage.local` (so the existing `chrome.storage.onChanged` live-sync between dashboard and side panel still works without sending multi-MB markdown payloads on every keystroke). The body and image attachments live in IndexedDB via `src/common/notebookStore.ts`; never put bodies into `chrome.storage`. Body autosave debounces at 800ms and flushes on `visibilitychange` and notebook switch; metadata writes (title, tags, folderPath, properties) save immediately so the FolderTree updates without delay.
- **Notebook markdown rendering exception**: `src/common/markdown.ts` (markdown-lite) is intentionally narrow and shared with the in-feed quiz path — do **not** extend it. The Notebooks preview is the only surface in the codebase that uses `marked` + `DOMPurify`, scoped exclusively to `NotebookPreview.tsx`. The DOMPurify hook rewrites `attachment://<id>` image sources to a `data-attachment-id` sentinel that the React effect later resolves to a real blob URL; external `http(s)` anchors get `target="_blank" rel="noopener noreferrer"` automatically.
- **Notebook sidebar compact mode**: `<NotebooksPanel embedded />` adapts the dashboard's three-pane layout to the ~360px side panel. The folder tree is hidden behind a hamburger that opens it as a full-overlay drawer (tapping a notebook closes the drawer), the AI panel renders as a bottom sheet rather than a third column, and the editor takes the full width. Storage and live-sync are identical to the dashboard.
- **Notebook AI panel**: reuses the existing Gemini DOM-automation plumbing (no API key). Summarize and Ask call `useGeminiAssist` with `mode: 'explain'` and a per-notebook `contextKey = 'notebook:<id>'`; Generate quiz calls `useGeminiAutomation` with `mode: 'cards'`, which routes the resulting CSV through the existing `pendingImport` chain straight into the Import tab.
- Single-word note enrichment uses two public APIs at save time: Google Translate (`dt=bd` block) for POS-grouped senses, and Datamuse for the morphological family (English source only). Both have ~2-3s timeouts so a slow network never blocks a save
- The `selectNextDueCard(filterDeckId?)` helper in background is shared between domain-based and standalone study flows. When filtering by deck, it fetches deck-specific cards directly (not from the global 100-card limit) to avoid missing cards
- **Content script CSS**: `public/content.css` is used for content script styles (copied to `dist/` during build). The `src/styles/` directory is for dashboard/popup styles only
- Facebook sidebar nav items are plain `<div>` elements (not `<a>` links) -- href-based selectors don't work for the sidebar Reels button. Use text-based detection with DOM walk-up instead.
- Facebook dynamically re-renders navigation bars via React -- CSS-only hiding is insufficient for nav elements. Always pair CSS with observer + periodic scan.
- IPA mastery rule (`isMastered` in `useIpaProgress.ts`): listening side requires ≥10 attempts at ≥80% accuracy. Production is opt-in — once `productionTotal > 0`, the rule additionally requires ≥5 production attempts at ≥60%. `masteredAt` is set once on the flip and never cleared; `firstSeen` is set once on the very first record. The `IPA_PROGRESS` schema is back-compat — old entries lack the production fields, treat undefined as 0.
- IPA streak (`computeStreakDays`) is computed from `IpaStudyStats.practiceDates` (deduped local-clock `YYYY-MM-DD`) and counts consecutive days ending at "today or yesterday" — a learner who practiced yesterday but hasn't opened the app today still has their streak intact. Capped at 365 entries.
- The Foundation Watch tab uses the **"lite-youtube-embed" pattern** (clickable thumbnail → `youtube.com/watch?v=...` in a new tab), NOT a YouTube iframe. The chrome-extension:// origin triggers YouTube Error 153 ("Video player configuration error") on every embed host (`youtube.com`, `youtube-nocookie.com`) regardless of `referrerpolicy` — the player rejects the extension scheme. Thumbnails come from `i.ytimg.com/vi/{id}/hqdefault.jpg` (no host_permissions needed for `<img>` loads). The manifest's `frame-src` CSP entry is left in place for forward-compat in case a future workaround surfaces. `phonemeVideos.ts` was harvested from BBC Learning English's "English Pronunciation Tips" series via `yt-dlp` — see the file's header comment for the exact harvest command, and `tests/phonemeVideos.test.ts` enforces 1:1 coverage with `phonemes.ts`.
- `webkitSpeechRecognition` is only available in Chromium/Edge. `PronunciationCheck` falls back to a typed-input grader when `isRecognitionSupported()` returns false or mic permission is denied. The Speak tab only logs the first attempt per target word toward production stats — retries are free practice.
