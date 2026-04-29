# Shadow scripts: natural delivery + word-level karaoke

Date: 2026-04-29
Status: approved (brainstorming)

## Problem

Shadowing audio sounds robotic. Two root causes:

1. The model is prompted to emit clean prose, so generated `text` lacks the fillers, pacing punctuation, and per-speaker personality that real conversation has. ElevenLabs / Kokoro / Web Speech all read this clean text flatly because there is nothing emotive in it to read.
2. When ElevenLabs or Kokoro plays back, the line text on screen does not follow the audio. Word-level highlight (karaoke) is wired only on the Web Speech path. Cloud audio gets no per-word follow, so learners cannot use the on-screen text to catch rhythm or stress.

## Goal

Make generated scripts read like spoken English (option A from the brainstorm: a single `text` field carries the natural delivery; no `ttsText` field, no markup, no parser), and make every TTS provider drive the existing word-level highlight in `ShadowPlayer.tsx`.

## Non-goals

- ElevenLabs v3 audio tags (`[laughs]`, `[whispers]`). Separate decision: requires bumping the model from Flash v2.5 to v3 at roughly 3x the credit cost per character.
- SSML or any markup on `text`.
- A settings toggle for naturalness. The existing `register` field on `ShadowPromptParams` (`casual` / `neutral` / `formal` / `academic`) controls intensity.
- Migrating already-saved scripts. Old scripts continue to play with their existing `text`. Users hit the existing "Regenerate all" button if they want them re-rendered.
- Phoneme-level karaoke. Word-level is the unit learners use for shadowing.

## Phase 1 — natural delivery in the prompt

Single file: `src/dashboard/components/shadow/prompts.ts`.

Inside `buildShadowPrompt`, add a "NATURAL DELIVERY" instruction block. Schema, JSON output, target-word coverage, `glossVi` requirement, and CEFR/duration/speaker constraints stay exactly as they are today. Only the prose instructions change.

The new block tells the model to write each `text` line the way it would actually be spoken:

- Verbal fillers and discourse markers, used in roughly 30-40 percent of lines: `Hmm,` `Well,` `Yeah,` `Right,` `You know,` `I mean,` `Look,` `Honestly,` `Oh,` `Actually,`. Frequency scales by `register`: heavy in `casual`, moderate in `neutral`, minimal in `formal`, none in `academic`.
- Pacing punctuation: `...` for hesitation, `--` for a self-interrupt, comma-broken breath groups for long clauses, `!` and `?!` where the emotion warrants. Lines must not all end on flat periods.
- Contractions preferred (`it's`, `we'll`, `don't`) except when the register is `academic`.
- When `speakerCount >= 2`, give each speaker a slight personality (e.g., A more probing, B more measured) so the dialogue does not feel like one voice in two roles. No caricature, no accents, no stage directions in the text.

The `glossVi` requirement explicitly applies to the natural line including fillers. The Vietnamese rendering should be how a fluent native would actually say the same thing in conversation, not a literal mapping of "Hmm,".

### Phase 1 tests

`tests/shadowPrompt.test.ts` already exists. Add cases that:

- Assert the new "NATURAL DELIVERY" section is present in the rendered prompt for each `register` value, and that it contains the register-specific guidance (e.g., "minimal" for `formal`).
- Assert that the existing `parseShadowJSON` still accepts `text` values containing `...`, `--`, embedded commas, `!`, and `?!`. These are already valid JSON string content, so the test pins behavior rather than fixing a bug.

## Phase 2 — word-level karaoke for ElevenLabs and Kokoro

The dashboard side is already done:

- `TTSSpeakRequest` (`src/common/tts/index.ts`) accepts `onBoundary?: (charIndex, charLength) => void`.
- `ShadowPlayer.tsx` line 700 wires `onBoundary` to `setHighlight({ charIndex, charLength })`.
- The renderer (lines 1286-1303) already paints the active span with the prefix / highlight / suffix split.

Web Speech fires `onBoundary` natively. ElevenLabs and Kokoro do not, so the highlight stays static when those providers play. The fix is to source per-character timing for cloud audio and emit synthetic `onBoundary` events from playback.

### 2a. Cache schema (`src/common/tts/audioCache.ts`)

Today the IndexedDB record is `{ providerId, voice, text, blob, mime, createdAt, lastUsedAt, sizeBytes }`. Add one optional field:

```ts
alignment?: {
  charStartTimesSec: number[];   // length === text.length
};
```

We only persist start times. Character N's end is character N+1's start; the last character's end is `audio.duration`. Old records continue to load and play; they simply have no alignment, which falls back to the static-highlight behavior we have today. On a fresh generation, the new path writes alignment, so subsequent cache hits drive karaoke.

`tests/audioCache.test.ts` (already exists) gets two new cases: round-trip an entry with alignment, and round-trip an entry without alignment, asserting back-compat.

### 2b. `playAudioBlob` (`src/common/tts/playback.ts`)

Extend `PlayBlobOptions`:

```ts
alignment?: { charStartTimesSec: number[] };
text?: string;                                // required when alignment is set
onBoundary?: (charIndex: number, charLength: number) => void;
```

When `alignment`, `text`, and `onBoundary` are all present:

1. Pre-compute word boundaries from `text` once: scan `/\S+/g` to produce `[{ start, length }]`.
2. Start a `requestAnimationFrame` loop. On each frame, read `audio.currentTime`, advance a cursor through `charStartTimesSec` past entries whose time has passed, find the word that contains the resulting `charIndex`, and fire `onBoundary(word.start, word.length)` whenever the active word changes. 60 fps is fine; the rAF cancels on stop / end / error.
3. Apply `audio.playbackRate` correctly: `audio.currentTime` already accounts for the rate, so no manual scaling is needed.

When alignment is not provided, the path is identical to today and `onBoundary` is never called. Pure additive change.

### 2c. ElevenLabs — switch to `with-timestamps`

`src/common/tts/elevenlabsApi.ts` currently posts to `/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128` and reads the response body as the audio Blob.

Switch the URL to `/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128`. Same body, same headers, same model (`eleven_flash_v2_5`). The response is now JSON:

```json
{
  "audio_base64": "...",
  "alignment": {
    "characters": ["H", "i", " ", ...],
    "character_start_times_seconds": [0.0, 0.04, 0.10, ...],
    "character_end_times_seconds":   [0.04, 0.10, 0.12, ...]
  }
}
```

Decode `audio_base64` with the existing `base64ToAudioBlob` helper. Validate the alignment: if `alignment.characters.length === text.length`, build `charStartTimesSec` from `character_start_times_seconds`. If it does not match exactly (ElevenLabs occasionally normalizes input, e.g., expanding `Mr.` to `Mister`, which shifts the character count), drop alignment entirely and persist the Blob alone — playback then falls back to the static-highlight path. Persist the Blob and the alignment together via the updated `audioCache.putCached`. Pass alignment + text through to `playAudioBlob`. Forward `req.onBoundary` so the player renders the highlight.

The `character-cost` response header still works on the timestamps endpoint; no change to credits accounting. The 402 / 401 error-message branches remain identical.

### 2d. Kokoro — uniform alignment

`src/common/tts/kokoroApi.ts` calls the public `hexgrad/Kokoro-TTS` Hugging Face Space and gets back audio only, no timing. After the Blob is downloaded:

1. Probe duration with a throw-away `HTMLAudioElement`: assign `URL.createObjectURL(blob)` to `.src`, await `loadedmetadata`, read `duration`, revoke the URL.
2. If the probe fails or duration is not finite, persist the Blob with no alignment (graceful degradation to today's behavior).
3. Otherwise, distribute `duration` uniformly across `text.length`: `charStartTimesSec[i] = (i / text.length) * duration`.

Crude but adequate at line lengths the player uses (6 to 14 words). Persist alongside the Blob so cache hits get the same treatment.

Alternative considered and rejected: weighting by syllable count or vowel positions. Marginal accuracy improvement; not worth the extra dependency and complexity for a fallback that already feels right at conversational pace.

### Phase 2 tests

- `tests/elevenlabsTimestamps.test.ts` (new): mock the `with-timestamps` JSON response and assert `audio_base64` decodes to a Blob and `charStartTimesSec` is built from `character_start_times_seconds` when `characters.length === text.length`. Add a mismatched-length case asserting alignment is dropped (Blob still persisted, no `charStartTimesSec` field on the cache entry).
- `tests/audioCache.test.ts` (extend): with-alignment and without-alignment round-trip cases.
- `tests/playbackBoundary.test.ts` (new): given a fixed `charStartTimesSec` and a fake audio source whose `currentTime` advances on a timer, assert `onBoundary` fires once per word boundary in order with the right `(charIndex, charLength)` pairs.

Manual smoke (not automated): load a saved script, play with each of the three providers, confirm the highlight tracks audio. Browser audio playback is out of scope to automate in vitest.

## Implementation order

1. Phase 1 (`prompts.ts` + `tests/shadowPrompt.test.ts`). Independent of everything else; can ship first.
2. Phase 2 cache schema (`audioCache.ts` + `tests/audioCache.test.ts`).
3. Phase 2 playback rAF loop (`playback.ts` + `tests/playbackBoundary.test.ts`).
4. Phase 2 ElevenLabs `with-timestamps` integration (`elevenlabsApi.ts` + `tests/elevenlabsTimestamps.test.ts`).
5. Phase 2 Kokoro uniform alignment (`kokoroApi.ts`).
6. Manual smoke in the dashboard against all three providers.

## Risk and rollback

- **Phase 1** is prompt-text only. If the model produces lines that read poorly with new fillers, rollback is reverting a single function. No data on disk changes.
- **Phase 2c** changes the ElevenLabs endpoint. If `with-timestamps` fails for any reason, the existing fallback in `elevenlabsApi.ts` already routes errors to Web Speech, so a learner never gets silence. Rollback is restoring the previous URL.
- **Phase 2d** for Kokoro adds a duration probe. If the probe fails, alignment is omitted and the line plays exactly as it does today (static highlight).
- **Cache schema change** is additive. Existing IDB records continue to read; new code paths handle missing alignment.

## File summary

Touched:

- `src/dashboard/components/shadow/prompts.ts`
- `src/common/tts/audioCache.ts`
- `src/common/tts/playback.ts`
- `src/common/tts/elevenlabsApi.ts`
- `src/common/tts/kokoroApi.ts`

New tests:

- `tests/playbackBoundary.test.ts`
- `tests/elevenlabsTimestamps.test.ts`

Extended tests:

- `tests/shadowPrompt.test.ts`
- `tests/audioCache.test.ts`

`ShadowPlayer.tsx` is **not** edited. It already does the right thing.
