// Curated phoneme -> mouth-shape video lookup for the PhonemeLab "Watch" tab.
//
// IMPORTANT: Curate by hand. Do NOT regenerate this from a model -- a wrong
// video id silently embeds the wrong (or worse: an unrelated) clip. The IDs
// below were harvested from BBC Learning English's "English Pronunciation
// Tips" YouTube series via yt-dlp + ytsearch, then matched to our phoneme
// list by parsing the IPA symbol from each video title. To re-verify or
// extend, run:
//
//   yt-dlp --flat-playlist --print "%(title)s|%(id)s" \
//     "ytsearch50:BBC Learning English Pronunciation Tips vowel"
//
// The series uses RP transcriptions, so /əʊ/ in BBC titles maps to our /oʊ/
// and /g/ maps to our IPA /ɡ/ (script g, U+0261). All other symbols match.

export interface PhonemeVideo {
  provider: 'youtube';
  videoId: string;       // 11-char YouTube id
  start?: number;        // Seconds offset, optional
  credit: string;        // Channel name shown under the embed
}

const BBC = 'BBC Learning English';

// Every entry below was sourced from a BBC "English Pronunciation Tips" video
// whose title contained the matching IPA symbol. Verified 44/44 against
// src/dashboard/components/shadow/ipa/phonemes.ts on harvest.
export const PHONEME_VIDEOS: Record<string, PhonemeVideo> = {
  // ===== Vowels =====
  'iː': { provider: 'youtube', videoId: 'RZmGzSb-6OM', credit: BBC },
  'ɪ':  { provider: 'youtube', videoId: 'TNFKG0yvDx4', credit: BBC },
  'e':  { provider: 'youtube', videoId: 'hLN1cdSTDo8', credit: BBC },
  'æ':  { provider: 'youtube', videoId: 'qVhaIHk88a8', credit: BBC },
  'ʌ':  { provider: 'youtube', videoId: 'PZwKFFp7V50', credit: BBC },
  'ə':  { provider: 'youtube', videoId: 'wg0P0oYkniE', credit: BBC },
  'ɜː': { provider: 'youtube', videoId: 'zSJJWHymEPw', credit: BBC },
  'uː': { provider: 'youtube', videoId: 'mnKEGLuEzV4', credit: BBC },
  'ʊ':  { provider: 'youtube', videoId: 'eJ7dM_LU9t4', credit: BBC },
  'ɔː': { provider: 'youtube', videoId: 'KHllC40_u1Q', credit: BBC },
  'ɒ':  { provider: 'youtube', videoId: 'MAk-XtHsyzM', credit: BBC },
  'ɑː': { provider: 'youtube', videoId: 'uDHMuMQdBNw', credit: BBC },

  // ===== Diphthongs =====
  'eɪ': { provider: 'youtube', videoId: '5FMPlqlFt9g', credit: BBC },
  'aɪ': { provider: 'youtube', videoId: 'Hb8COxAtl14', credit: BBC },
  'ɔɪ': { provider: 'youtube', videoId: 'lFRrEI85IcM', credit: BBC },
  'aʊ': { provider: 'youtube', videoId: '9WDnVMQIaTs', credit: BBC },
  // BBC RP variant /əʊ/ for our GA /oʊ/.
  'oʊ': { provider: 'youtube', videoId: 'r1BRCG0P9C8', credit: BBC },
  'ɪə': { provider: 'youtube', videoId: 'vC0h4S0YPJc', credit: BBC },
  'eə': { provider: 'youtube', videoId: '0J7-5maJJIk', credit: BBC },
  'ʊə': { provider: 'youtube', videoId: 'nHSqluHrD-U', credit: BBC },

  // ===== Consonants - stops =====
  'p': { provider: 'youtube', videoId: 'AZRREr7DqqM', credit: BBC },
  'b': { provider: 'youtube', videoId: 'yP7aCKO6bTE', credit: BBC },
  't': { provider: 'youtube', videoId: '0T1QYByMxrs', credit: BBC },
  'd': { provider: 'youtube', videoId: 'qA5ZYC89oso', credit: BBC },
  'k': { provider: 'youtube', videoId: 'd1jyIpAmLe8', credit: BBC },
  // BBC titles use ASCII /g/; phonemes.ts uses script /ɡ/ (U+0261).
  'ɡ': { provider: 'youtube', videoId: '9eAqj9EfeK0', credit: BBC },

  // ===== Consonants - fricatives =====
  'f': { provider: 'youtube', videoId: 'vE12RFyH-hY', credit: BBC },
  'v': { provider: 'youtube', videoId: 'mO04G0v5a_c', credit: BBC },
  'θ': { provider: 'youtube', videoId: 'b4Aj3k65HSo', credit: BBC },
  'ð': { provider: 'youtube', videoId: 'tu1t3Fn5Lw8', credit: BBC },
  's': { provider: 'youtube', videoId: 'QtH3vRXmvvo', credit: BBC },
  'z': { provider: 'youtube', videoId: 'o1ZvmX80t7Q', credit: BBC },
  'ʃ': { provider: 'youtube', videoId: 'NF92RdZC6wE', credit: BBC },
  'ʒ': { provider: 'youtube', videoId: 'bTxeAiBF61I', credit: BBC },
  'h': { provider: 'youtube', videoId: 'DM_gN6imoC8', credit: BBC },

  // ===== Consonants - affricates =====
  'tʃ': { provider: 'youtube', videoId: 'PykxZ5kkrjs', credit: BBC },
  'dʒ': { provider: 'youtube', videoId: '0IeQmGdo7gQ', credit: BBC },

  // ===== Consonants - nasals =====
  'm': { provider: 'youtube', videoId: '0Te4Us8Tsv8', credit: BBC },
  'n': { provider: 'youtube', videoId: 'qkgucMjv4T0', credit: BBC },
  'ŋ': { provider: 'youtube', videoId: 'rgWse3tloTw', credit: BBC },

  // ===== Consonants - approximants =====
  'l': { provider: 'youtube', videoId: 'CwWLgmMk0Z0', credit: BBC },
  'r': { provider: 'youtube', videoId: 'Lxuo14hjP_8', credit: BBC },
  'j': { provider: 'youtube', videoId: '_Fi9E6Yw-qg', credit: BBC },
  'w': { provider: 'youtube', videoId: 'HzhPB1hXG-o', credit: BBC },
};

export function getPhonemeVideo(symbol: string): PhonemeVideo | undefined {
  return PHONEME_VIDEOS[symbol];
}
