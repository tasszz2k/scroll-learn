import { describe, expect, it } from 'vitest';
import { PHONEMES } from '../src/dashboard/components/shadow/ipa/phonemes';
import {
  PHONEME_VIDEOS,
  getPhonemeVideo,
} from '../src/dashboard/components/shadow/ipa/phonemeVideos';

describe('phonemeVideos', () => {
  it('covers every phoneme in phonemes.ts', () => {
    const missing = PHONEMES.filter((p) => !PHONEME_VIDEOS[p.symbol]).map((p) => p.symbol);
    expect(missing).toEqual([]);
  });

  it('uses 11-character YouTube ids', () => {
    for (const [symbol, entry] of Object.entries(PHONEME_VIDEOS)) {
      // Standard YouTube ids are 11 chars from [A-Za-z0-9_-]. Fail loudly if a
      // future edit pastes a full URL or a different host's id.
      expect(entry.videoId, `videoId for /${symbol}/`).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(entry.provider, `provider for /${symbol}/`).toBe('youtube');
      expect(entry.credit.length, `credit for /${symbol}/`).toBeGreaterThan(0);
    }
  });

  it('getPhonemeVideo returns undefined for unknown symbols', () => {
    expect(getPhonemeVideo('xx-not-a-phoneme')).toBeUndefined();
  });
});
