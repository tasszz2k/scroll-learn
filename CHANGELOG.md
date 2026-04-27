# Changelog

All notable changes to ScrollLearn will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.5.0](https://github.com/tasszz2k/scroll-learn/compare/v1.4.0...v1.5.0) (2026-04-27)


### Features

* **notes:** bias AI prompt toward English-answer cards ([a62fa80](https://github.com/tasszz2k/scroll-learn/commit/a62fa80d50478674bd3bed96f61fc751aec3c130))

## [1.4.0](https://github.com/tasszz2k/scroll-learn/compare/v1.3.0...v1.4.0) (2026-04-27)


### Features

* **notes:** align AI prompt with grammar-police-learn skill guidance ([9e83241](https://github.com/tasszz2k/scroll-learn/commit/9e832417ceb51d7f3be07a13658992b05289f7bc))

## [1.3.0](https://github.com/tasszz2k/scroll-learn/compare/v1.2.0...v1.3.0) (2026-04-27)


### Features

* **notes:** teach AI prompt to connect the dots across notes ([f726c09](https://github.com/tasszz2k/scroll-learn/commit/f726c09cf67b47b4e559809a91d69fb565ccb8ac))

## [1.2.0](https://github.com/tasszz2k/scroll-learn/compare/v1.1.7...v1.2.0) (2026-04-27)


### Features

* **notes:** AI prompt generator with translation mode ([a9d8909](https://github.com/tasszz2k/scroll-learn/commit/a9d89097df4f87feede134e3d8ece7fe15b643d9))

## [1.1.7](https://github.com/tasszz2k/scroll-learn/compare/v1.1.6...v1.1.7) (2026-04-27)


### Bug Fixes

* **install:** unzip -o so re-running the installer does not prompt ([e089b0f](https://github.com/tasszz2k/scroll-learn/commit/e089b0fdb12fe4d64d184f8bc1853685f5ce0316))

## [1.1.6](https://github.com/tasszz2k/scroll-learn/compare/v1.1.5...v1.1.6) (2026-04-27)


### Bug Fixes

* **install:** help users find the hidden ~/.scroll-learn dir ([bba5ad3](https://github.com/tasszz2k/scroll-learn/commit/bba5ad30a988d7ae256363b431d2093590110fbb))
* **updater:** clear update banner after install / manual reload ([64654a6](https://github.com/tasszz2k/scroll-learn/commit/64654a60e6fb2ed481b02c9807e0d5378ab79679))

## [1.1.5](https://github.com/tasszz2k/scroll-learn/compare/v1.1.4...v1.1.5) (2026-04-27)


### Bug Fixes

* **landing:** ship installer as zip so executable bit survives download ([d4cae64](https://github.com/tasszz2k/scroll-learn/commit/d4cae64479a8dd0bd53a2eeca0e2b394507b34c2))

## [1.1.4](https://github.com/tasszz2k/scroll-learn/compare/v1.1.3...v1.1.4) (2026-04-27)


### Bug Fixes

* **ci:** drop pnpm cache key (no pnpm-lock.yaml in tree) ([21c14fc](https://github.com/tasszz2k/scroll-learn/commit/21c14fc6f4cf9bef2b8ddf21bce2e3099004cce0))

## [1.1.3](https://github.com/tasszz2k/scroll-learn/compare/v1.1.2...v1.1.3) (2026-04-27)


### Bug Fixes

* **ci:** switch install step to pnpm ([f8a26c8](https://github.com/tasszz2k/scroll-learn/commit/f8a26c83b5c6f9baa289afbb017a6c172990f9b9))
* **landing:** make Download installer link trigger a download ([50347f9](https://github.com/tasszz2k/scroll-learn/commit/50347f9a31057591f232e7dd7e8630a3928eeb36))

## [1.1.2](https://github.com/tasszz2k/scroll-learn/compare/v1.1.1...v1.1.2) (2026-04-27)


### Bug Fixes

* **ci:** pin npm to 10.5.2 to dodge exit-handler bug ([ae295b1](https://github.com/tasszz2k/scroll-learn/commit/ae295b1bd6dc476a0eaa4734565df96df20db3b0))

## [1.1.1](https://github.com/tasszz2k/scroll-learn/compare/v1.1.0...v1.1.1) (2026-04-27)


### Bug Fixes

* **ci:** bump build job to node 22 ([f916387](https://github.com/tasszz2k/scroll-learn/commit/f916387934cc254d42b980435c8aab5cb1a3645b))

## [1.1.0](https://github.com/tasszz2k/scroll-learn/compare/v1.0.0...v1.1.0) (2026-04-27)


### Features

* add Grammar Police integration for enhanced learning materials ([8b76106](https://github.com/tasszz2k/scroll-learn/commit/8b761062c42f8dd4ad8cf30d04e1617769a4f5ca))
* add standalone study mode with colorful UI and fix grading bugs ([b8c518b](https://github.com/tasszz2k/scroll-learn/commit/b8c518b2bce91ec10ded214faade64799024c43c))
* capture text selections into a Notes tab with EN-VI export ([5742d97](https://github.com/tasszz2k/scroll-learn/commit/5742d978a8683a7b99124a26f07a94f6ec600bc1))
* **notes:** auto-translate captured notes ([dadf5e7](https://github.com/tasszz2k/scroll-learn/commit/dadf5e72c1ab107e4af75d19566038af0fe35c14))
* **updater:** in-app auto-updater with native messaging helper ([911aad2](https://github.com/tasszz2k/scroll-learn/commit/911aad2e261ec02bdffa9a98b2f354ab449d73a2))


### Bug Fixes

* **content:** hide raw cloze template shown above interactive blanks ([2d52557](https://github.com/tasszz2k/scroll-learn/commit/2d525576465c995af0b20873ba52adc360d664f8))
* update fuzzy thresholds to improve grading accuracy ([d4cd8e9](https://github.com/tasszz2k/scroll-learn/commit/d4cd8e97e5ee900efedd561694494f883abba164))

## [Unreleased]

### Added

#### Standalone Study Mode
- **Study tab in dashboard**: New dedicated study session for continuous learning without scrolling social media
  - Auto-starts session on mount — no "Start" button needed
  - Persistent deck selector at top using `settings.activeDeckId` (synced with popup and content script)
  - Session stats bar with colored pills: deck name (purple), reviewed count (blue), accuracy (green), score (teal/red), streak (orange)
  - Supports all card types: text, mcq-single, mcq-multi, cloze, audio
  - Keyboard shortcuts: 1-4 for MCQ selection, Enter to submit, Escape to skip
  - Retry-to-practice mode for wrong text/audio/cloze answers
  - Session complete view with reviewed/accuracy/streak summary
  - Edit and Delete card actions during study
- **Colorful MCQ options**: Each option has a distinct color theme (blue, violet, amber, emerald, rose, cyan) with matching number badges; selected state uses orange highlight
- **Cloze feedback rendering**: Feedback view renders cloze blanks as highlighted inline pills instead of raw `{{answer}}` syntax
- **"Study Now" button in popup**: Quick action to open dashboard Study tab directly
- **`get_next_study_card` message type**: Background handler for standalone study (no domain checks or deck rotation side effects)
- **Hash-based routing**: Dashboard URL hashes (`#study`, `#decks`, `#import`, `#settings`, `#stats`) for direct navigation

### Fixed

#### Grading: Canonical Answer Normalization
- **Fixed text/cloze grading always marking correct answers as wrong**: `canonicalAnswers` from card data were compared raw against normalized user input
  - Both sides are now normalized before comparison
  - Affects `gradeText()` and `gradeCloze()` in `src/common/grading.ts`

#### Study Session State Persistence
- **Fixed session stats resetting on every answer**: `loadData()` set `loading=true` which unmounted the entire app, destroying StudySession's local state (streak, reviewed count, accuracy)
  - `loadData(showLoading)` now accepts a boolean parameter; study session refreshes silently with `showLoading=false`

## [1.0.0] - 2026-02-23

### Added

#### Blocked Content Breakdown Tooltip
- **Per-category count on hover**: The "X blocked" badge in the popup now shows a tooltip on hover with a breakdown by category (Reels, Shorts, Sponsored, Suggested, Strangers)
  - `hideElement()` now tracks which category triggered each hide
  - Content script returns both total count and per-category `BlockedCounts` object
  - Tooltip uses a dark card with per-row label/count layout, positioned above the badge

#### Content Blocker: Facebook Reels Navigation Hiding
- **Hide Reels buttons across all Facebook navigation surfaces**: The content blocker now hides the Reels button from the mobile tab bar, desktop top bar, and desktop left sidebar
  - **Mobile tab bar**: CSS + observer targeting `a[aria-label="Reels"][href*="/reel/"]` and parent container via `:has()`
  - **Desktop top bar**: aria-label-based detection via `hideFacebookReelsNavByText()` finds `[aria-label="Reels"]` elements outside feed articles/regions
  - **Desktop sidebar**: Text-based detection finds `<span>` elements with exact text "Reels", walks up the DOM to the nav item container (first ancestor containing an icon element in a sibling branch)
  - All three detection layers (CSS injection, MutationObserver, periodic 2s scan) cover navigation buttons to handle Facebook's dynamic React re-renders
  - Skips feed articles, Reels carousel regions, and FeedUnit pagelets to avoid false positives

### Improved

#### Popup Layout
- **Reordered popup sections**: Active Deck selector now appears above Content Blocking toggles for better priority/visibility
- **Fixed toggle row spacing**: Added 10px vertical margin between toggle rows in Content Blocking section to prevent overlap

### Fixed

#### CRITICAL: Grading System Bug
- **Fixed broken similarity algorithm accepting wrong answers**: The `calculateSimpleSimilarity` function was fundamentally flawed
  - **Bug**: Used character existence check (`includes`) instead of positional comparison
  - **Impact**: Gave 91% similarity to answers that were only 54% similar
  - **Example**: "could you introduce the guideline" vs "provide instructions on how to" incorrectly matched
  - **Fix**: Replaced with proper Levenshtein distance-based similarity from `fuzzy.ts`
  - Now uses same grading logic as `grading.ts` module (proper normalization + fuzzy matching)
  - Added proper support for `canonicalAnswers` and `settings.fuzzyThresholds`

#### Answer Feedback Display
- **Always show correct answer for reference**: Even when user answers correctly
  - Previously only showed "Perfect!" or "Good job!" without displaying expected answer
  - Now shows: "Perfect! The answer: [expected answer]"
  - Helps users verify they learned the correct format/phrasing
  - Especially useful for questions with multiple acceptable answers

#### Retry Practice UX
- **Keep original input for editing**: Retry practice mode now preserves the user's incorrect answer instead of clearing it
  - Users can edit their original answer rather than retyping everything from scratch
  - Input text is automatically selected for easy replacement if desired
  - Updated placeholder text to "Edit your answer or retype the correct answer..."
  - Applies to text, audio, and cloze card types
  - Better UX for small typos or partially correct answers

#### Correct Answer Display
- **Fixed diff showing normalized answers**: Diff feedback now shows original answer with proper capitalization and punctuation
  - Previously showed normalized version (lowercase, no punctuation) from `canonicalAnswers`
  - Now uses `card.back` for display which preserves original formatting
  - Grading still uses normalized comparison (case-insensitive)
  - Display shows correct capitalization to help users learn proper formatting

#### Retry-to-Practice Feature
- **Retry practice mode for incorrect text/audio/cloze answers**: When users answer these card types incorrectly, they must now retype the correct answer before proceeding to reinforce learning
  - Input field is re-enabled with new placeholder text: "Type the correct answer to continue..."
  - Case-insensitive exact match validation (no fuzzy matching during retry)
  - Wrong retry attempts trigger shake animation and show diff feedback
  - Correct retry clears feedback and proceeds to next question
  - "Skip & Next" button allows bypassing retry practice
  - MCQ cards intentionally skip retry mode (selecting the right option isn't meaningful practice)
  - Original incorrect grade is still recorded to SM-2 scheduler (card reschedules to 10 min)

#### Inline Diff Feedback
- **Visual diff display for wrong answers**: Replaced simple text feedback with inline git-style diff
  - Red strikethrough for user's wrong answer
  - Green highlight for correct answer
  - Displays both on same line when partially correct (e.g., missing prefix/suffix)
  - Falls back to two-line display when answers are completely different
  - Uses monospace font for easier character-by-character comparison
  - Preserves correct answer's original casing and punctuation (not user's)
  - Shows message "Now try typing the correct answer below ↓" for initial wrong answers
  - Shows simplified "Not quite — compare:" message for retry attempts

#### MCQ Option Shuffling
- **Randomized option order**: MCQ options are now shuffled using Fisher-Yates algorithm each time a card is shown
  - Prevents users from memorizing option positions instead of content
  - Display keys (1, 2, 3, 4) remain sequential for keyboard shortcuts
  - `data-index` attribute preserves original index for correct grading
  - Highlighting of correct/incorrect answers works correctly with shuffled options
  - Applies to both single-choice (`mcq-single`) and multi-choice (`mcq-multi`) cards

### Technical Details

#### Modified Files (2026-02-12)
- `src/content/content.ts`:
  - Fixed `showAnswerFeedback()` to use `card.back` for display instead of `canonicalAnswers`
  - Fixed `handleRetrySubmit()` to use `card.back` for diff display
  - Added `parseClozeAnswersFromBack()` helper to extract original answers from card.back

- `CHANGELOG.md`:
  - Documented correct answer display fix

#### Modified Files (2026-02-11)
- `src/content/content.ts`:
  - Added `isRetryMode` state flag to track retry practice mode
  - Added `shuffledIndices` array to track MCQ option shuffle order
  - Implemented `shuffleArray()` using Fisher-Yates algorithm
  - Implemented `generateInlineDiff()` for character-level diff highlighting
  - Modified `handleSubmit()` to branch into retry mode for text/audio/cloze
  - Modified `handleKeyDown()` to call `handleRetrySubmit()` during retry mode
  - Modified `buildMCQOptions()` to shuffle options and preserve original indices
  - Modified `showAnswerFeedback()` to use diff display for text/audio/cloze
  - Added `showRetryPractice()` to enable retry mode UI
  - Added `handleRetrySubmit()` to validate retry attempts
  - Added `showRetryDiff()` to show diff during retry
  - Added `showInitialWrongAnswerDiff()` to show diff for initial wrong answer
  - Updated MCQ highlighting to use `data-index` instead of display position
  - Reset retry/shuffle state in `closeQuiz()` and `loadNextCard()`

- `src/styles/content.css`:
  - Added `@keyframes ss-shake` animation for wrong retry attempts
  - Added `.scrolllearn-shake` class

#### State Management
- Retry mode state (`isRetryMode`) is reset on:
  - Quiz close
  - Loading next card
  - Successful retry confirmation
  - Skip & Next button click

- Shuffle state (`shuffledIndices`) is reset on:
  - Quiz close
  - Loading next card
  - Fresh on each `buildMCQOptions()` call

### UX Improvements
- Users now get immediate active practice on wrong answers (not just passive reading)
- Diff display makes it instantly clear what was wrong vs what's correct
- MCQ shuffling ensures users learn content, not positions
- Visual feedback (shake, colors) provides clear success/failure signals
