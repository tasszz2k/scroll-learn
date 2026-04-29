/**
 * Web Speech API helpers for pronouncing card text aloud.
 * No external deps; defensive against environments lacking speechSynthesis.
 */

interface SpeakOptions {
  lang?: string;
  rate?: number;
  onEnd?: () => void;
}

let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeOnEnd: (() => void) | null = null;

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined';
}

export function isSpeaking(): boolean {
  if (!isSpeechSupported()) return false;
  return window.speechSynthesis.speaking || activeUtterance !== null;
}

export function stopSpeaking(): void {
  if (!isSpeechSupported()) return;
  const cb = activeOnEnd;
  activeUtterance = null;
  activeOnEnd = null;
  window.speechSynthesis.cancel();
  if (cb) {
    try { cb(); } catch { /* ignore */ }
  }
}

export function speak(text: string, opts: SpeakOptions = {}): boolean {
  if (!isSpeechSupported()) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Cancel any in-flight utterance, fire its onEnd so callers can reset state.
  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.rate = opts.rate ?? 0.95;
  if (opts.lang) utterance.lang = opts.lang;

  const finish = () => {
    if (activeUtterance === utterance) {
      activeUtterance = null;
      activeOnEnd = null;
    }
    if (opts.onEnd) {
      try { opts.onEnd(); } catch { /* ignore */ }
    }
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  activeUtterance = utterance;
  activeOnEnd = opts.onEnd ?? null;
  window.speechSynthesis.speak(utterance);
  return true;
}

// ---------------------------------------------------------------------------
// Shadow practice helpers
//
// Distinct API surface from the single-utterance speak() above; callers in the
// shadow player coordinate multi-line dialogue with per-speaker voices and
// karaoke-style word highlighting via onBoundary.

export type SpeechVoice = SpeechSynthesisVoice;

// speechSynthesis.getVoices() returns [] until Chrome has loaded the engine.
// First call after a page load typically needs a single voiceschanged event.
let voicesLoaded: Promise<SpeechVoice[]> | null = null;

function loadVoicesOnce(): Promise<SpeechVoice[]> {
  if (!isSpeechSupported()) return Promise.resolve([]);
  if (voicesLoaded) return voicesLoaded;
  voicesLoaded = new Promise((resolve) => {
    const initial = window.speechSynthesis.getVoices();
    if (initial && initial.length > 0) {
      resolve(initial);
      return;
    }
    let settled = false;
    const onChange = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChange);
    // Chrome occasionally never fires voiceschanged on a warm cache; fall back
    // after 2s with whatever is currently available so the UI doesn't hang.
    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onChange);
      resolve(window.speechSynthesis.getVoices());
    }, 2000);
  });
  return voicesLoaded;
}

export async function getEnglishVoices(): Promise<SpeechVoice[]> {
  const all = await loadVoicesOnce();
  return all.filter(v => /^en(-|$)/i.test(v.lang));
}

export interface SpeakerVoiceAssignment {
  voice: SpeechVoice | null;
  pitch: number;
  rate: number;
}

// Distribute distinct voices across speakers. When fewer voices than speakers
// exist (or none at all), perturb pitch/rate per speaker so they still sound
// distinct even on a single voice.
export async function pickVoicesForSpeakers(
  speakers: string[],
): Promise<Record<string, SpeakerVoiceAssignment>> {
  const voices = await getEnglishVoices();
  const result: Record<string, SpeakerVoiceAssignment> = {};
  // Spread perturbations symmetrically around 1.0 so an odd-count rotation
  // still includes a "neutral" speaker.
  const pitchOffsets = [0, 0.15, -0.15, 0.3, -0.3, 0.45];
  const rateOffsets = [0, -0.05, 0.05, -0.1, 0.1, -0.15];
  speakers.forEach((id, idx) => {
    const voice = voices.length > 0 ? voices[idx % voices.length] : null;
    // If there are enough distinct voices for every speaker, keep pitch/rate
    // neutral. Otherwise perturb so the user can still tell speakers apart.
    const needPerturb = voices.length === 0 || voices.length < speakers.length;
    result[id] = {
      voice,
      pitch: needPerturb ? 1 + (pitchOffsets[idx] ?? 0) : 1,
      rate: needPerturb ? 1 + (rateOffsets[idx] ?? 0) : 1,
    };
  });
  return result;
}

export interface SpeakLineOptions {
  voice?: SpeechVoice | null;
  rate?: number;
  pitch?: number;
  // Word-level boundary callback. Note: not all engines fire 'boundary'
  // reliably in Chrome -- callers should treat this as best-effort highlight.
  onBoundary?: (charIndex: number, charLength: number) => void;
  onEnd?: () => void;
  onError?: (err: SpeechSynthesisErrorEvent) => void;
}

export interface SpeakLineHandle {
  stop: () => void;
}

export function speakLine(text: string, opts: SpeakLineOptions = {}): SpeakLineHandle {
  if (!isSpeechSupported()) {
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
    return { stop: () => { /* no-op */ } };
  }
  // Cancel any in-flight utterance from the legacy speak() pipeline so we
  // don't pile two voices on top of each other.
  stopSpeaking();

  const trimmed = text.trim();
  if (!trimmed) {
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
    return { stop: () => { /* no-op */ } };
  }

  const utterance = new SpeechSynthesisUtterance(trimmed);
  if (opts.voice) utterance.voice = opts.voice;
  // Web Speech rate is clamped to [0.1, 10]; pitch to [0, 2]. Be defensive.
  utterance.rate = Math.max(0.1, Math.min(10, opts.rate ?? 1));
  utterance.pitch = Math.max(0, Math.min(2, opts.pitch ?? 1));
  utterance.lang = opts.voice?.lang || 'en-US';

  let stopped = false;

  utterance.onboundary = (ev: SpeechSynthesisEvent) => {
    if (stopped || !opts.onBoundary) return;
    // 'word' boundaries only -- skip sentence/character boundaries.
    if (ev.name && ev.name !== 'word') return;
    const charIndex = ev.charIndex ?? 0;
    // charLength is supported in Chrome but not all engines.
    const charLength =
      (ev as SpeechSynthesisEvent & { charLength?: number }).charLength ?? 0;
    try { opts.onBoundary(charIndex, charLength); } catch { /* ignore */ }
  };

  utterance.onend = () => {
    if (stopped) return;
    stopped = true;
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
  };
  utterance.onerror = (ev) => {
    if (stopped) return;
    stopped = true;
    if (opts.onError) try { opts.onError(ev); } catch { /* ignore */ }
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
  };

  window.speechSynthesis.speak(utterance);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    },
  };
}

// Speak a single example word for IPA practice. Slower default rate so the
// learner can hear individual phonemes more clearly.
export interface SpeakWordOptions {
  rate?: number;
  voice?: SpeechVoice | null;
  onEnd?: () => void;
}

export function speakWordWithIpa(word: string, opts: SpeakWordOptions = {}): SpeakLineHandle {
  return speakLine(word, {
    voice: opts.voice ?? null,
    rate: opts.rate ?? 0.85,
    onEnd: opts.onEnd,
  });
}
