# Changelog

All notable changes to ScrollLearn will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.20.2](https://github.com/tasszz2k/scroll-learn/compare/v1.20.1...v1.20.2) (2026-05-03)


### Bug Fixes

* **decks:** keep active pill next to title and stop card actions wrapping ([d71f960](https://github.com/tasszz2k/scroll-learn/commit/d71f9603622b21942f7cee4c9d6b0609cb1057c2))

## [1.20.1](https://github.com/tasszz2k/scroll-learn/compare/v1.20.0...v1.20.1) (2026-05-03)


### Bug Fixes

* **study:** repair retention metric and add practice-anyway flow ([b627015](https://github.com/tasszz2k/scroll-learn/commit/b62701590838fe54fcd0bde3c9f4ced6274203d1))

## [1.20.0](https://github.com/tasszz2k/scroll-learn/compare/v1.19.1...v1.20.0) (2026-05-03)


### Features

* **notes:** add "Enable on all sites" toggle and remove sidebar FAB ([cbb9192](https://github.com/tasszz2k/scroll-learn/commit/cbb919262c355c0a420168a034f33a1f5766a38f))

## [1.19.1](https://github.com/tasszz2k/scroll-learn/compare/v1.19.0...v1.19.1) (2026-05-02)


### Bug Fixes

* **tts:** implement caching for unavailable ElevenLabs API keys ([487b4ae](https://github.com/tasszz2k/scroll-learn/commit/487b4ae73a86153479884d58514436dd61c621bb))

## [1.19.0](https://github.com/tasszz2k/scroll-learn/compare/v1.18.0...v1.19.0) (2026-05-02)


### Features

* **gemini:** add direct API path with personal context and quota-aware rotation ([c3245ee](https://github.com/tasszz2k/scroll-learn/commit/c3245ee7d2946dd8087217b39640fc8008e3eef4))

## [1.18.0](https://github.com/tasszz2k/scroll-learn/compare/v1.17.3...v1.18.0) (2026-05-01)


### Features

* **shadow:** split pron check flags into confidence buckets ([fb463ce](https://github.com/tasszz2k/scroll-learn/commit/fb463ceb3cc39d6f6d04409b50e645620c960893))

## [1.17.3](https://github.com/tasszz2k/scroll-learn/compare/v1.17.2...v1.17.3) (2026-05-01)


### Bug Fixes

* **shadow:** use recognizer transcript as honesty anchor for pron check ([9be8801](https://github.com/tasszz2k/scroll-learn/commit/9be880159be8dfb0a03f2ce487f737f88eccd53d))

## [1.17.2](https://github.com/tasszz2k/scroll-learn/compare/v1.17.1...v1.17.2) (2026-05-01)


### Bug Fixes

* **shadow:** grade pron check from audio, not the noisy recognizer ([fe58507](https://github.com/tasszz2k/scroll-learn/commit/fe585077f92c302558a7f98bd6f61bf7d3827efa))

## [1.17.1](https://github.com/tasszz2k/scroll-learn/compare/v1.17.0...v1.17.1) (2026-05-01)


### Bug Fixes

* **shadow:** flag every substituted word in pron check, not just one ([3d5eae3](https://github.com/tasszz2k/scroll-learn/commit/3d5eae355aa36b86f504815af2dff4d93068fb0c))

## [1.17.0](https://github.com/tasszz2k/scroll-learn/compare/v1.16.1...v1.17.0) (2026-05-01)


### Features

* **allowlist:** implicitly allow the extension's own pages for note capture ([66ef4a9](https://github.com/tasszz2k/scroll-learn/commit/66ef4a9955436cce21caa46c64e89228b3323efb))


### Bug Fixes

* **notebooks:** pin formatting toolbar and persist active notebook in side panel ([3fb1ac1](https://github.com/tasszz2k/scroll-learn/commit/3fb1ac12a558c8fca7452128b521b82f19f7b0c8))

## [1.16.1](https://github.com/tasszz2k/scroll-learn/compare/v1.16.0...v1.16.1) (2026-04-29)


### Bug Fixes

* **notebooks:** declare @tiptap/core as direct dep so pnpm CI can resolve it ([703396f](https://github.com/tasszz2k/scroll-learn/commit/703396fcd2bcb21786c75a744c3391fe9b00229b))

## [1.16.0](https://github.com/tasszz2k/scroll-learn/compare/v1.15.1...v1.16.0) (2026-04-29)


### Features

* **notebooks:** add Notebooks tab with markdown editor, IDB storage, AI assist, and table context menu ([e646942](https://github.com/tasszz2k/scroll-learn/commit/e6469428c7c584b237f342b993ada9d1bf539e16))

## [1.15.1](https://github.com/tasszz2k/scroll-learn/compare/v1.15.0...v1.15.1) (2026-04-29)


### Bug Fixes

* **gemini:** open the Gemini window focused so macOS doesn't throttle it ([ef81959](https://github.com/tasszz2k/scroll-learn/commit/ef81959277174164c563bacc8ed934c41ee9dc49))
* **gemini:** pulse Gemini window focus every 25s on macOS to outlast Chrome occlusion throttling ([896f393](https://github.com/tasszz2k/scroll-learn/commit/896f3937eb4d373c591ec724ed9e1b0f2a8588e2))

## [1.15.0](https://github.com/tasszz2k/scroll-learn/compare/v1.14.0...v1.15.0) (2026-04-29)


### Features

* **shadow:** add AI pronunciation check with karaoke pacing and cross-script practice plan ([2da1d9f](https://github.com/tasszz2k/scroll-learn/commit/2da1d9f2ce2638b3aea6c656da8e7407f2a6971b))

## [1.14.0](https://github.com/tasszz2k/scroll-learn/compare/v1.13.1...v1.14.0) (2026-04-29)


### Features

* **shadow:** per-phoneme lab with mic-graded pronunciation, mastery, streak ([65dc1a1](https://github.com/tasszz2k/scroll-learn/commit/65dc1a1e310a2b31d72303b23243c31d1fe76779))

## [1.13.1](https://github.com/tasszz2k/scroll-learn/compare/v1.13.0...v1.13.1) (2026-04-29)


### Bug Fixes

* **tts:** cascade fallback through providers instead of jumping to Web Speech ([d03eec2](https://github.com/tasszz2k/scroll-learn/commit/d03eec2331d380d40324ca5dd46e2b1bb62590bf))

## [1.13.0](https://github.com/tasszz2k/scroll-learn/compare/v1.12.0...v1.13.0) (2026-04-29)


### Features

* **stats:** recaps, time-on-task, and practice insights ([76bafa5](https://github.com/tasszz2k/scroll-learn/commit/76bafa54ddc057d507cb013fde8c7ce3f9f69870))

## [1.12.0](https://github.com/tasszz2k/scroll-learn/compare/v1.11.0...v1.12.0) (2026-04-29)


### Features

* **background:** kokoro-local relay and Shadow/IPA persistence handlers ([1ba0bb0](https://github.com/tasszz2k/scroll-learn/commit/1ba0bb0cdceb858b09dd151c7ad1723e1df43b4f))
* **dashboard:** reusable Confirm dialog and Select primitives ([e90b9c0](https://github.com/tasszz2k/scroll-learn/commit/e90b9c0278c5b5d9e66043af195271a6fc2d31ee))
* **dashboard:** wire Shadow tab, ConfirmProvider, and TTS token fields ([6a093b1](https://github.com/tasszz2k/scroll-learn/commit/6a093b1f0d49f4b40c1aef1a5130ec05434c6fe0))
* **shadow:** IPA foundation drills and shadowing practice player ([69ddd4b](https://github.com/tasszz2k/scroll-learn/commit/69ddd4b3c1a67f6678c25add7c44b1033dcc33c1))
* **shadow:** natural-delivery prompts + word-level karaoke for cloud TTS ([2fed7d4](https://github.com/tasszz2k/scroll-learn/commit/2fed7d42a0964057fb89d7a8345a4bba7da3b239))
* **sidebar:** Enter to send, always-visible New chat, clay-tinted assist buttons ([0059d58](https://github.com/tasszz2k/scroll-learn/commit/0059d58a2bb32561f1049c8bc102a8f47026a8d1))
* **tts:** pluggable TTS layer with ElevenLabs, Kokoro API, and kokoro-local engines ([e9d6f7f](https://github.com/tasszz2k/scroll-learn/commit/e9d6f7fbe9b81f412f5bb6fb19cecc65beadae35))
* **types:** add Shadow, IPA, and TTS provider types and storage helpers ([7ddfe58](https://github.com/tasszz2k/scroll-learn/commit/7ddfe58851e2bbcdd574458e62f17e60bb010295))

## [Unreleased]

### Features

- **shadow:** new Shadow tab for English speaking practice — IPA foundation primer (44-phoneme grid, click-to-hear, minimal-pair drill with per-phoneme reception accuracy) plus a Practice composer that turns target words into a Gemini-generated multi-speaker dialogue.
- **shadow:** four-stage shadowing player (Listen → Slow shadow → Full shadow → Blind shadow) with karaoke-style word highlighting, click-to-jump, repeat-line, and a rate slider; stages are declared once in `stages.ts` so docs and UI can't drift.
- **shadow:** routes `#shadow:foundation` and `#shadow:practice`; saved scripts persist in `chrome.storage.local` under `STORAGE_KEYS.SHADOW_SCRIPTS` and IPA progress under `STORAGE_KEYS.IPA_PROGRESS`.
- **tts:** pluggable TTS layer (`src/common/tts/`) with three engines — ElevenLabs (Flash v2.5 via `api.elevenlabs.io`), Kokoro (public `hexgrad/Kokoro-TTS` HuggingFace Space via Gradio queue), and kokoro-local (Kokoro-82M run 100% in-browser via kokoro-js + ONNX in an offscreen document). All engines fall back to Web Speech on failure.
- **tts:** IndexedDB-backed audio cache keyed by `(providerId, voice, text)` with LRU eviction at 100 MB, so replaying a saved script never re-spends credits or re-queues the Space.
- **settings:** Quiz behaviour section now hosts ElevenLabs API key and Kokoro (Hugging Face) token fields — masked by default with a SHOW/HIDE toggle, `autoComplete=off`, no spellcheck, no password-manager prompts. Tokens stay in `chrome.storage.local` and are sent only to their respective providers.
- **dashboard:** reusable Confirm dialog and Select primitives; `window.confirm` calls in DeckList and Settings replaced with the styled in-app dialog (variant: danger, custom labels).
- **sidebar:** Enter sends, Shift+Enter inserts a newline; "New chat" button is always visible at the top of the panel so a fresh conversation is one click away.
- **ai-assist:** clay-tinted Explain (filled) and Ask (ghost-tinted) buttons so the primary action stands out in the card.

### Notes

- New host permission `https://hexgrad-kokoro-tts.hf.space/*` for the Kokoro API engine; new `offscreen` permission and `wasm-unsafe-eval` CSP entry for the kokoro-local engine.
- `public/onnx/ort-wasm-simd-threaded.jsep.{mjs,wasm}` (~21 MB) ship with the extension so Transformers.js can resolve its ONNX runtime locally without a CDN fetch at runtime.
- Sensitive tokens (API keys, HF tokens) are stored only in `chrome.storage.local` and never logged or transmitted anywhere except the provider's own endpoint.

## [1.11.0](https://github.com/tasszz2k/scroll-learn/compare/v1.10.1...v1.11.0) (2026-04-28)


### Features

* **ai-assist:** play a success chime when a Gemini job finishes ([771d298](https://github.com/tasszz2k/scroll-learn/commit/771d29820eb0b9ae475c04d94311bd1ea14948d4))

## [1.10.1](https://github.com/tasszz2k/scroll-learn/compare/v1.10.0...v1.10.1) (2026-04-28)


### Bug Fixes

* **ai-assist:** paste full multi-line prompt into Gemini without auto-submit ([ba0843b](https://github.com/tasszz2k/scroll-learn/commit/ba0843bbafc319ac2efae696eba3d1dbdb06ca2e))

## [1.10.0](https://github.com/tasszz2k/scroll-learn/compare/v1.9.0...v1.10.0) (2026-04-28)


### Features

* **ai-assist:** Gemini-powered Explain & Ask with chat-style follow-ups ([e4f8d8a](https://github.com/tasszz2k/scroll-learn/commit/e4f8d8ad96214e58c0307d8aad7fdbd1845fa046))

## [1.9.0](https://github.com/tasszz2k/scroll-learn/compare/v1.8.0...v1.9.0) (2026-04-28)


### Features

* **ui:** editorial deck dropdown across study + popup ([92b576a](https://github.com/tasszz2k/scroll-learn/commit/92b576aaa7eec328c0371ba9b5f048a53cd863d2))


### Bug Fixes

* **background:** serve active deck directly instead of through global slice ([0227b05](https://github.com/tasszz2k/scroll-learn/commit/0227b0519a9424483d7e057d9dbec1ad1516e548))

## [1.8.0](https://github.com/tasszz2k/scroll-learn/compare/v1.7.0...v1.8.0) (2026-04-28)


### Features

* **cards:** rich Back details reveal panel and pronounce-aloud button ([75168cb](https://github.com/tasszz2k/scroll-learn/commit/75168cbda96dd718ac1273abe9ecb92484d6927b))
* **dashboard:** in-app Guide tab and storage live-sync ([abeedd0](https://github.com/tasszz2k/scroll-learn/commit/abeedd0bb12fbc7be5db3fe4f8ba11e8735b15b3))
* **notes:** enrich single-word captures with senses and word family ([cc32b92](https://github.com/tasszz2k/scroll-learn/commit/cc32b928f16a79b6d2ad279f4cd8ca4db61c73a4))
* **popup:** guide shortcut and active-deck dropdown ([2672ff4](https://github.com/tasszz2k/scroll-learn/commit/2672ff4023b7416d16410d19f061466518925c4e))
* **quiz:** auto-pronounce the answer when autoSpeakAnswer is on ([4ae9105](https://github.com/tasszz2k/scroll-learn/commit/4ae9105e73c7b48accd4bc3e7ea5513c94c93fe2))
* **settings:** About section with extension name and version ([8350cdd](https://github.com/tasszz2k/scroll-learn/commit/8350cdd744f2b9449d42ba63b5bf67c6bbbd3b6f))


### Bug Fixes

* **import:** pad trailing tags column when CSV rows drop mediaUrl ([2b7eb72](https://github.com/tasszz2k/scroll-learn/commit/2b7eb72b78cf39390e878d202d217e2c3a8f3b21))
* **updater:** always re-check on view, surface version in popup ([819e4f5](https://github.com/tasszz2k/scroll-learn/commit/819e4f57ab5f728d919fb980ddc86eeb50c32d0a))

## [1.7.0](https://github.com/tasszz2k/scroll-learn/compare/v1.6.0...v1.7.0) (2026-04-28)


### Features

* **notes:** switch capture modifier to Option and prefer drag-selection ([b07cd38](https://github.com/tasszz2k/scroll-learn/commit/b07cd38dfcade971d45f85f264e0708d696d1d96))

## [1.6.0](https://github.com/tasszz2k/scroll-learn/compare/v1.5.0...v1.6.0) (2026-04-27)


### Features

* **decks:** card preview with revealed answers ([185825d](https://github.com/tasszz2k/scroll-learn/commit/185825d9330cff18d0cea9bd1c40b76ce6576596))

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
