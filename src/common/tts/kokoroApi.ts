// Kokoro TTS via direct Gradio queue API on the public hexgrad/Kokoro-TTS
// HuggingFace Space. Authenticated with a user-supplied Hugging Face access
// token (free tier). Unlike ./kokoro.ts -- which drives the Space through a
// content script in a hidden tab -- this provider talks directly to the
// queue endpoints over HTTPS. Same voice catalog (KOKORO_VOICES), same
// ZeroGPU daily quota, but no browser tab or runtime message hop required.
//
// Pipeline:
//   1. Cache check (IDB) -- a hit short-circuits the API path entirely.
//   2. Resolve fn_index from /config (cached after first lookup).
//   3. POST /gradio_api/queue/join with the synth args and a fresh session
//      hash, then GET /gradio_api/queue/data?session_hash=... and parse the
//      Server-Sent Events stream until process_completed lands.
//   4. Fetch the audio file the Space published, persist the Blob in IDB,
//      and play it through HTMLAudioElement (same path the tab-driven
//      provider uses, so playback is uniform).
//
// On any failure we fall back to Web Speech so the line still plays. The
// error is surfaced through onStatus('error', ...) so the player's pill
// shows what went wrong; the audio just comes from the OS instead.

import type { TTSProvider, TTSSpeakRequest } from './index';
import type { TTSJobStage } from '../types';
import { STORAGE_KEYS } from '../types';
import type { SpeakLineHandle } from '../speak';
import { speakLine } from '../speak';
import { getCached, putCached } from './audioCache';
import { playAudioBlob } from './playback';

const PROVIDER_ID = 'kokoro-api' as const;
const SPACE_BASE = 'https://hexgrad-kokoro-tts.hf.space';
const DEFAULT_VOICE = 'af_heart';
// Speed sent to Kokoro itself. Playback rate is applied separately by the
// HTMLAudioElement; sending speed=1 keeps the rendered audio at native
// tempo so the cache entry is reusable across stage changes.
const KOKORO_SPEED = 1;
// Outer safety net so a stuck queue can't pin a line indefinitely. The
// individual fetches share an AbortController that fires when this lapses.
const HARD_TIMEOUT_MS = 5 * 60 * 1000;

async function getKokoroApiToken(): Promise<string> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return '';
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    const settings = result[STORAGE_KEYS.SETTINGS] as { kokoroApiToken?: string } | undefined;
    return (settings?.kokoroApiToken ?? '').trim();
  } catch {
    return '';
  }
}

function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Walk /config.dependencies to find the synthesis endpoint. The Kokoro
// Space's app.py has historically named this 'generate_first'; if upstream
// renames it we fall back through a few likely candidates and finally the
// first dependency that exposes any api_name at all.
interface DependencyDescriptor {
  id: number;
  api_name?: string | false;
  inputs?: unknown[];
}

let cachedDependency: DependencyDescriptor | null = null;

async function resolveDependency(token: string, signal: AbortSignal): Promise<DependencyDescriptor> {
  if (cachedDependency) return cachedDependency;
  const res = await fetch(`${SPACE_BASE}/config`, {
    headers: authHeaders(token),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Kokoro /config request failed: ${res.status} ${res.statusText}`);
  }
  const cfg = await res.json() as {
    dependencies?: DependencyDescriptor[];
  };
  const deps = Array.isArray(cfg.dependencies) ? cfg.dependencies : [];
  console.debug(
    '[kokoro-api] /config dependencies:',
    deps.map(d => ({ id: d.id, api_name: d.api_name, inputs: d.inputs?.length ?? null })),
  );
  // The Kokoro Space ships its synthesis functions with api_name: false (UI
  // button click handlers, not exposed under a named API path). Resolution
  // strategy:
  //   1. Try named candidates first -- harmless future-proofing in case
  //      hexgrad ever exposes them under predict/generate_first/etc.
  //   2. Fall back to the lowest-id dependency declaring 3 or 4 inputs.
  //      Empirically id 4 is the single-shot generator (text, voice, speed,
  //      use_gpu); id 6 is the streaming variant. Lowest-id picks the
  //      single-shot one and avoids the streaming chunked path.
  const namedCandidates = [
    '/predict', 'predict',
    '/generate_all', 'generate_all',
    '/generate', 'generate',
    '/generate_first', 'generate_first',
  ];
  for (const name of namedCandidates) {
    const dep = deps.find(d => d.api_name === name);
    if (dep) {
      cachedDependency = dep;
      console.debug('[kokoro-api] resolved fn_index', dep.id, 'via api_name', name);
      return dep;
    }
  }
  // Shape-based fallback: synthesis functions take text + voice + speed
  // (3 args) or text + voice + speed + use_gpu (4 args). Anything taking
  // 0/1/2 inputs is a UI helper (toggles, tokenizers, etc.); 5+ is a
  // multi-output debug helper.
  const shapeMatch = deps
    .filter(d => {
      const len = Array.isArray(d.inputs) ? d.inputs.length : -1;
      return len === 3 || len === 4;
    })
    .sort((a, b) => a.id - b.id)[0];
  if (shapeMatch) {
    cachedDependency = shapeMatch;
    console.debug('[kokoro-api] resolved fn_index', shapeMatch.id, 'by shape (', shapeMatch.inputs?.length, 'inputs)');
    return shapeMatch;
  }
  console.warn('[kokoro-api] /config has no usable synthesis dep', deps);
  throw new Error('No synthesis endpoint found in Kokoro Gradio config.');
}

// Probe the audio Blob's duration via a throw-away HTMLAudioElement so we can
// distribute char start times across it. Returns null when unavailable
// (non-browser env), the metadata never loads in time, the element errors,
// or the reported duration is not a finite positive number. Callers treat
// null as "skip alignment, persist Blob alone" so the line still plays.
function probeAudioDurationSec(blob: Blob, timeoutMs = 5000): Promise<number | null> {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let settled = false;
    const finish = (val: number | null) => {
      if (settled) return;
      settled = true;
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      const d = audio.duration;
      finish(Number.isFinite(d) && d > 0 ? d : null);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    audio.preload = 'metadata';
    audio.src = url;
  });
}

// Distribute `duration` uniformly across `text.length` so each character gets
// a start time. Crude but adequate at the 6-14 word lines the Shadow player
// uses; weighting by syllables would barely move the needle.
function buildUniformAlignmentTimes(textLength: number, durationSec: number): number[] {
  const times = new Array<number>(textLength);
  for (let i = 0; i < textLength; i++) {
    times[i] = (i / textLength) * durationSec;
  }
  return times;
}

function makeSessionHash(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  const r = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${r()}-${r().slice(0, 4)}-4${r().slice(0, 3)}-8${r().slice(0, 3)}-${r()}${r().slice(0, 4)}`;
}

function notify(
  req: TTSSpeakRequest,
  stage: TTSJobStage,
  detail?: { message?: string; queuePosition?: number },
): void {
  if (!req.onStatus) return;
  try { req.onStatus(stage, detail); } catch { /* listener errors are not fatal */ }
}

function fallbackToWebSpeech(req: TTSSpeakRequest): SpeakLineHandle {
  return speakLine(req.text, {
    rate: req.rate,
    pitch: req.pitch,
    onBoundary: req.onBoundary,
    onEnd: req.onEnd,
    onError: req.onError ? (ev) => req.onError?.(new Error(ev.error || 'speech error')) : undefined,
  });
}

interface PipelineState {
  stopped: boolean;
  playbackHandle: SpeakLineHandle | null;
  abort: AbortController;
}

export const kokoroApiProvider: TTSProvider = {
  id: PROVIDER_ID,
  label: 'Kokoro TTS (API key)',
  description: 'Direct HF Space API. Needs a free Hugging Face token in Settings. 50+ voices.',
  longDescription:
    "Calls the public hexgrad/Kokoro-TTS Space directly via its Gradio queue API, using a Hugging Face access token (free tier). The dashboard does the HTTPS round-trip itself -- no hidden tab, no content script. Shares the Space's daily ZeroGPU quota (~4 GPU-minutes/day on the free tier). Cached audio replays for free.",
  cacheable: true,

  async isReady() {
    const token = await getKokoroApiToken();
    return token.length > 0;
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
      // Older cache entries (pre-alignment schema) lack alignment; karaoke
      // simply stays static for those until the user regenerates the line.
      alignment: cached.alignment,
      text: cached.alignment ? req.text : undefined,
      onBoundary: cached.alignment ? req.onBoundary : undefined,
    });
    return;
  }

  notify(req, 'opening');
  const token = await getKokoroApiToken();
  if (!token) {
    throw new Error('Kokoro API token not set. Add a Hugging Face token in Settings.');
  }

  const timeoutId = setTimeout(() => {
    try { state.abort.abort(); } catch { /* ignore */ }
  }, HARD_TIMEOUT_MS);

  try {
    const dep = await resolveDependency(token, state.abort.signal);
    if (state.stopped) return;

    notify(req, 'configuring');
    const sessionHash = makeSessionHash();

    // Kokoro Space signature is canonically (text, voice, speed). When the
    // /config dependency declares more inputs we pad with conservative
    // defaults so the queue/join doesn't trip Gradio's "missing positional
    // argument" validator -- but we cap at 4 args since mismatched 5+ arg
    // shapes have caused unhandled-exception failures (success=false,
    // output.error=null, title="Error") on this Space.
    const baseArgs: unknown[] = [req.text, voice, KOKORO_SPEED];
    const declaredLen = Array.isArray(dep.inputs) ? dep.inputs.length : baseArgs.length;
    const targetLen = Math.min(Math.max(declaredLen, baseArgs.length), 4);
    const padding = [true]; // 4th positional, when present, is use_gpu/cuda.
    const data = baseArgs.slice();
    while (data.length < targetLen) data.push(padding[data.length - baseArgs.length] ?? null);

    // Gradio 4.x+ accepts both fn_index and trigger_id; some forks check for
    // trigger_id and reject when it's missing. event_data is null for plain
    // button.click handlers (it carries gr.SelectData / gr.EventData payloads
    // for components that emit one) -- include it explicitly so the server
    // doesn't read undefined.
    const joinBody = {
      data,
      event_data: null,
      fn_index: dep.id,
      trigger_id: dep.id,
      session_hash: sessionHash,
    };
     
    console.debug('[kokoro-api] queue/join', joinBody);

    const joinRes = await fetch(`${SPACE_BASE}/gradio_api/queue/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(token),
      },
      body: JSON.stringify(joinBody),
      signal: state.abort.signal,
    });
    if (!joinRes.ok) {
      const detail = await joinRes.text().catch(() => '');
      throw new Error(`Kokoro queue/join failed: ${joinRes.status} ${joinRes.statusText}${detail ? ` -- ${detail.slice(0, 200)}` : ''}`);
    }

    notify(req, 'submitting');

    const streamRes = await fetch(
      `${SPACE_BASE}/gradio_api/queue/data?session_hash=${encodeURIComponent(sessionHash)}`,
      { headers: authHeaders(token), signal: state.abort.signal },
    );
    if (!streamRes.ok || !streamRes.body) {
      throw new Error(`Kokoro queue/data failed: ${streamRes.status} ${streamRes.statusText}`);
    }

    const output = await readGradioStream(streamRes.body, req, state);
    if (state.stopped) return;

    const audioUrl = pickAudioUrl(output);
    if (!audioUrl) throw new Error('Kokoro returned no audio URL.');

    notify(req, 'capturing');
    const audioRes = await fetch(audioUrl, {
      headers: authHeaders(token),
      signal: state.abort.signal,
    });
    if (!audioRes.ok) {
      throw new Error(`Kokoro audio fetch failed: ${audioRes.status} ${audioRes.statusText}`);
    }
    const blob = await audioRes.blob();
    if (state.stopped) return;

    const mime = blob.type || 'audio/wav';

    // Probe the rendered audio to build a uniform per-character alignment.
    // The Kokoro Space returns audio only (no timestamps), so we approximate
    // by spreading characters evenly across the measured duration. If the
    // probe fails (timeout, malformed Blob, NaN duration) we persist the
    // Blob without alignment -- playback still works, karaoke just stays
    // static until the line is regenerated.
    const durationSec = await probeAudioDurationSec(blob);
    if (state.stopped) return;
    const textLength = req.text.length;
    const charStartTimesSec =
      durationSec != null && textLength > 0
        ? buildUniformAlignmentTimes(textLength, durationSec)
        : null;

    void putCached(
      cacheKey,
      blob,
      mime,
      charStartTimesSec ? { charStartTimesSec } : undefined,
    );

    notify(req, 'done');
    state.playbackHandle = playAudioBlob(blob, {
      rate: req.rate,
      onEnd: req.onEnd,
      onError: req.onError,
      alignment: charStartTimesSec ? { charStartTimesSec } : undefined,
      text: charStartTimesSec ? req.text : undefined,
      onBoundary: charStartTimesSec ? req.onBoundary : undefined,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

interface GradioOutput {
  data: unknown[];
}

interface GradioMessage {
  msg?: string;
  rank?: number;
  queue_size?: number;
  output?: GradioOutput & { error?: string; is_generating?: boolean };
  success?: boolean;
  message?: string;
}

// Pull a human-readable reason out of a process_completed/failed message.
// Gradio puts the error string in output.error when success is false; older
// builds put it in the top-level message field. When neither carries text we
// dump a short slice of the raw message so DevTools and the player pill
// agree on the failure mode rather than showing "no detail".
function describeFailure(msg: GradioMessage): string {
  const err = msg.output?.error || msg.message;
  if (err) return `Kokoro: ${err}`;
  const dump = JSON.stringify(msg).slice(0, 240);
  return `Kokoro generation failed: ${dump}`;
}

async function readGradioStream(
  body: ReadableStream<Uint8Array>,
  req: TTSSpeakRequest,
  state: PipelineState,
): Promise<GradioOutput> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Kokoro's synthesis function is a generator -- it emits audio via
  // process_generating events (often cumulative across yields), and the
  // terminal process_completed event may or may not carry the same payload.
  // Track the most recent output we saw with a usable audio reference so we
  // can return it if the completion event drops it.
  let latestUsableOutput: GradioOutput | null = null;
  while (true) {
    if (state.stopped) throw new Error('aborted');
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE messages are separated by blank lines. Within each message, lines
    // beginning with "data:" carry the payload. Process each completed
    // message (terminated by \n\n) and keep the trailing partial in buffer.
    let blankIdx: number;
    while ((blankIdx = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, blankIdx);
      buffer = buffer.slice(blankIdx + 2);
      const dataLines = message
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const json = dataLines.join('\n');
      let msg: GradioMessage;
      try { msg = JSON.parse(json) as GradioMessage; } catch { continue; }
      if (msg.msg) console.debug('[kokoro-api]', msg.msg, msg);
      switch (msg.msg) {
        case 'estimation':
        case 'queue_full':
          notify(req, 'queued', { queuePosition: msg.rank });
          break;
        case 'process_starts':
          notify(req, 'capturing');
          break;
        case 'process_generating':
          if (msg.output && Array.isArray(msg.output.data) && pickAudioUrl(msg.output)) {
            latestUsableOutput = msg.output;
          }
          break;
        case 'process_completed':
          if (msg.success === false) throw new Error(describeFailure(msg));
          if (msg.output && pickAudioUrl(msg.output)) return msg.output;
          if (latestUsableOutput) return latestUsableOutput;
          throw new Error(describeFailure(msg));
        case 'process_failed':
        case 'unexpected_error':
          throw new Error(describeFailure(msg));
        default:
          break;
      }
    }
  }
  if (latestUsableOutput) return latestUsableOutput;
  throw new Error('Kokoro stream closed without a completed result.');
}

// Gradio serializes audio outputs in several shapes depending on version
// and component config; recognize all of them and ignore the surrounding
// scalars (e.g. a sample_rate emitted alongside the FileData). We walk the
// data array and, recursively, any nested arrays/tuples (Gradio emits
// (sample_rate, file_payload) as [number, {...}] in some versions).
function pickAudioUrl(output: GradioOutput): string | null {
  if (!output || !Array.isArray(output.data)) return null;
  return walkForAudio(output.data);
}

function walkForAudio(value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = walkForAudio(item);
      if (url) return url;
    }
    return null;
  }
  if (typeof value === 'string') {
    if (value.startsWith('http')) return value;
    if (value.startsWith('/')) return `${SPACE_BASE}${value}`;
    return null;
  }
  if (typeof value === 'object') {
    const f = value as { url?: string; path?: string; name?: string; is_file?: boolean; data?: unknown };
    if (typeof f.url === 'string' && f.url) return f.url.startsWith('http') ? f.url : `${SPACE_BASE}${f.url.startsWith('/') ? '' : '/'}${f.url}`;
    if (typeof f.path === 'string' && f.path) return `${SPACE_BASE}/gradio_api/file=${f.path}`;
    if (typeof f.name === 'string' && f.name) return `${SPACE_BASE}/gradio_api/file=${f.name}`;
    if (f.data != null) return walkForAudio(f.data);
  }
  return null;
}
