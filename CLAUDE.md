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
| Storage | `src/common/storage.ts` | Chrome Storage API wrapper, CRUD for decks/cards/settings/stats |
| Scheduler | `src/background/scheduler.ts` | SM-2 spaced repetition algorithm |
| Grading | `src/common/grading.ts` | Answer evaluation per card type |
| Fuzzy | `src/common/fuzzy.ts` | Levenshtein, Damerau-Levenshtein, Jaro-Winkler similarity |
| Parser | `src/common/parser.ts` | Import parsing (Simple, CSV, JSON formats) |
| Feed detectors | `src/content/fb.ts`, `youtube.ts`, `instagram.ts` | Domain-specific feed post detection |
| Blocker | `src/content/blocker.ts` | Hides Reels/Shorts, Sponsored, Suggested, Strangers content; tracks per-category counts |

### Path Alias

`@/` maps to `src/` — use `@/common/types` instead of relative paths.

## Card Types

- `text` — Free-form text answer with fuzzy matching. Wrong answers trigger retry practice mode.
- `mcq-single` — Single-choice multiple choice. Options are shuffled each time card is shown.
- `mcq-multi` — Multiple correct answers. Options are shuffled each time card is shown.
- `cloze` — Fill-in-the-blank (`{{answer}}` syntax). Wrong answers trigger retry practice mode.
- `audio` — Audio playback with text response. Wrong answers trigger retry practice mode.

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
- Currently covers: parser functions, SM-2 scheduler
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
- **Content script CSS**: `public/content.css` is used for content script styles (copied to `dist/` during build). The `src/styles/` directory is for dashboard/popup styles only
- Facebook sidebar nav items are plain `<div>` elements (not `<a>` links) -- href-based selectors don't work for the sidebar Reels button. Use text-based detection with DOM walk-up instead.
- Facebook dynamically re-renders navigation bars via React -- CSS-only hiding is insufficient for nav elements. Always pair CSS with observer + periodic scan.
