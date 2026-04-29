// HTMLAudioElement-backed playback for cloud TTS providers (ElevenLabs,
// Kokoro). Web Speech speaks live and never enters this code path; cloud
// providers produce a Blob and route through here.
//
// The returned handle matches the SpeakLineHandle shape so the player can
// treat both speech engines uniformly.

import type { SpeakLineHandle } from '../speak';

export interface PlayBlobAlignment {
  charStartTimesSec: number[];
}

export interface WordRange {
  start: number;
  length: number;
}

export interface PlayBlobOptions {
  rate?: number;        // Playback rate (0.5 - 2). Defaults to 1.
  volume?: number;      // 0 - 1. Defaults to 1.
  onEnd?: () => void;
  onError?: (err: Error) => void;
  // When all three are present, playback drives a per-word highlight by
  // mapping audio.currentTime through charStartTimesSec into a word index.
  // Without all three, behaviour is identical to a plain audio playback and
  // onBoundary is never invoked.
  alignment?: PlayBlobAlignment;
  text?: string;
  onBoundary?: (charIndex: number, charLength: number) => void;
}

/**
 * Scan `text` once and return whitespace-separated word ranges. Punctuation
 * stays attached to the surrounding word, which mirrors what the Web Speech
 * boundary callback emits and what ShadowPlayer expects for highlighting.
 * Pure helper, exported so tests can pin its behaviour without booting the
 * audio element.
 */
export function computeWordRanges(text: string): WordRange[] {
  if (!text) return [];
  const ranges: WordRange[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ranges.push({ start: m.index, length: m[0].length });
  }
  return ranges;
}

/**
 * Walk `charStartTimesSec` from `cursor` forward past every entry whose
 * start time is at or below `currentTimeSec`, then return the word range
 * that contains the resulting character index. Pure so the rAF loop can be
 * tested without a DOM Audio element.
 *
 * Returns the next word index to highlight or -1 when no word covers the
 * current character (e.g. pre-roll silence, trailing punctuation falling
 * outside any word range). The advanced cursor lets the caller resume
 * scanning on the next frame in O(1) amortised.
 */
export function findActiveBoundary(
  currentTimeSec: number,
  charStartTimesSec: number[],
  words: WordRange[],
  cursor: number,
): { wordIndex: number; cursor: number } {
  if (charStartTimesSec.length === 0 || words.length === 0) {
    return { wordIndex: -1, cursor };
  }
  let next = cursor;
  while (next < charStartTimesSec.length && charStartTimesSec[next] <= currentTimeSec) {
    next++;
  }
  // `next` is the first char whose start time is still in the future, so the
  // currently-spoken char is at `next - 1`. Clamp to the last char when the
  // cursor has reached the end so the highlight stays on the final word
  // until natural end fires.
  const charIndex = Math.max(0, Math.min(charStartTimesSec.length - 1, next - 1));
  const wordIndex = wordIndexForChar(charIndex, words);
  return { wordIndex, cursor: next };
}

function wordIndexForChar(charIndex: number, words: WordRange[]): number {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (charIndex >= w.start && charIndex < w.start + w.length) return i;
  }
  return -1;
}

/**
 * Play an audio Blob and return a stop handle. The Blob's ObjectURL is
 * revoked on stop, error, or natural end so we don't leak.
 */
export function playAudioBlob(blob: Blob, opts: PlayBlobOptions = {}): SpeakLineHandle {
  if (typeof window === 'undefined') {
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
    return { stop: () => { /* no-op */ } };
  }

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playbackRate = Math.max(0.25, Math.min(4, opts.rate ?? 1));
  audio.volume = Math.max(0, Math.min(1, opts.volume ?? 1));
  // Preload aggressively -- the Blob is already in memory so this just
  // primes the decoder.
  audio.preload = 'auto';

  let stopped = false;
  let rafId: number | null = null;

  const karaokeReady = !!(opts.alignment && opts.text && opts.onBoundary);
  const words = karaokeReady ? computeWordRanges(opts.text as string) : [];
  const charStartTimes = opts.alignment?.charStartTimesSec ?? [];
  let cursor = 0;
  let lastWordIndex = -1;

  const cancelRaf = () => {
    if (rafId !== null) {
      try { cancelAnimationFrame(rafId); } catch { /* ignore */ }
      rafId = null;
    }
  };

  const cleanup = () => {
    cancelRaf();
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  };

  const tick = () => {
    if (stopped) return;
    const { wordIndex, cursor: nextCursor } = findActiveBoundary(
      audio.currentTime,
      charStartTimes,
      words,
      cursor,
    );
    cursor = nextCursor;
    if (wordIndex !== -1 && wordIndex !== lastWordIndex) {
      lastWordIndex = wordIndex;
      const w = words[wordIndex];
      try { opts.onBoundary?.(w.start, w.length); } catch { /* ignore */ }
    }
    rafId = requestAnimationFrame(tick);
  };

  audio.onended = () => {
    if (stopped) return;
    stopped = true;
    cleanup();
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
  };

  audio.onerror = () => {
    if (stopped) return;
    stopped = true;
    cleanup();
    const err = new Error(audio.error?.message || 'audio playback error');
    if (opts.onError) try { opts.onError(err); } catch { /* ignore */ }
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
  };

  // Autoplay can be blocked by Chrome's policy when the dashboard isn't the
  // active tab. We assume the player click already unlocked the gesture
  // (same way successChime relies on primeChime). Fall through to onError
  // if the play() promise rejects.
  audio.play().then(() => {
    if (stopped) return;
    if (karaokeReady) {
      rafId = requestAnimationFrame(tick);
    }
  }).catch(err => {
    if (stopped) return;
    stopped = true;
    cleanup();
    const wrapped = err instanceof Error ? err : new Error(String(err));
    if (opts.onError) try { opts.onError(wrapped); } catch { /* ignore */ }
    if (opts.onEnd) try { opts.onEnd(); } catch { /* ignore */ }
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { audio.pause(); } catch { /* ignore */ }
      cleanup();
    },
  };
}

/**
 * Decode a base64 audio payload (the format the content scripts post back)
 * into a Blob suitable for playAudioBlob and audioCache.putCached.
 */
export function base64ToAudioBlob(base64: string, mime: string = 'audio/mpeg'): Blob {
  // atob -> byte string -> Uint8Array -> Blob.
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/**
 * Encode an audio Blob to base64 (used inside the content scripts to push
 * the payload back through chrome.runtime.sendMessage, which can't carry
 * binary data directly).
 */
export async function audioBlobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  // Chunk to avoid call-stack limits on large audio.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
