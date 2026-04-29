// Pluggable TTS layer for the Shadow player. Three providers are wired:
// the always-on Web Speech fallback, ElevenLabs via the official HTTP API
// (./elevenlabsApi.ts), and Kokoro-TTS via the HuggingFace Space's Gradio
// queue API (./kokoroApi.ts). Both cloud providers cache their generated
// audio in IndexedDB via ./audioCache.ts so replays never re-spend credits.

import type { TTSJobStage, TTSProviderId } from '../types';
import {
  getEnglishVoices,
  speakLine,
  type SpeakLineHandle,
  type SpeakLineOptions,
} from '../speak';
import { elevenlabsApiProvider } from './elevenlabsApi';
import { kokoroApiProvider } from './kokoroApi';
import { kokoroLocalProvider } from './kokoroLocal';

// Resolve a voiceHint string to a SpeechSynthesisVoice. For web-speech the
// hint is the voice .name (e.g., "Samantha", "Daniel (Enhanced)"); we look it
// up via the cached voices list and return null when there's no match (caller
// gets the system default).
async function resolveWebSpeechVoice(voiceHint: string | null | undefined) {
  if (!voiceHint) return null;
  const voices = await getEnglishVoices();
  return voices.find(v => v.name === voiceHint) ?? null;
}

export interface TTSSpeakRequest {
  text: string;
  voiceHint?: string | null;     // Provider-specific voice id / language tag
  rate: number;                  // 0.5 - 1.5
  pitch: number;                 // 0.5 - 2 (only meaningful for web-speech)
  // Same semantics as speak.ts -- best-effort word boundary callback. Real
  // cloud providers may not surface boundaries; in that case the player
  // simply skips word-level highlighting for non-web-speech engines.
  onBoundary?: SpeakLineOptions['onBoundary'];
  onEnd?: () => void;
  onError?: (err: Error) => void;
  // Cloud providers emit status updates (opening, configuring, capturing,
  // queued with position N, etc.) while the async pipeline runs. Web Speech
  // doesn't emit anything. The player surfaces these via a per-line pill.
  onStatus?: (stage: TTSJobStage, detail?: { message?: string; queuePosition?: number }) => void;
  // Provider-specific credit count. ElevenLabs surfaces remaining monthly
  // quota via GET /v1/user/subscription; Kokoro is free and never reports.
  onCreditsRemaining?: (n: number) => void;
}

export interface TTSProvider {
  readonly id: TTSProviderId;
  // Short label for the dropdown.
  readonly label: string;
  // One-line user-facing summary (shown next to the dropdown).
  readonly description: string;
  // 2-3 sentence elaboration shown when the picker is expanded or when the
  // provider isn't ready. Aimed at the learner, not the developer.
  readonly longDescription: string;
  // Whether this provider produces a Blob that can be cached in IndexedDB
  // for instant replay. Web Speech speaks live and has no Blob; cloud
  // providers do.
  readonly cacheable: boolean;
  // True when this provider can actually render audio in the current
  // environment. False forces the caller to fall back.
  isReady(): Promise<boolean>;
  speak(req: TTSSpeakRequest): SpeakLineHandle;
}

// ----------------------------------------------------------------------------
// Web Speech
// ----------------------------------------------------------------------------
const webSpeechProvider: TTSProvider = {
  id: 'web-speech',
  label: 'Web Speech (browser, free)',
  description: 'Always-on fallback. Free, offline, quality varies by OS.',
  longDescription:
    'Uses the speech engine your operating system already ships with. macOS Samantha sounds natural; Chrome on Linux is more robotic. Always available, never queued, never throttled, never costs credits.',
  cacheable: false,
  async isReady() {
    return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
  },
  // The web-speech speak() needs to look up the SpeechSynthesisVoice from
  // voiceHint asynchronously, but the TTSProvider contract returns
  // SpeakLineHandle synchronously so the player can stop() mid-utterance.
  // Resolution: kick off an async resolve, store the resulting handle, and
  // forward stop() to whichever underlying handle is live.
  speak(req) {
    let live: SpeakLineHandle | null = null;
    let stopped = false;
    void (async () => {
      const voice = await resolveWebSpeechVoice(req.voiceHint);
      if (stopped) return;
      live = speakLine(req.text, {
        voice,
        rate: req.rate,
        pitch: req.pitch,
        onBoundary: req.onBoundary,
        onEnd: req.onEnd,
        onError: req.onError ? (ev) => req.onError?.(new Error(ev.error || 'speech error')) : undefined,
      });
    })();
    return {
      stop: () => {
        stopped = true;
        if (live) {
          try { live.stop(); } catch { /* ignore */ }
          live = null;
        }
      },
    };
  },
};

// Order: cloud providers first (best quality), then the in-browser Kokoro
// (no quota, but a one-time model download) and finally the always-on Web
// Speech fallback. pickReadyProvider walks this list when the saved
// preference isn't ready, and Web Speech is universally ready so it sits at
// the end as the guaranteed-final fallback.
export const TTS_PROVIDERS: TTSProvider[] = [
  elevenlabsApiProvider,
  kokoroApiProvider,
  kokoroLocalProvider,
  webSpeechProvider,
];

export function getTTSProvider(id: TTSProviderId): TTSProvider {
  return TTS_PROVIDERS.find(p => p.id === id) ?? webSpeechProvider;
}

// Resolve the highest-priority provider that's actually ready right now.
// Used by the player to pick a sensible default for first-time visitors.
export async function pickReadyProvider(preferred?: TTSProviderId): Promise<TTSProvider> {
  if (preferred) {
    const p = getTTSProvider(preferred);
    if (await p.isReady()) return p;
  }
  for (const p of TTS_PROVIDERS) {
    if (await p.isReady()) return p;
  }
  return webSpeechProvider;
}
