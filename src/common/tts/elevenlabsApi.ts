// ElevenLabs TTS via the official HTTP API (api.elevenlabs.io). The user
// supplies a free API key in Settings; we POST text + voice + model and the
// /with-timestamps endpoint returns JSON containing audio_base64 plus per-
// character alignment. We decode the audio to a Blob, persist it (and the
// alignment when valid) in IDB, then play it back through playAudioBlob with
// the alignment so the player can drive its word-level karaoke highlight.
//
// Why this exists alongside ./elevenlabs.ts: the browser-automation provider
// rides the user's logged-in session cookie so no key management is needed,
// but capturing the rendered audio out of the page proved unreliable across
// hooks (fetch, XHR, MediaSource, decodeAudioData, audio.src setter). The
// API path bypasses every one of those edge cases at the cost of asking the
// learner to paste a key once. Same monthly free quota (~10k credits on
// Flash v2.5), same voices, ~50 LOC.
//
// Pipeline:
//   1. Cache check (IDB). On hit, short-circuit to playAudioBlob, replaying
//      the persisted alignment when present.
//   2. POST /v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128
//      Body: { text, model_id: 'eleven_flash_v2_5' }
//      Header: xi-api-key: <user key>
//   3. Parse JSON { audio_base64, alignment }, decode the audio, persist
//      Blob + alignment in IDB, play.
// Any failure falls back to Web Speech so the line still plays. The error
// surfaces via onStatus so the player's pill shows what went wrong.

import type { TTSProvider, TTSSpeakRequest } from './index';
import { fallbackChain } from './index';
import type { TTSJobStage } from '../types';
import { STORAGE_KEYS } from '../types';
import type { SpeakLineHandle } from '../speak';
import type { AudioAlignment } from './audioCache';
import { getCached, putCached } from './audioCache';
import { playAudioBlob, base64ToAudioBlob } from './playback';

const PROVIDER_ID = 'elevenlabs-api' as const;
const API_BASE = 'https://api.elevenlabs.io';
// Lock the model the same way the browser path does. Flash v2.5 bills at
// ~0.5 credits/character vs ~1 for Multilingual v2 / v3, so the free 10k
// credits cover ~20k characters of audio. If we ever surface a model picker
// in Settings, change this default but keep Flash as the safe fallback.
const MODEL_ID = 'eleven_flash_v2_5';
// The default voice id when the caller doesn't pass one. Rachel is in every
// free-tier account's default voice library.
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM';
// MP3 44.1kHz 128kbps is the highest-quality format the free tier supports
// for non-Multilingual models. Flash v2.5 is fine with it.
const OUTPUT_FORMAT = 'mp3_44100_128';
// Outer safety net. The actual /v1/text-to-speech round-trip on Flash is
// well under a second for a typical line, so anything past 60s is broken.
const HARD_TIMEOUT_MS = 60_000;

// Shape returned by /v1/text-to-speech/{voice}/with-timestamps. ElevenLabs
// can normalise input text (e.g. expanding "Mr." to "Mister"), in which case
// `characters.length` no longer matches `req.text.length`; the helper below
// drops alignment in that case so playback degrades gracefully.
interface TimestampsResponse {
  audio_base64?: unknown;
  alignment?: {
    characters?: unknown;
    character_start_times_seconds?: unknown;
    character_end_times_seconds?: unknown;
  };
}

/**
 * Decode the JSON returned by the with-timestamps endpoint into a Blob plus
 * (when the alignment lines up exactly with the requested text) per-character
 * start times. Pure so tests can pin the parse logic without booting the
 * full pipeline.
 */
export function parseTimestampsResponse(
  json: unknown,
  text: string,
  mime: string = 'audio/mpeg',
): { blob: Blob; alignment?: AudioAlignment } {
  const data = (json ?? {}) as TimestampsResponse;
  const audioBase64 = typeof data.audio_base64 === 'string' ? data.audio_base64 : '';
  if (!audioBase64) {
    throw new Error('ElevenLabs API returned no audio_base64 payload.');
  }
  const blob = base64ToAudioBlob(audioBase64, mime);

  const alignment = data.alignment;
  if (!alignment) return { blob };

  const characters = Array.isArray(alignment.characters) ? alignment.characters : null;
  const startTimes = Array.isArray(alignment.character_start_times_seconds)
    ? alignment.character_start_times_seconds
    : null;
  if (!characters || !startTimes) return { blob };
  // Drop alignment when ElevenLabs normalised the input. The player then
  // falls back to the static-highlight behaviour we shipped originally.
  if (characters.length !== text.length) return { blob };
  if (startTimes.length !== text.length) return { blob };

  const charStartTimesSec: number[] = [];
  for (const t of startTimes) {
    if (typeof t !== 'number' || !Number.isFinite(t)) return { blob };
    charStartTimesSec.push(t);
  }
  return { blob, alignment: { charStartTimesSec } };
}

/**
 * Translate a non-200 response into the user-facing error message the player
 * pill shows. Pulls the existing 401 / 402 / generic logic out of the
 * pipeline so the test can pin it without mocking the full fetch round-trip.
 */
export function parseElevenLabsErrorMessage(
  status: number,
  statusText: string,
  body: string,
): string {
  let detail = body.slice(0, 240);
  try {
    const parsed = JSON.parse(body) as { detail?: { message?: string; status?: string } | string };
    if (parsed.detail) {
      detail = typeof parsed.detail === 'string'
        ? parsed.detail
        : (parsed.detail.message || JSON.stringify(parsed.detail).slice(0, 240));
    }
  } catch { /* not JSON, leave the raw slice */ }
  // Specialised guidance for the most common free-tier failure mode:
  // library voices (Rachel, Adam, Bella, ...) are paywalled via API.
  // The user needs to "Add to library" the voice they want once at
  // elevenlabs.io/app/voice-library and we should pick it up via the
  // /v1/voices auto-discovery path.
  if (status === 402 && /library voice|upgrade/i.test(detail)) {
    return 'ElevenLabs free-tier API can\'t use the public library voices. Open elevenlabs.io/app/voice-library, click "Add" on a voice you want, then retry. The new voice will appear automatically in the player.';
  }
  if (status === 401) {
    return 'ElevenLabs API key was rejected. Check Settings -- the key may be invalid, revoked, or missing the "Text to Speech" / "Voices: Read" / "Models: Access" permissions.';
  }
  return `ElevenLabs API ${status} ${statusText}: ${detail}`;
}

async function getApiKey(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return '';
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const settings = result[STORAGE_KEYS.SETTINGS] as { elevenLabsApiKey?: string } | undefined;
    return (settings?.elevenLabsApiKey ?? '').trim();
  } catch {
    return '';
  }
}

// A voice as ElevenLabs returns it from GET /v1/voices. Only the fields the
// player needs are typed; ElevenLabs returns many more (samples, settings,
// fine_tuning, etc.) but we ignore them.
export interface ElevenLabsApiVoice {
  voice_id: string;
  name: string;
  category?: string;             // 'cloned' | 'premade' | 'professional' | 'generated'
  labels?: { gender?: string; accent?: string; description?: string };
}

interface VoicesCache {
  voices: ElevenLabsApiVoice[];
  fetchedAt: number;
}

let voicesCache: VoicesCache | null = null;
const VOICES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min -- voices rarely change

/**
 * Fetch the voices the user's API key actually has access to. Free-tier API
 * users can only use voices they've added to their personal account (the
 * curated library at elevenlabs.io is paywalled via API), so the player
 * needs to discover this list dynamically rather than rely on the hardcoded
 * elevenLabsVoices catalog.
 *
 * Cached for VOICES_CACHE_TTL_MS so the readiness scan and the player's
 * per-line speak() don't hammer the endpoint.
 */
export async function fetchAvailableVoices(): Promise<ElevenLabsApiVoice[]> {
  const key = await getApiKey();
  if (!key) return [];
  if (voicesCache && Date.now() - voicesCache.fetchedAt < VOICES_CACHE_TTL_MS) {
    return voicesCache.voices;
  }
  try {
    const res = await fetch(`${API_BASE}/v1/voices`, {
      headers: {
        'xi-api-key': key,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = await res.json() as { voices?: ElevenLabsApiVoice[] };
    const voices = Array.isArray(data.voices) ? data.voices : [];
    voicesCache = { voices, fetchedAt: Date.now() };
    return voices;
  } catch {
    return [];
  }
}

// Exposed so a settings change (new API key) can flush the cache.
export function clearVoicesCache(): void {
  voicesCache = null;
}

// Subscription state: tracked locally so we can compute "credits left"
// accurately. ElevenLabs does NOT include remaining quota in the
// /v1/text-to-speech response headers (only the `character-cost` of the
// individual request), so the only authoritative source is GET
// /v1/user/subscription. We fetch that once on first speak() and decrement
// `used` by `character-cost` after every successful generation. A periodic
// re-fetch covers cases where the user spent characters elsewhere (e.g.,
// the website) since our session started.
interface SubscriptionState {
  characterCount: number;       // chars used this billing window
  characterLimit: number;       // monthly cap
  fetchedAt: number;
}
let subscriptionState: SubscriptionState | null = null;
const SUBSCRIPTION_REFETCH_MS = 5 * 60 * 1000; // 5 min

// Some ElevenLabs API keys are scoped to text_to_speech only and don't carry
// the user_read permission needed by /v1/user/subscription. Without backoff
// every speak() retried the probe and spammed the devtools console with 401s.
// We cache an "unavailable" sentinel here, keyed by the API key string, so a
// scoped key fails once and is skipped afterwards. clearSubscriptionCache
// resets it when the user pastes a new key.
let unavailableForKey: string | null = null;
let unavailableUntil = 0;
// Long enough to suppress the console spam, short enough that a key whose
// scope changes server-side eventually re-probes.
const SUBSCRIPTION_UNAVAILABLE_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 h

async function refreshSubscription(force = false): Promise<SubscriptionState | null> {
  const key = await getApiKey();
  if (!key) return null;
  // Same key keeps 401-ing -- skip the call. A `force` flush (paste new key
  // in Settings) clears unavailableForKey via clearSubscriptionCache.
  if (
    !force
    && unavailableForKey === key
    && Date.now() < unavailableUntil
  ) {
    return null;
  }
  if (
    !force
    && subscriptionState
    && Date.now() - subscriptionState.fetchedAt < SUBSCRIPTION_REFETCH_MS
  ) {
    return subscriptionState;
  }
  try {
    const res = await fetch(`${API_BASE}/v1/user/subscription`, {
      headers: { 'xi-api-key': key, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      // 401 here typically means the key lacks user_read scope (ElevenLabs
      // free tier lets you create keys scoped to TTS only). Mark as
      // unavailable so the next speak() doesn't retry and re-spam the
      // console.
      if (res.status === 401 || res.status === 403) {
        unavailableForKey = key;
        unavailableUntil = Date.now() + SUBSCRIPTION_UNAVAILABLE_BACKOFF_MS;
      }
      return subscriptionState;
    }
    const data = await res.json() as {
      character_count?: number;
      character_limit?: number;
    };
    if (typeof data.character_count !== 'number' || typeof data.character_limit !== 'number') {
      return subscriptionState;
    }
    subscriptionState = {
      characterCount: data.character_count,
      characterLimit: data.character_limit,
      fetchedAt: Date.now(),
    };
    return subscriptionState;
  } catch {
    return subscriptionState;
  }
}

function remainingFromState(state: SubscriptionState | null): number | null {
  if (!state) return null;
  const remaining = state.characterLimit - state.characterCount;
  return Number.isFinite(remaining) ? Math.max(0, remaining) : null;
}

// Lets callers force a refetch (e.g., when the user pastes a new API key).
// Also flushes the "scope-locked, don't retry" flag so a fresh key gets a
// real probe instead of inheriting the previous key's verdict.
export function clearSubscriptionCache(): void {
  subscriptionState = null;
  unavailableForKey = null;
  unavailableUntil = 0;
}

/**
 * Public entry point for the player to render the credits pill BEFORE the
 * first generation. Reads the cached state if fresh, otherwise hits
 * /v1/user/subscription. Returns null when no API key is set or the request
 * fails (the player simply hides the pill in that case).
 */
export async function getRemainingCredits(force = false): Promise<number | null> {
  const state = await refreshSubscription(force);
  return remainingFromState(state);
}

function notify(
  req: TTSSpeakRequest,
  stage: TTSJobStage,
  detail?: { message?: string; queuePosition?: number },
): void {
  if (!req.onStatus) return;
  try { req.onStatus(stage, detail); } catch { /* listener errors are not fatal */ }
}

interface PipelineState {
  stopped: boolean;
  playbackHandle: SpeakLineHandle | null;
  abort: AbortController;
}

export const elevenlabsApiProvider: TTSProvider = {
  id: PROVIDER_ID,
  label: 'ElevenLabs (API key)',
  description: 'Direct api.elevenlabs.io. Needs a free API key in Settings. Flash v2.5 model.',
  longDescription:
    "Talks directly to api.elevenlabs.io with a user-supplied API key. The response body IS the audio. Flash v2.5 model, free tier ~10k monthly credits (about 20k characters at 0.5 credits each). Cached audio replays for free.",
  cacheable: true,

  async isReady() {
    const key = await getApiKey();
    return key.length > 0;
  },

  speak(req): SpeakLineHandle {
    return startSpeak(req);
  },
};

function startSpeak(req: TTSSpeakRequest): SpeakLineHandle {
  const state: PipelineState = {
    stopped: false,
    playbackHandle: null,
    abort: new AbortController(),
  };

  void runPipeline(req, state).catch((err) => {
    if (state.stopped) return;
    const message = err instanceof Error ? err.message : String(err);
    notify(req, 'error', { message });
    if (req.onError) {
      try { req.onError(err instanceof Error ? err : new Error(message)); } catch { /* ignore */ }
    }
    state.playbackHandle = fallbackChain(PROVIDER_ID, req);
  });

  return {
    stop: () => {
      if (state.stopped) return;
      state.stopped = true;
      try { state.abort.abort(); } catch { /* ignore */ }
      if (state.playbackHandle) {
        try { state.playbackHandle.stop(); } catch { /* ignore */ }
      }
    },
  };
}

async function runPipeline(req: TTSSpeakRequest, state: PipelineState): Promise<void> {
  const voice = (req.voiceHint || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
  const cacheKey = { providerId: PROVIDER_ID, voice, text: req.text };

  // (a) Cache hit -- play directly, no round-trip needed. Forward the
  // persisted alignment when present so the player can drive karaoke; older
  // cache entries (pre-Phase-2) simply have no alignment and play with the
  // static-highlight behaviour we shipped originally.
  const cached = await getCached(cacheKey);
  if (state.stopped) return;
  if (cached) {
    notify(req, 'done', { message: 'cache hit' });
    state.playbackHandle = playAudioBlob(cached.blob, {
      rate: req.rate,
      onEnd: req.onEnd,
      onError: req.onError,
      ...(cached.alignment ? { alignment: cached.alignment, text: req.text, onBoundary: req.onBoundary } : {}),
    });
    return;
  }

  // (b) Cache miss -- POST and stream the response.
  notify(req, 'opening');
  const key = await getApiKey();
  if (!key) {
    throw new Error('ElevenLabs API key not set. Add a key in Settings.');
  }

  const timeoutId = setTimeout(() => {
    try { state.abort.abort(); } catch { /* ignore */ }
  }, HARD_TIMEOUT_MS);

  try {
    notify(req, 'submitting');
    // /with-timestamps returns JSON { audio_base64, alignment }; the
    // character-cost response header still works on this endpoint, so
    // credits accounting below is unchanged.
    const url = `${API_BASE}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=${OUTPUT_FORMAT}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'xi-api-key': key,
      },
      body: JSON.stringify({
        text: req.text,
        model_id: MODEL_ID,
      }),
      signal: state.abort.signal,
    });
    if (!res.ok) {
      // Pull the error body for diagnostics. ElevenLabs returns JSON
      // {"detail": {"status": "...", "message": "..."}} on 4xx.
      const body = await res.text().catch(() => '');
      throw new Error(parseElevenLabsErrorMessage(res.status, res.statusText, body));
    }

    notify(req, 'capturing');
    // Read character-cost BEFORE consuming the body so it's still on the
    // headers object. The cost is per-request char count -- not the
    // remaining balance. We use it to decrement our locally-cached
    // subscription state below.
    const costHeader = res.headers.get('character-cost');
    const requestCost = costHeader != null ? Number(costHeader) : 0;
    const json = await res.json().catch(() => null);
    if (state.stopped) return;
    const mime = 'audio/mpeg';
    const { blob, alignment } = parseTimestampsResponse(json, req.text, mime);
    if (blob.size === 0) {
      throw new Error('ElevenLabs API returned empty audio.');
    }

    void putCached(cacheKey, blob, mime, alignment);

    // Accurate remaining credits calc:
    //   1. Ensure we have a subscription snapshot. First call fetches via
    //      GET /v1/user/subscription; subsequent calls within 5 min reuse
    //      the cached state so we don't add latency to every generation.
    //   2. Decrement the cached characterCount by THIS request's cost so
    //      the next pill update reflects the spend immediately.
    //   3. Forward the resulting remaining number via onCreditsRemaining.
    void (async () => {
      let snap = await refreshSubscription();
      if (snap && Number.isFinite(requestCost) && requestCost > 0) {
        snap = {
          ...snap,
          characterCount: Math.min(snap.characterLimit, snap.characterCount + requestCost),
        };
        subscriptionState = snap;
      }
      const remaining = remainingFromState(snap);
      if (remaining != null && req.onCreditsRemaining) {
        try { req.onCreditsRemaining(remaining); } catch { /* ignore */ }
      }
    })();

    notify(req, 'done');
    state.playbackHandle = playAudioBlob(blob, {
      rate: req.rate,
      onEnd: req.onEnd,
      onError: req.onError,
      ...(alignment ? { alignment, text: req.text, onBoundary: req.onBoundary } : {}),
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
