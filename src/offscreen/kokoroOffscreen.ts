// In-browser Kokoro TTS host. Lives in a Manifest V3 offscreen document so
// the inference can use WASM / WebGPU and the DOM-bound APIs that the
// service worker can't reach. The dashboard's `kokoro-local` provider sends
// a synthesis request via the background relay (because chrome.runtime
// can't address a specific document); we reply with base64 audio bytes.
//
// Lifecycle
//   * The model is loaded lazily on the first request and cached for
//     subsequent ones in the same offscreen lifetime.
//   * After IDLE_CLOSE_MS of no new requests we ask the background to close
//     the document. The service worker recreates it on the next request.
//     This keeps RAM near zero when idle while still amortising the model
//     load across bursts.
//
// Messaging contract
//   in:  { type: 'kokoro_local_synth', target: 'offscreen', reqId, text, voice }
//   out: { ok: true, audioBase64, mime, sampleRate, durationSec } via
//        sendResponse OR { ok: false, error }
//   close-self: { type: 'kokoro_local_close', target: 'background' }
//
// The 4-character "ok" boolean is critical: callers throw when ok is false so
// the Shadow player falls back to Web Speech and the line still plays.

import { KokoroTTS, env, type GenerateOptions } from 'kokoro-js';
// ONNX Runtime Web ships its WASM/JS backend as a separate .mjs+.wasm pair
// that it normally fetches dynamically from cdn.jsdelivr.net at first use.
// Manifest V3's CSP (script-src 'self' 'wasm-unsafe-eval') blocks remote
// modules, so the dynamic import fails with
//   "Failed to fetch dynamically imported module: https://cdn.jsdelivr.net/
//   npm/@huggingface/transformers@.../ort-wasm-simd-threaded.jsep.mjs".
// We ship copies of the .mjs and .wasm via public/onnx/ -- crxjs copies
// public/ verbatim into dist/, so chrome.runtime.getURL resolves to an
// extension-origin URL the CSP allows.

env.wasmPaths = {
  wasm: chrome.runtime.getURL('onnx/ort-wasm-simd-threaded.jsep.wasm'),
  mjs: chrome.runtime.getURL('onnx/ort-wasm-simd-threaded.jsep.mjs'),
};

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
// dtype must match the device's supported precision -- a mismatch loads the
// wrong ONNX weights and produces garbled, non-English output even though
// the pipeline reports success.
//   * WebGPU runs the fp32 weights at native precision (~326 MB one-time
//     download) for full audio quality. WASM can technically load fp32 but
//     it's far slower than q8 with no quality win at this model size.
//   * WASM uses q8 (~92 MB), the smallest variant that still sounds natural.
//     q4 is smaller but introduces audible artefacts on consonants.
type LoadDevice = 'webgpu' | 'wasm';
type Dtype = 'q8' | 'q4' | 'q4f16' | 'fp16' | 'fp32';
const DTYPE_FOR_DEVICE: Record<LoadDevice, Dtype> = {
  webgpu: 'fp32',
  wasm: 'q8',
};
// 60 s of inactivity ~= a long pause between regen runs. Short enough that
// the user gets back the RAM during normal idling, long enough that
// back-to-back lines (which the player fires in sequence) don't keep
// reloading the model.
const IDLE_CLOSE_MS = 60_000;

let ttsPromise: Promise<KokoroTTS> | null = null;
let activeDevice: LoadDevice | null = null;
let activeDtype: Dtype | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

interface SynthRequest {
  type: 'kokoro_local_synth';
  target: 'offscreen';
  reqId: string;
  text: string;
  voice: string;
}

interface SynthResult {
  ok: true;
  audioBase64: string;
  mime: string;
  sampleRate: number;
  durationSec: number;
}

interface SynthError {
  ok: false;
  error: string;
}

function isSynthRequest(msg: unknown): msg is SynthRequest {
  return Boolean(
    msg &&
      typeof msg === 'object' &&
      (msg as { type?: unknown }).type === 'kokoro_local_synth' &&
      (msg as { target?: unknown }).target === 'offscreen',
  );
}

async function pickDevice(): Promise<LoadDevice> {
  // navigator.gpu is the canonical WebGPU feature flag. Even when present we
  // request a real adapter to confirm there's a usable backend (some Linux/
  // older-Chrome setups have navigator.gpu but no adapter).
  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  if (nav.gpu?.requestAdapter) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch {
      /* fall through to wasm */
    }
  }
  return 'wasm';
}

function loadTts(): Promise<KokoroTTS> {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    const device = await pickDevice();
    const dtype = DTYPE_FOR_DEVICE[device];
    activeDevice = device;
    activeDtype = dtype;
    console.log('[scroll-learn][kokoro-local] loading model', { device, dtype });
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype, device });
    console.log('[scroll-learn][kokoro-local] model loaded');
    return tts;
  })();
  ttsPromise.catch((err) => {
    console.warn('[scroll-learn][kokoro-local] model load failed; will retry next request', err);
    // Reset so the next request triggers a fresh load (e.g. WebGPU was lost
    // and the next call should retry on WASM).
    ttsPromise = null;
    activeDevice = null;
    activeDtype = null;
  });
  return ttsPromise;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  // Chunk the conversion to avoid the per-call argument-count limit on
  // String.fromCharCode (~64k) for long utterances.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

async function synth(req: SynthRequest): Promise<SynthResult> {
  const tts = await loadTts();
  // kokoro-js types the voice as a literal union (keyof typeof VOICES);
  // we let the runtime check the id since our caller resolves it from the
  // KOKORO_VOICES catalog which mirrors that exact set.
  const opts: GenerateOptions = { voice: req.voice as GenerateOptions['voice'] };
  const out = await tts.generate(req.text, opts);
  const wavBuffer = out.toWav();
  const audioBase64 = arrayBufferToBase64(wavBuffer);
  const sampleRate = out.sampling_rate;
  const durationSec = out.audio.length / sampleRate;
  return { ok: true, audioBase64, mime: 'audio/wav', sampleRate, durationSec };
}

function bumpIdleTimer(): void {
  if (idleTimer != null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // Closing the offscreen document is a service-worker-side operation, so
    // we ask the background to close us. The model unloads with the
    // document.
    console.log('[scroll-learn][kokoro-local] idle, asking background to close offscreen');
    void chrome.runtime
      .sendMessage({ type: 'kokoro_local_close', target: 'background' })
      .catch(() => {
        /* background may already be down; nothing actionable */
      });
  }, IDLE_CLOSE_MS);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isSynthRequest(msg)) return false;
  bumpIdleTimer();
  (async () => {
    try {
      const result = await synth(msg);
      sendResponse(result);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn('[scroll-learn][kokoro-local] synth failed', error);
      const reply: SynthError = { ok: false, error };
      sendResponse(reply);
    }
  })();
  // Tell Chrome the response will arrive asynchronously.
  return true;
});

console.log('[scroll-learn][kokoro-local] offscreen ready');
bumpIdleTimer();

// Surface the active device + dtype to anyone debugging from DevTools.
(window as unknown as { __scrollLearnKokoroLocal?: unknown }).__scrollLearnKokoroLocal = {
  get device() {
    return activeDevice;
  },
  get dtype() {
    return activeDtype;
  },
  get loaded() {
    return ttsPromise != null;
  },
  modelId: MODEL_ID,
};
