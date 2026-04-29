// Per-script audio-cache readiness lookup for the saved-scripts table.
//
// The Now Playing readiness bar already shows what's cached for the actively-
// loaded script, but the saved-scripts table needs the same answer for every
// row -- "how much of THIS script's audio is ready on each engine?" We can't
// reuse the player's local readiness state because (a) the player only
// computes for the active script, and (b) the per-row readiness must use the
// voices that script would actually play with, which depends on global pins
// + per-script Kokoro persistence + the user's account voices for ElevenLabs.
//
// We deliberately keep this approximate rather than reproducing every branch
// of the player's voice resolution:
//   * If the user has a global pin for a speaker, we use that voice id.
//   * Otherwise for Kokoro we read the per-script localStorage map the
//     player writes on first play, falling back to "unknown" (counted as
//     not-ready) when neither is set.
//   * For ElevenLabs API without a pin, we count the speaker as not-ready
//     because the auto-assigned voice depends on the user's API account
//     state and isn't persisted. This matches the user's intent: the
//     "5/5 ✓" badge only makes sense when the cast is locked in via pins.
// The IDB lookups are cheap (one get per (provider, line, voice) tuple);
// for a typical 6-line script across three providers that's 18 reads.

import type { ShadowScript, TTSProviderId } from '../../../common/types';
import { getCached } from '../../../common/tts/audioCache';
import { fetchAvailableVoices as fetchElevenLabsApiVoices } from '../../../common/tts/elevenlabsApi';

const SPEAKER_VOICE_PIN_PREFIX = 'scroll-learn:speaker-voice:';
const KOKORO_VOICES_KEY_PREFIX = 'scroll-learn:kokoro-voices:';

function loadSpeakerVoicePins(providerId: TTSProviderId): Record<string, string> {
  try {
    const raw = localStorage.getItem(SPEAKER_VOICE_PIN_PREFIX + providerId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch { return {}; }
}

function loadKokoroPerScriptMap(scriptId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(KOKORO_VOICES_KEY_PREFIX + scriptId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch { return {}; }
}

export interface ProviderReadiness {
  ready: number;
  total: number;
}

export interface ScriptReadiness {
  elevenlabsApi: ProviderReadiness;
  kokoroApi: ProviderReadiness;
  kokoroLocal: ProviderReadiness;
}

/**
 * Build the speaker -> voice-id map ElevenLabs API would use for this
 * script, mirroring the player's logic in ShadowPlayer:
 *   1. Pin from localStorage if set.
 *   2. Otherwise round-robin through the user's API voices
 *      (`fetchAvailableVoices()`), in the SAME order the player iterates
 *      over speakers (script.lines's first-seen order).
 * The fetch is cached for 5 min inside elevenlabsApi.ts so multiple scripts
 * in the table share one round-trip.
 */
async function resolveElevenLabsApiVoiceMap(script: ShadowScript): Promise<Map<string, string>> {
  const pins = loadSpeakerVoicePins('elevenlabs-api');
  const speakers: string[] = [];
  const seen = new Set<string>();
  for (const line of script.lines) {
    if (!seen.has(line.speaker)) {
      seen.add(line.speaker);
      speakers.push(line.speaker);
    }
  }
  const map = new Map<string, string>();
  let apiVoices: { voice_id: string }[] | null = null;
  for (let i = 0; i < speakers.length; i++) {
    const spk = speakers[i];
    const pinned = pins[spk];
    if (pinned) {
      map.set(spk, pinned);
      continue;
    }
    if (apiVoices === null) {
      apiVoices = await fetchElevenLabsApiVoices();
    }
    if (apiVoices.length > 0) {
      map.set(spk, apiVoices[i % apiVoices.length].voice_id);
    }
  }
  return map;
}

/**
 * Compute audio-cache readiness for one script across all cacheable
 * providers. Returns {ready, total} for each engine where `ready` is the
 * count of lines whose voice id is known AND whose blob is in IDB. The
 * voice resolution mirrors the player so the table matches the Now Playing
 * readiness bar.
 */
export async function computeScriptReadiness(script: ShadowScript): Promise<ScriptReadiness> {
  const total = script.lines.length;

  // Both Kokoro variants use the kokoro-api pin namespace AND share the
  // per-script localStorage Kokoro map -- ShadowPlayer's effect always
  // reads `loadSpeakerVoicePins('kokoro-api')` regardless of which Kokoro
  // engine is active, so we mirror that here.
  const kokoroPins = loadSpeakerVoicePins('kokoro-api');
  const perScriptKokoro = loadKokoroPerScriptMap(script.id);
  const elMap = await resolveElevenLabsApiVoiceMap(script);

  let elReady = 0;
  let kkReady = 0;
  let klReady = 0;

  for (const line of script.lines) {
    // ElevenLabs API: pin > round-robin through the user's API voices.
    const elVoice = elMap.get(line.speaker);
    if (elVoice) {
      const hit = await getCached({ providerId: 'elevenlabs-api', voice: elVoice, text: line.text });
      if (hit) elReady++;
    }
    // Kokoro API: pin (under 'kokoro-api') > per-script persisted random.
    const kokoroVoice = kokoroPins[line.speaker] || perScriptKokoro[line.speaker];
    if (kokoroVoice) {
      const hitApi = await getCached({ providerId: 'kokoro-api', voice: kokoroVoice, text: line.text });
      if (hitApi) kkReady++;
      // Kokoro Local: same voice id as Kokoro API (the player shares the
      // catalog AND the kokoro-api pin namespace between both variants),
      // but the cache namespace is separate.
      const hitLocal = await getCached({ providerId: 'kokoro-local', voice: kokoroVoice, text: line.text });
      if (hitLocal) klReady++;
    }
  }

  return {
    elevenlabsApi: { ready: elReady, total },
    kokoroApi: { ready: kkReady, total },
    kokoroLocal: { ready: klReady, total },
  };
}
