// Tests for the pure helpers in src/common/tts/elevenlabsApi.ts that own the
// /with-timestamps response parsing and the 4xx error-message construction.
//
// The full runPipeline path needs chrome.storage, IndexedDB, and a live
// HTMLAudioElement, none of which exist in vitest's node environment. By
// extracting parseTimestampsResponse and parseElevenLabsErrorMessage into
// pure helpers, we can pin the contract this PR adds (Phase 2c) without
// mocking that whole stack.

import { describe, expect, it } from 'vitest';
import {
  parseTimestampsResponse,
  parseElevenLabsErrorMessage,
} from '../src/common/tts/elevenlabsApi';

// "Hi" is a convenient minimum-length text whose alignment.characters length
// matches text.length exactly. Real responses have one entry per char.
const HI_BASE64 = btoa('mock-mp3-bytes');

describe('parseTimestampsResponse', () => {
  it('builds charStartTimesSec from the alignment when characters.length === text.length', () => {
    const text = 'Hi';
    const json = {
      audio_base64: HI_BASE64,
      alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0.0, 0.08],
        character_end_times_seconds: [0.08, 0.16],
      },
    };
    const { blob, alignment } = parseTimestampsResponse(json, text);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(alignment).toBeDefined();
    expect(alignment!.charStartTimesSec).toEqual([0.0, 0.08]);
  });

  it('preserves the configured mime on the returned Blob', () => {
    const text = 'Hi';
    const json = {
      audio_base64: HI_BASE64,
      alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0, 0.08],
        character_end_times_seconds: [0.08, 0.16],
      },
    };
    const { blob } = parseTimestampsResponse(json, text, 'audio/mpeg');
    expect(blob.type).toBe('audio/mpeg');
  });

  it('drops alignment when ElevenLabs normalised the input (Mr. -> Mister)', () => {
    // The user asked for "Mr." (3 chars) but ElevenLabs may return alignment
    // for the spoken form "Mister" (6 chars). The mismatch is the signal we
    // use to walk away from the alignment entirely; the Blob is still useful.
    const text = 'Mr.';
    const expanded = ['M', 'i', 's', 't', 'e', 'r'];
    const json = {
      audio_base64: HI_BASE64,
      alignment: {
        characters: expanded,
        character_start_times_seconds: [0.0, 0.05, 0.10, 0.15, 0.20, 0.25],
        character_end_times_seconds: [0.05, 0.10, 0.15, 0.20, 0.25, 0.30],
      },
    };
    const { blob, alignment } = parseTimestampsResponse(json, text);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(alignment).toBeUndefined();
  });

  it('drops alignment when start_times length differs from text length', () => {
    const text = 'Hi';
    const json = {
      audio_base64: HI_BASE64,
      alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0, 0.08, 0.20], // length 3, text length 2
        character_end_times_seconds: [0.08, 0.16, 0.24],
      },
    };
    const { blob, alignment } = parseTimestampsResponse(json, text);
    expect(blob).toBeInstanceOf(Blob);
    expect(alignment).toBeUndefined();
  });

  it('drops alignment when start_times contains a non-finite entry', () => {
    const text = 'Hi';
    const json = {
      audio_base64: HI_BASE64,
      alignment: {
        characters: ['H', 'i'],
        character_start_times_seconds: [0, Number.NaN],
        character_end_times_seconds: [0.08, 0.16],
      },
    };
    const { blob, alignment } = parseTimestampsResponse(json, text);
    expect(blob).toBeInstanceOf(Blob);
    expect(alignment).toBeUndefined();
  });

  it('returns just the Blob when the response has no alignment field at all', () => {
    const text = 'Hi';
    const json = { audio_base64: HI_BASE64 };
    const { blob, alignment } = parseTimestampsResponse(json, text);
    expect(blob.size).toBeGreaterThan(0);
    expect(alignment).toBeUndefined();
  });

  it('throws when audio_base64 is missing', () => {
    expect(() => parseTimestampsResponse({}, 'Hi')).toThrow(/audio_base64/i);
    expect(() => parseTimestampsResponse({ audio_base64: 0 }, 'Hi')).toThrow();
    expect(() => parseTimestampsResponse(null, 'Hi')).toThrow();
  });
});

describe('parseElevenLabsErrorMessage', () => {
  it('produces the rejected-key message on 401', () => {
    const msg = parseElevenLabsErrorMessage(401, 'Unauthorized', '{"detail":{"status":"invalid_api_key","message":"bad key"}}');
    expect(msg).toMatch(/key was rejected/i);
    expect(msg).toMatch(/Settings/);
  });

  it('produces the library-voice guidance on 402 with library voice text', () => {
    const body = '{"detail":{"status":"voice_not_found","message":"This is a library voice. Please upgrade to use it."}}';
    const msg = parseElevenLabsErrorMessage(402, 'Payment Required', body);
    expect(msg).toMatch(/library voices/i);
    expect(msg).toMatch(/voice-library/);
  });

  it('falls back to the generic message for non-401 / non-library 4xx', () => {
    const msg = parseElevenLabsErrorMessage(500, 'Internal Server Error', '{"detail":{"message":"something exploded"}}');
    expect(msg).toContain('500');
    expect(msg).toContain('Internal Server Error');
    expect(msg).toContain('something exploded');
  });

  it('handles non-JSON error bodies without throwing', () => {
    const msg = parseElevenLabsErrorMessage(503, 'Service Unavailable', 'plain text wall of bytes');
    expect(msg).toContain('503');
    expect(msg).toContain('plain text wall of bytes');
  });

  it('truncates very long error bodies to 240 chars in the generic branch', () => {
    const long = 'x'.repeat(1000);
    const msg = parseElevenLabsErrorMessage(500, 'Server Error', long);
    // 240 is the slice cap; the message wraps it in surrounding text so the
    // total is bounded but the body slice itself is at most 240 chars.
    expect(msg.length).toBeLessThan(400);
  });
});
