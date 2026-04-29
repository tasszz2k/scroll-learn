// Kokoro TTS, fully in-browser via kokoro-js (Transformers.js + WASM/WebGPU).
//
// The actual inference happens in an offscreen document
// (src/offscreen/kokoroOffscreen.ts) because:
//   * Manifest V3 service workers can't host WASM/WebGPU model inference
//     reliably (no DOM, killed after 30 s idle, limited APIs).
//   * Running inference on the dashboard tab would block React renders for
//     several hundred ms per line.
//   * Offscreen documents are purpose-built for this -- no UI, no event-loop
//     starvation against the dashboard, and they self-close when idle.
//
// chrome.runtime.sendMessage can't address a specific document, so the
// dashboard sends to the background service worker, which ensures the
// offscreen exists and forwards. See src/background/index.ts for the relay.
//
// Compared to ./kokoroApi.ts:
//   * No HF token, no quota, no shared queue.
//   * One-time ~92 MB model download from the HF CDN; the browser caches it
//     thereafter.
//   * WebGPU when available (~3x faster than realtime), WASM otherwise.
//   * Only English voices ship in the model -- same KOKORO_VOICES catalog.

import type { TTSProvider, TTSSpeakRequest } from './index';
import type { SpeakLineHandle } from '../speak';
import { speakLine } from '../speak';
import { getCached, putCached } from './audioCache';
import { base64ToAudioBlob, playAudioBlob } from './playback';

const PROVIDER_ID = 'kokoro-local' as const;
const DEFAULT_VOICE = 'af_heart';
// Outer safety net. Real per-line latency is ~1-2 s on WebGPU and ~3-15 s on
// WASM; allow plenty of headroom for the first request which also pays the
// model-load cost (5-15 s once, then cached on disk by the browser).
const HARD_TIMEOUT_MS = 90_000;

interface SynthSuccess {
  ok: true;
  audioBase64: string;
  mime: string;
  sampleRate: number;
  durationSec: number;
}

interface SynthFailure {
  ok: false;
  error: string;
}

type SynthResponse = SynthSuccess | SynthFailure;

function fallbackToWebSpeech(req: TTSSpeakRequest): SpeakLineHandle {
  return speakLine(req.text, {
    rate: req.rate,
    pitch: req.pitch,
    onBoundary: req.onBoundary,
    onEnd: req.onEnd,
    onError: req.onError ? (ev) => req.onError?.(new Error(ev.error || 'speech error')) : undefined,
  });
}

function notify(req: TTSSpeakRequest, stage: Parameters<NonNullable<TTSSpeakRequest['onStatus']>>[0], detail?: { message?: string }): void {
  if (!req.onStatus) return;
  try { req.onStatus(stage, detail); } catch { /* listener errors are not fatal */ }
}

async function synthViaOffscreen(text: string, voice: string, signal: AbortSignal): Promise<SynthResponse> {
  // The background relay creates the offscreen document on first use and
  // forwards us the offscreen's reply. We pass a unique reqId so a future
  // version can multiplex without changing the wire format.
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const message = { type: 'kokoro_local_synth', reqId, text, voice };

  return new Promise<SynthResponse>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    chrome.runtime
      .sendMessage(message)
      .then((reply: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (!reply || typeof reply !== 'object') {
          reject(new Error('Empty reply from kokoro-local offscreen.'));
          return;
        }
        const r = reply as Partial<SynthSuccess> & Partial<SynthFailure>;
        if (r.ok === true && typeof r.audioBase64 === 'string') {
          resolve({
            ok: true,
            audioBase64: r.audioBase64,
            mime: r.mime || 'audio/wav',
            sampleRate: r.sampleRate ?? 24_000,
            durationSec: r.durationSec ?? 0,
          });
        } else if (r.ok === false) {
          resolve({ ok: false, error: r.error || 'kokoro-local synth failed without an error message' });
        } else {
          reject(new Error(`Unexpected kokoro-local reply: ${JSON.stringify(reply).slice(0, 200)}`));
        }
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

interface PipelineState {
  stopped: boolean;
  playbackHandle: SpeakLineHandle | null;
  abort: AbortController;
}

export const kokoroLocalProvider: TTSProvider = {
  id: PROVIDER_ID,
  label: 'Kokoro TTS (in-browser, free)',
  description: 'Runs Kokoro-82M locally via WebGPU/WASM. No API key, no quota.',
  longDescription:
    "Renders Kokoro-82M directly in the browser using kokoro-js. The first line of your first session downloads the model (~92 MB, cached after that); subsequent lines render in ~1-2 s on WebGPU or ~3-15 s on WASM. No Hugging Face token, no shared queue, no daily quota -- the audio never leaves your machine. Falls back to Web Speech if the offscreen document fails to load.",
  cacheable: true,

  async isReady() {
    // Offscreen API is the signal we need. host_permission to huggingface.co
    // (already granted via <all_urls> in manifest) lets the model fetch
    // succeed; the runtime can fail-open to Web Speech if either is missing.
    if (typeof chrome === 'undefined' || !chrome.offscreen) return false;
    return true;
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
    state.playbackHandle = fallbackToWebSpeech(req);
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

  const cached = await getCached(cacheKey);
  if (state.stopped) return;
  if (cached) {
    notify(req, 'done', { message: 'cache hit' });
    state.playbackHandle = playAudioBlob(cached.blob, {
      rate: req.rate,
      onEnd: req.onEnd,
      onError: req.onError,
    });
    return;
  }

  notify(req, 'opening');
  // Hard outer timeout aborts the offscreen request if it stalls.
  const timeoutId = setTimeout(() => {
    try { state.abort.abort(); } catch { /* ignore */ }
  }, HARD_TIMEOUT_MS);

  try {
    notify(req, 'capturing');
    const result = await synthViaOffscreen(req.text, voice, state.abort.signal);
    if (state.stopped) return;
    if (!result.ok) {
      throw new Error(result.error);
    }

    const blob = base64ToAudioBlob(result.audioBase64, result.mime);
    void putCached(cacheKey, blob, result.mime);

    notify(req, 'done');
    state.playbackHandle = playAudioBlob(blob, {
      rate: req.rate,
      onEnd: req.onEnd,
      onError: req.onError,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
