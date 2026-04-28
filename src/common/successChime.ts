// Tiny synthesized chime played when an async AI job finishes successfully.
// Renders a two-note "ding" to a base64 WAV at module load and plays it back
// through an HTMLAudioElement.
//
// Why not Web Audio: in the Chrome side panel, AudioContext.resume() inside a
// click handler did NOT reliably leave the context running long enough for
// the later (non-gesture) success message to play sound. HTMLAudioElement
// with a preloaded src is more permissive once the element has been "warmed"
// by a single .play() call inside any user gesture, which we do via
// primeChime() at job start.

const SAMPLE_RATE = 8000;

function buildBeepWavDataUri(): string {
  // Two-note motif: E5 (659.25Hz) -> A5 (880Hz), each with a quick attack
  // and exponential decay so it sounds like a soft chime, not a buzzer.
  const tones: Array<{ freq: number; durationSec: number }> = [
    { freq: 659.25, durationSec: 0.13 },
    { freq: 880.0, durationSec: 0.2 },
  ];
  const gapSec = 0.02;
  const peak = 0.6; // peak amplitude (-4.4 dBFS) -- loud enough to be
                    // clearly audible without distorting

  const segments: number[] = [];
  for (let t = 0; t < tones.length; t++) {
    const { freq, durationSec } = tones[t];
    const numSamples = Math.floor(SAMPLE_RATE * durationSec);
    for (let i = 0; i < numSamples; i++) {
      const time = i / SAMPLE_RATE;
      const envelope = Math.exp(-time * 6);
      const sample = Math.sin(2 * Math.PI * freq * time) * envelope * peak;
      segments.push(sample);
    }
    if (t < tones.length - 1) {
      const gapSamples = Math.floor(SAMPLE_RATE * gapSec);
      for (let i = 0; i < gapSamples; i++) segments.push(0);
    }
  }

  const dataBytes = segments.length * 2; // 16-bit samples
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  let p = 0;
  function writeAscii(s: string): void {
    for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i));
  }
  function writeU32(v: number): void { view.setUint32(p, v, true); p += 4; }
  function writeU16(v: number): void { view.setUint16(p, v, true); p += 2; }

  writeAscii('RIFF');
  writeU32(36 + dataBytes);
  writeAscii('WAVE');
  writeAscii('fmt ');
  writeU32(16);              // PCM chunk size
  writeU16(1);               // PCM format
  writeU16(1);               // mono
  writeU32(SAMPLE_RATE);     // sample rate
  writeU32(SAMPLE_RATE * 2); // byte rate (rate * channels * bytes/sample)
  writeU16(2);               // block align
  writeU16(16);              // bits per sample
  writeAscii('data');
  writeU32(dataBytes);

  for (let i = 0; i < segments.length; i++) {
    const clamped = Math.max(-1, Math.min(1, segments[i]));
    view.setInt16(p, Math.floor(clamped * 32767), true);
    p += 2;
  }

  // ArrayBuffer -> base64 without spilling huge strings into String.fromCharCode
  // (some Chromium builds cap the spread length).
  const u8 = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)));
  }
  return 'data:audio/wav;base64,' + btoa(binary);
}

let cachedSrc: string | null = null;
let cachedAudio: HTMLAudioElement | null = null;
let unlocked = false;

function getSrc(): string {
  if (cachedSrc === null) cachedSrc = buildBeepWavDataUri();
  return cachedSrc;
}

function getAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (cachedAudio === null) {
    try {
      cachedAudio = new Audio(getSrc());
      cachedAudio.preload = 'auto';
      cachedAudio.volume = 0.45;
    } catch {
      return null;
    }
  }
  return cachedAudio;
}

// Call from the click handler that kicks off an async job. Plays the chime
// muted to satisfy Chrome's autoplay policy, then immediately resets so the
// later success play (which fires from a runtime message, NOT a user
// gesture) is allowed. Safe to call repeatedly; becomes a no-op after the
// first success.
export function primeChime(): void {
  if (unlocked) return;
  const audio = getAudio();
  if (!audio) return;
  audio.muted = true;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        unlocked = true;
      })
      .catch(() => {
        // Autoplay still blocked. Reset state so the next priming attempt
        // (e.g. on the next user click) gets a fresh shot.
        audio.muted = false;
      });
  } else {
    // Synchronous play() (older browsers): assume it worked.
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    unlocked = true;
  }
}

export function playSuccessChime(): void {
  const audio = getAudio();
  if (!audio) return;
  try {
    audio.currentTime = 0;
  } catch {
    /* some browsers throw if not loaded yet; ignore */
  }
  audio.muted = false;
  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => { /* autoplay blocked; nothing to do */ });
  }
}
