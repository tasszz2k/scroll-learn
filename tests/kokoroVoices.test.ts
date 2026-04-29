import { describe, expect, it } from 'vitest';
import {
  KOKORO_VOICES,
  assignKokoroVoicesForCast,
  pickRandomVoiceForSpeaker,
} from '../src/common/tts/kokoroVoices';

describe('KOKORO_VOICES catalog', () => {
  it('contains all expected voices with consistent id naming', () => {
    expect(KOKORO_VOICES.length).toBeGreaterThanOrEqual(28);
    for (const v of KOKORO_VOICES) {
      // Convention: <region><gender>_<lowercase-name>
      expect(v.id).toMatch(/^[ab][fm]_[a-z]+$/);
      const regionChar = v.id[0];
      const genderChar = v.id[1];
      expect(v.region).toBe(regionChar === 'a' ? 'us' : 'gb');
      expect(v.gender).toBe(genderChar === 'f' ? 'female' : 'male');
    }
  });

  it('has unique voice ids', () => {
    const ids = new Set(KOKORO_VOICES.map(v => v.id));
    expect(ids.size).toBe(KOKORO_VOICES.length);
  });
});

describe('pickRandomVoiceForSpeaker', () => {
  it('never returns a voice that is already in `used` when capacity allows', () => {
    const used = new Set<string>();
    // Pick more than half the catalog and ensure none repeat.
    const half = Math.floor(KOKORO_VOICES.length / 2);
    for (let i = 0; i < half; i++) {
      const v = pickRandomVoiceForSpeaker(used);
      expect(used.has(v.id)).toBe(false);
      used.add(v.id);
    }
  });

  it('respects region preference when there is capacity', () => {
    const used = new Set<string>();
    // 100 picks with region=us; should never pick a gb voice.
    for (let i = 0; i < 100; i++) {
      const v = pickRandomVoiceForSpeaker(used, { region: 'us' });
      expect(v.region).toBe('us');
    }
  });

  it('respects gender preference when there is capacity', () => {
    const used = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const v = pickRandomVoiceForSpeaker(used, { gender: 'female' });
      expect(v.gender).toBe('female');
    }
  });

  it('drops gender preference before region when region pool exhausted of gender', () => {
    // Saturate every US female voice so a (us, female) preference can't be served.
    const used = new Set(
      KOKORO_VOICES.filter(v => v.region === 'us' && v.gender === 'female').map(v => v.id),
    );
    const v = pickRandomVoiceForSpeaker(used, { region: 'us', gender: 'female' });
    // Ladder drops gender first, so the result should be a US voice (any gender).
    expect(v.region).toBe('us');
  });

  it('falls back to any voice when every preferred bucket is used', () => {
    // Saturate every US voice so the entire region:'us' bucket is exhausted.
    const used = new Set(KOKORO_VOICES.filter(v => v.region === 'us').map(v => v.id));
    const v = pickRandomVoiceForSpeaker(used, { region: 'us' });
    // Region constraint relaxed -- pick anything not in `used`.
    expect(used.has(v.id)).toBe(false);
  });

  it('returns a duplicate (rather than throwing) when the entire catalog is used', () => {
    const used = new Set(KOKORO_VOICES.map(v => v.id));
    const v = pickRandomVoiceForSpeaker(used);
    // A voice was returned (no throw); it WILL be in `used` since we exhausted everything.
    expect(used.has(v.id)).toBe(true);
  });
});

describe('assignKokoroVoicesForCast', () => {
  it('assigns distinct voices when cast size is within catalog capacity', () => {
    const cast = ['A', 'B', 'C', 'D', 'E'];
    const map = assignKokoroVoicesForCast(cast);
    expect(map.size).toBe(cast.length);
    const voiceIds = Array.from(map.values()).map(v => v.id);
    const unique = new Set(voiceIds);
    expect(unique.size).toBe(voiceIds.length);
  });

  it('reuses the same voice for repeat speakerIds', () => {
    const map = assignKokoroVoicesForCast(['A', 'B', 'A', 'B', 'A']);
    expect(map.size).toBe(2);
    expect(map.has('A')).toBe(true);
    expect(map.has('B')).toBe(true);
    expect(map.get('A')!.id).not.toBe(map.get('B')!.id);
  });

  it('returns valid voices from the catalog', () => {
    const cast = ['A', 'B'];
    const map = assignKokoroVoicesForCast(cast);
    for (const v of map.values()) {
      expect(KOKORO_VOICES.some(catalogV => catalogV.id === v.id)).toBe(true);
    }
  });

  it('handles a single-speaker cast', () => {
    const map = assignKokoroVoicesForCast(['A']);
    expect(map.size).toBe(1);
    expect(map.get('A')).toBeDefined();
  });

  it('handles an empty cast', () => {
    const map = assignKokoroVoicesForCast([]);
    expect(map.size).toBe(0);
  });
});
