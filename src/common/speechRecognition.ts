/**
 * Web Speech API SpeechRecognition wrapper. Mirrors the surface of speak.ts so
 * the dashboard can do recognise-then-grade in a single async call without
 * dragging in the full event-driven API.
 *
 * Browser support: Chromium (webkit-prefixed) and Edge. Firefox/Safari without
 * the webkit prefix return false from isRecognitionSupported() so the UI can
 * render a typed-input fallback.
 */

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
  item(index: number): SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
  item(index: number): SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((ev: Event) => void) | null;
  onstart: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionInstance;
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isRecognitionSupported(): boolean {
  return getCtor() !== null;
}

export interface RecognizeResult {
  transcript: string;
  confidence: number;
}

export interface RecognizeError extends Error {
  code: 'permission' | 'no-speech' | 'aborted' | 'unsupported' | 'other';
}

function makeError(code: RecognizeError['code'], message: string): RecognizeError {
  const err = new Error(message) as RecognizeError;
  err.code = code;
  return err;
}

export interface RecognizeOnceOptions {
  lang?: string;                          // Default 'en-US'
  onPartial?: (transcript: string) => void;
  onStart?: () => void;
}

let activeInstance: SpeechRecognitionInstance | null = null;

export function cancelRecognition(): void {
  if (activeInstance) {
    try { activeInstance.abort(); } catch { /* ignore */ }
    activeInstance = null;
  }
}

/**
 * Single-shot recognition. Resolves with the highest-confidence final
 * alternative; rejects with a typed RecognizeError on permission denial,
 * unsupported environment, abort, or no speech detected.
 */
export function recognizeOnce(opts: RecognizeOnceOptions = {}): Promise<RecognizeResult> {
  return new Promise((resolve, reject) => {
    const Ctor = getCtor();
    if (!Ctor) {
      reject(makeError('unsupported', 'SpeechRecognition not available in this browser.'));
      return;
    }

    cancelRecognition();

    const rec = new Ctor();
    rec.lang = opts.lang ?? 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    let bestFinal: SpeechRecognitionAlternative | null = null;
    let settled = false;

    const finish = (result: RecognizeResult | null, err: RecognizeError | null) => {
      if (settled) return;
      settled = true;
      if (activeInstance === rec) activeInstance = null;
      try { rec.stop(); } catch { /* ignore */ }
      if (err) reject(err);
      else if (result) resolve(result);
      else reject(makeError('no-speech', 'No speech detected.'));
    };

    rec.onstart = () => {
      if (opts.onStart) {
        try { opts.onStart(); } catch { /* ignore */ }
      }
    };

    rec.onresult = (ev) => {
      // Walk all results from this event. Interim results stream first; the
      // final alternative wins. We pick the alternative with the highest
      // confidence among the final results.
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) {
          let best: SpeechRecognitionAlternative | null = null;
          for (let j = 0; j < r.length; j++) {
            const alt = r[j];
            if (!best || (alt.confidence ?? 0) > (best.confidence ?? 0)) {
              best = alt;
            }
          }
          if (best && (!bestFinal || (best.confidence ?? 0) > (bestFinal.confidence ?? 0))) {
            bestFinal = best;
          }
        } else if (opts.onPartial) {
          // Surface the first alternative of the interim result so the UI can
          // show the live transcript.
          const partial = r[0]?.transcript ?? '';
          if (partial) {
            try { opts.onPartial(partial); } catch { /* ignore */ }
          }
        }
      }
    };

    rec.onerror = (ev) => {
      const code: RecognizeError['code'] =
        ev.error === 'not-allowed' || ev.error === 'service-not-allowed'
          ? 'permission'
          : ev.error === 'no-speech'
            ? 'no-speech'
            : ev.error === 'aborted'
              ? 'aborted'
              : 'other';
      finish(null, makeError(code, ev.message || ev.error || 'Speech recognition error.'));
    };

    rec.onend = () => {
      if (settled) return;
      if (bestFinal) {
        finish({ transcript: bestFinal.transcript.trim(), confidence: bestFinal.confidence ?? 0 }, null);
      } else {
        finish(null, makeError('no-speech', 'No speech detected.'));
      }
    };

    activeInstance = rec;
    try {
      rec.start();
    } catch (err) {
      finish(null, makeError('other', err instanceof Error ? err.message : String(err)));
    }
  });
}

export interface ContinuousRecognizerOptions {
  lang?: string;
  onPartial?: (transcript: string) => void;       // running transcript including interim tail
  onError?: (err: RecognizeError) => void;
}

export interface ContinuousRecognizer {
  stop: () => Promise<string>;                    // Resolves with the final transcript
  abort: () => void;
}

/**
 * Continuous recognition for long-form recordings. Returns a handle whose
 * stop() resolves with the accumulated final transcript. We auto-restart the
 * recognizer if Chrome ends the session early (it caps continuous sessions at
 * about 60 seconds even with continuous=true), so the caller sees a single
 * uninterrupted transcript across the whole recording.
 */
export function startContinuousRecognition(
  opts: ContinuousRecognizerOptions = {},
): ContinuousRecognizer | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  cancelRecognition();

  let stopping = false;
  let aborted = false;
  let finalText = '';
  let interimText = '';
  let stopResolve: ((t: string) => void) | null = null;
  let current: SpeechRecognitionInstance | null = null;

  const wire = (rec: SpeechRecognitionInstance) => {
    rec.lang = opts.lang ?? 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) {
          finalText += (finalText && !finalText.endsWith(' ') ? ' ' : '') + t.trim();
        } else {
          interim += t;
        }
      }
      interimText = interim.trim();
      if (opts.onPartial) {
        const combined = (finalText + (interimText ? ' ' + interimText : '')).trim();
        try { opts.onPartial(combined); } catch { /* ignore */ }
      }
    };

    rec.onerror = (ev) => {
      const code: RecognizeError['code'] =
        ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'permission'
        : ev.error === 'no-speech' ? 'no-speech'
        : ev.error === 'aborted'   ? 'aborted'
        : 'other';
      // 'no-speech' fires when the user stays silent during a recognition
      // window -- the auto-restart loop below will pick up the next utterance,
      // so don't surface it as a hard error.
      if (code === 'no-speech') return;
      if (opts.onError) {
        try { opts.onError(makeError(code, ev.message || ev.error || 'Speech recognition error.')); }
        catch { /* ignore */ }
      }
    };

    rec.onend = () => {
      // If we asked to stop or to abort, finalize. Otherwise, restart so the
      // continuous transcript spans the whole recording.
      if (stopping || aborted) {
        if (activeInstance === rec) activeInstance = null;
        if (stopResolve) {
          const tail = interimText ? (finalText ? finalText + ' ' + interimText : interimText) : finalText;
          const out = tail.trim();
          stopResolve(out);
          stopResolve = null;
        }
        return;
      }
      // Restart with a fresh instance.
      try {
        const next = new Ctor();
        wire(next);
        current = next;
        activeInstance = next;
        next.start();
      } catch {
        if (activeInstance === rec) activeInstance = null;
      }
    };
  };

  const first = new Ctor();
  wire(first);
  current = first;
  activeInstance = first;
  try {
    first.start();
  } catch (err) {
    if (opts.onError) {
      try { opts.onError(makeError('other', err instanceof Error ? err.message : String(err))); }
      catch { /* ignore */ }
    }
    return null;
  }

  return {
    stop: () =>
      new Promise<string>((resolve) => {
        stopping = true;
        stopResolve = resolve;
        try { current?.stop(); } catch { /* ignore */ }
      }),
    abort: () => {
      aborted = true;
      try { current?.abort(); } catch { /* ignore */ }
      activeInstance = null;
    },
  };
}
