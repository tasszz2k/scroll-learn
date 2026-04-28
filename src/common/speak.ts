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
