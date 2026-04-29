// Hard-coded catalog of Kokoro-TTS voices.
//
// The Kokoro-TTS HuggingFace Space (https://huggingface.co/spaces/hexgrad/
// Kokoro-TTS) ships a fixed roster of pretrained voices. We hard-code rather
// than scrape the dropdown because:
//   * the Space's voice list lives behind the Gradio dropdown that the
//     content script already has to drive -- reading it back round-trips
//     for no good reason; and
//   * the ids are stable and follow a strict naming convention that the
//     Kokoro model itself uses internally (see below).
//
// Naming convention: <region><gender>_<name_lowercase>
//   region:  'a' = American English,  'b' = British English
//   gender:  'f' = female,             'm' = male
// e.g. 'af_heart' is American female "Heart"; 'bm_george' is British male
// "George". This convention is what the Kokoro inference code expects in its
// voice slot, and the dropdown labels mirror it.
//
// Unlike the ElevenLabs catalog we deliberately DO NOT pin a voice to a
// (speakerIndex, totalSpeakers) pair. The user's explicit ask is for random
// voice assignment per script so re-rendering the same script a second time
// can produce a different cast (which keeps shadowing practice fresh). The
// "no two speakers in one script share a voice" constraint is enforced via
// the `used` set passed in by the caller; pinning across renders is the
// caller's job (e.g. by persisting the assignment alongside the script).

export interface KokoroVoice {
  id: string;          // The voice id Gradio uses internally (e.g. 'af_heart')
  name: string;        // Display name as shown in the dropdown
  region: 'us' | 'gb' | 'other';  // Derived from the flag emoji prefix
  gender: 'female' | 'male';
}

export const KOKORO_VOICES: KokoroVoice[] = [
  // US female (af_*)
  { id: 'af_heart',    name: 'Heart',    region: 'us', gender: 'female' },
  { id: 'af_bella',    name: 'Bella',    region: 'us', gender: 'female' },
  { id: 'af_nicole',   name: 'Nicole',   region: 'us', gender: 'female' },
  { id: 'af_aoede',    name: 'Aoede',    region: 'us', gender: 'female' },
  { id: 'af_kore',     name: 'Kore',     region: 'us', gender: 'female' },
  { id: 'af_sarah',    name: 'Sarah',    region: 'us', gender: 'female' },
  { id: 'af_nova',     name: 'Nova',     region: 'us', gender: 'female' },
  { id: 'af_sky',      name: 'Sky',      region: 'us', gender: 'female' },
  { id: 'af_alloy',    name: 'Alloy',    region: 'us', gender: 'female' },
  { id: 'af_jessica',  name: 'Jessica',  region: 'us', gender: 'female' },
  { id: 'af_river',    name: 'River',    region: 'us', gender: 'female' },

  // US male (am_*)
  { id: 'am_michael',  name: 'Michael',  region: 'us', gender: 'male' },
  { id: 'am_fenrir',   name: 'Fenrir',   region: 'us', gender: 'male' },
  { id: 'am_puck',     name: 'Puck',     region: 'us', gender: 'male' },
  { id: 'am_echo',     name: 'Echo',     region: 'us', gender: 'male' },
  { id: 'am_eric',     name: 'Eric',     region: 'us', gender: 'male' },
  { id: 'am_liam',     name: 'Liam',     region: 'us', gender: 'male' },
  { id: 'am_onyx',     name: 'Onyx',     region: 'us', gender: 'male' },
  { id: 'am_santa',    name: 'Santa',    region: 'us', gender: 'male' },
  { id: 'am_adam',     name: 'Adam',     region: 'us', gender: 'male' },

  // GB female (bf_*)
  { id: 'bf_emma',     name: 'Emma',     region: 'gb', gender: 'female' },
  { id: 'bf_isabella', name: 'Isabella', region: 'gb', gender: 'female' },
  { id: 'bf_alice',    name: 'Alice',    region: 'gb', gender: 'female' },
  { id: 'bf_lily',     name: 'Lily',     region: 'gb', gender: 'female' },

  // GB male (bm_*)
  { id: 'bm_george',   name: 'George',   region: 'gb', gender: 'male' },
  { id: 'bm_fable',    name: 'Fable',    region: 'gb', gender: 'male' },
  { id: 'bm_daniel',   name: 'Daniel',   region: 'gb', gender: 'male' },
  { id: 'bm_lewis',    name: 'Lewis',    region: 'gb', gender: 'male' },
];

/**
 * Pick a Kokoro voice for a speaker. The selection is uniform-random over
 * voices not already assigned to another speaker in the same script (so two
 * characters never sound identical). When the script's 'pin key' is the same
 * across renders, the same voice comes back -- pinning is the caller's job
 * via the pinKey + persistence layer; this function just picks given the
 * "used" set.
 */
export function pickRandomVoiceForSpeaker(
  used: ReadonlySet<string>,
  preferences?: {
    region?: 'us' | 'gb';
    gender?: 'female' | 'male';
  },
): KokoroVoice {
  // Defensive: the catalog is hard-coded above, so this should never trip;
  // bail clearly rather than indexing into an empty array if it ever does.
  if (KOKORO_VOICES.length === 0) {
    throw new Error('KOKORO_VOICES catalog is empty');
  }

  // Try the most-constrained match first. If it returns nothing (preferences
  // eliminated every candidate, or every match is already in `used`), relax
  // preferences one at a time before falling back to a fully-random pick over
  // the whole catalog. This keeps the caller's preference "best effort"
  // rather than hard-failing on an exhausted bucket.
  const ladder: Array<{ region?: 'us' | 'gb'; gender?: 'female' | 'male' }> = [
    { region: preferences?.region, gender: preferences?.gender },
    // Drop gender first -- regional accent matters more for shadowing.
    { region: preferences?.region },
    // Drop everything.
    {},
  ];

  for (const filter of ladder) {
    const pool = KOKORO_VOICES.filter(v => {
      if (filter.region && v.region !== filter.region) return false;
      if (filter.gender && v.gender !== filter.gender) return false;
      return !used.has(v.id);
    });
    if (pool.length > 0) {
      return pool[Math.floor(Math.random() * pool.length)];
    }
  }

  // Final fallback: every voice in the catalog is already in `used` (cast
  // size > catalog size, which would be 28+ speakers). Return a random voice
  // regardless of the used set -- a duplicate is preferable to throwing.
  return KOKORO_VOICES[Math.floor(Math.random() * KOKORO_VOICES.length)];
}

/**
 * Assign a voice to every speaker in a script. Speakers in `speakerIds` are
 * processed in order; each gets a random voice not already used by a
 * predecessor. Returns a Map<speakerId, KokoroVoice>.
 *
 * The caller should persist the returned mapping alongside the script so that
 * re-rendering the same script keeps the same cast (and therefore hits the
 * audio cache). pickRandomVoiceForSpeaker is non-deterministic by design --
 * pinning is a layer above this function.
 */
export function assignKokoroVoicesForCast(speakerIds: string[]): Map<string, KokoroVoice> {
  const out = new Map<string, KokoroVoice>();
  const used = new Set<string>();
  for (const id of speakerIds) {
    // Skip duplicate speakerIds: if speaker 'A' already has a voice, the
    // second occurrence reuses it (otherwise the same character would talk
    // in two voices across the script).
    if (out.has(id)) continue;
    const voice = pickRandomVoiceForSpeaker(used);
    out.set(id, voice);
    used.add(voice.id);
  }
  return out;
}
