// Decode an arbitrary audio Blob (e.g. webm/opus from MediaRecorder), downmix
// to mono, downsample to 16 kHz, and write a 16-bit PCM WAV blob.
//
// Why 16 kHz mono: it's the standard sample rate for speech models and keeps
// the file small enough to inline in a Gemini API request even for ~4 minute
// recordings (4 * 60 * 32 KB/s ~= 7.7 MB, well under the 20 MB inline cap).

const TARGET_SAMPLE_RATE = 16000;

function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const length = buffer.length;
  const out = new Float32Array(length);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    out[i] = sum / channels.length;
  }
  return out;
}

// Linear interpolation downsampler. Adequate for speech; we're not aiming for
// audiophile quality, just intelligibility for STT-style audio analysis.
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(input.length - 1, lo + 1);
    const frac = src - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

function encodeWav16Bit(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
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
  writeU32(16);                // PCM chunk size
  writeU16(1);                 // PCM format
  writeU16(1);                 // mono
  writeU32(sampleRate);        // sample rate
  writeU32(sampleRate * 2);    // byte rate (rate * channels * bytes/sample)
  writeU16(2);                 // block align
  writeU16(16);                // bits per sample
  writeAscii('data');
  writeU32(dataBytes);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(p, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    p += 2;
  }
  return buffer;
}

// Convert any decodable audio blob to a 16 kHz mono 16-bit WAV. Closes the
// AudioContext after decoding so we don't leak browser audio resources on
// repeat invocations.
export async function blobToWav16kMono(blob: Blob): Promise<Blob> {
  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) throw new Error('AudioContext is unavailable in this browser.');
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new Ctx();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    try { void ctx.close(); } catch { /* ignore */ }
  }
  const mono = downmixToMono(audioBuffer);
  const resampled = resample(mono, audioBuffer.sampleRate, TARGET_SAMPLE_RATE);
  const wav = encodeWav16Bit(resampled, TARGET_SAMPLE_RATE);
  return new Blob([wav], { type: 'audio/wav' });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned a non-string result.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed.'));
    reader.readAsDataURL(blob);
  });
}
