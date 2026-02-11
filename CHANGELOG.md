# Changelog

All notable changes to ScrollLearn will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added - 2026-02-11

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

#### Modified Files
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
