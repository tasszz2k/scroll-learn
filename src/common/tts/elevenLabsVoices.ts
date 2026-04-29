// Hard-coded catalog of ElevenLabs free-tier voices.
//
// The voice ids here are the public, default-account voices ElevenLabs ships
// to every free user. They live under the user's "Default" voices tab and do
// not require cloning, library installation, or a paid plan. We hard-code
// rather than scrape the page because:
//   * the voice list lives in a Settings panel that we already have to drive,
//     so reading it back round-trips for no good reason; and
//   * the ids are stable identifiers ElevenLabs has kept for years -- Rachel,
//     Adam, Antoni, etc. have shipped under the same ids since v1.
//
// If a voice id is no longer present in the user's account (e.g. the account
// is enterprise-only and the default library is hidden), the content script
// falls back to whatever voice is already selected and logs a warning -- it
// does not fail the job.

export interface ElevenLabsVoice {
  id: string;          // The voice id ElevenLabs uses internally
  name: string;        // Display name shown in the Voice dropdown
  lang: string;        // BCP-47 language tag (e.g., 'en-US', 'en-GB')
  gender: 'male' | 'female' | 'neutral';
}

export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', lang: 'en-US', gender: 'female' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi',   lang: 'en-US', gender: 'female' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella',  lang: 'en-US', gender: 'female' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', lang: 'en-US', gender: 'male'   },
  { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli',   lang: 'en-US', gender: 'female' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh',   lang: 'en-US', gender: 'male'   },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', lang: 'en-US', gender: 'male'   },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam',   lang: 'en-US', gender: 'male'   },
  { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam',    lang: 'en-US', gender: 'male'   },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', lang: 'en-GB', gender: 'male'   },
];

/**
 * Pick a voice for a given speaker in a multi-speaker shadowing script.
 *
 * Goals (in priority order):
 *   1. Don't pin two speakers in the same script to the same voice -- the
 *      learner needs to hear the cast as distinct people.
 *   2. When there are exactly two speakers, bias toward one male + one female
 *      so the contrast is obvious to the ear.
 *   3. For three or more speakers, rotate through the catalog to maximize
 *      variety while still respecting `used`.
 *   4. Be deterministic for a given `(speakerId, speakerIndex, totalSpeakers,
 *      used)` tuple so re-rendering the same script picks the same voice
 *      (and therefore hits the audio cache).
 */
export function pickElevenLabsVoiceForSpeaker(
  _speakerId: string,
  speakerIndex: number,
  totalSpeakers: number,
  used: ReadonlySet<string>,
): ElevenLabsVoice {
  // Defensive: empty catalog should never happen, but bail safely.
  if (ELEVENLABS_VOICES.length === 0) {
    throw new Error('ELEVENLABS_VOICES catalog is empty');
  }

  // Two-speaker case: enforce gender variety. Speaker 0 gets the first unused
  // female; speaker 1 gets the first unused male (or vice versa if speaker 0
  // somehow already grabbed a male voice via `used`).
  if (totalSpeakers === 2) {
    const wantFemale = speakerIndex === 0;
    const primary = ELEVENLABS_VOICES.find(
      v => !used.has(v.id) && (wantFemale ? v.gender === 'female' : v.gender === 'male'),
    );
    if (primary) return primary;
    // Fall through to round-robin if the preferred gender bucket is exhausted.
  }

  // Default: rotate through the catalog, skipping anything already pinned.
  // Start from `speakerIndex` so different speakers in the same script land on
  // different voices even before `used` is populated.
  const start = ((speakerIndex % ELEVENLABS_VOICES.length) + ELEVENLABS_VOICES.length)
    % ELEVENLABS_VOICES.length;
  for (let offset = 0; offset < ELEVENLABS_VOICES.length; offset++) {
    const idx = (start + offset) % ELEVENLABS_VOICES.length;
    const candidate = ELEVENLABS_VOICES[idx];
    if (!used.has(candidate.id)) return candidate;
  }

  // Every voice already in use (cast larger than catalog). Fall back to the
  // round-robin slot regardless of `used` -- the duplicate is acceptable when
  // the script genuinely has more speakers than we have voices for.
  return ELEVENLABS_VOICES[start];
}
