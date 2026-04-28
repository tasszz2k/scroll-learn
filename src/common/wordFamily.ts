// Looks up the derivational "word family" for a single English lemma using the
// public Datamuse API. Used to enrich single-word note captures (e.g.
// happy → happily, happiness; paradigm → paradigmatic, paradigms).
//
// Datamuse `sp=<prefix>*&md=p` returns words matching a spelling-prefix and
// includes part-of-speech tags. We send a smart set of prefixes (the lemma
// itself plus stems produced by stripping common derivational suffixes), merge
// the responses, and surface the top entries by score.

import type { PartOfSpeech } from './translate';

export interface DerivedForm {
  word: string;
  pos: PartOfSpeech;
}

interface DatamuseEntry {
  word?: unknown;
  score?: unknown;
  tags?: unknown;
}

const MAX_FORMS = 8;
const REQUEST_TIMEOUT_MS = 2000;
const OVERALL_DEADLINE_MS = 3500;
const DATAMUSE_API = 'https://api.datamuse.com/words';
const RESULTS_PER_PREFIX = 25;

const DATAMUSE_POS_MAP: Record<string, PartOfSpeech> = {
  n: 'noun',
  v: 'verb',
  adj: 'adjective',
  adv: 'adverb',
};

// Common derivational suffixes, ordered longest-first so the most specific
// match wins. Each entry is stripped to expose a stem; e.g. autonomously → ously
// → autonom; analysis → sis → analy; pedagogical → ical → pedagog. Two-step
// recursion (below) handles compound endings like -ically by stripping -ly
// first then -ical. Mix covers Germanic, Latin, and Greek-origin nominalizations.
const STRIP_SUFFIXES = [
  // 5-6 chars
  'ically', 'ously', 'fully',
  // 4 chars
  'ical', 'ness', 'ment', 'less', 'able', 'ible', 'ship', 'sive', 'ance', 'ence',
  // 3 chars
  'ous', 'ity', 'ful', 'ing', 'ion', 'ist', 'ism', 'ive', 'ant', 'ent', 'ate', 'ize', 'ise', 'sis',
  // 2 chars
  'ic', 'al', 'ed', 'er', 'ly',
];

// Default minimum stem length for most suffixes. Short stems (<4 chars) tend to
// match unrelated word families (happy → happ → happen pollution), so we hold
// the line at 4 by default. Gerunds get a looser bound (see below) so common
// short verbs like "add" can still be recovered from their -ing form.
const MIN_STEM_LEN = 4;
const MIN_STEM_LEN_ING = 3;
const DOUBLING_CONSONANTS = /[bdfgklmnprstv]/;

function isAsciiLatin(s: string): boolean {
  return /^[a-z]+$/.test(s);
}

function stripOnce(lemma: string): string | null {
  for (const suffix of STRIP_SUFFIXES) {
    if (!lemma.endsWith(suffix)) continue;
    let stem = lemma.slice(0, lemma.length - suffix.length);
    const minLen = suffix === 'ing' ? MIN_STEM_LEN_ING : MIN_STEM_LEN;
    if (stem.length < minLen) continue;
    if (!/[aeiou]/.test(stem)) continue; // need at least one vowel for a plausible stem
    // CVC consonant-doubling on -ing (running → runn → run; swimming → swim).
    // Skip if the post-strip result would itself be too short, which guards
    // against over-stripping lemmas that already end in a doubled consonant
    // (adding → add, NOT ad).
    if (suffix === 'ing' && stem.length >= 4) {
      const last = stem[stem.length - 1];
      const prev = stem[stem.length - 2];
      if (last === prev && DOUBLING_CONSONANTS.test(last)) {
        const candidate = stem.slice(0, -1);
        if (candidate.length >= MIN_STEM_LEN_ING) {
          stem = candidate;
        }
      }
    }
    return stem;
  }
  return null;
}

function buildPrefixes(lemma: string, pos: PartOfSpeech): string[] {
  const prefixes = new Set<string>([lemma]);

  // Strip derivational suffixes recursively up to depth 2 so compound endings
  // (e.g. -ically = -ly + -ical) reveal a deep stem.
  let current = lemma;
  for (let depth = 0; depth < 2; depth++) {
    const stem = stripOnce(current);
    if (!stem || stem === current || prefixes.has(stem)) break;
    prefixes.add(stem);
    current = stem;
  }

  // POS-specific fixups that aren't pure suffix strips.
  if (lemma.length > 2) {
    if (pos === 'adjective' && lemma.endsWith('y')) {
      prefixes.add(lemma.slice(0, -1) + 'i');
    }
    if (pos === 'verb' && lemma.endsWith('e')) {
      prefixes.add(lemma.slice(0, -1));
    }
  }

  return Array.from(prefixes);
}

async function fetchPrefix(prefix: string, signal: AbortSignal): Promise<DatamuseEntry[]> {
  try {
    const url = `${DATAMUSE_API}?sp=${encodeURIComponent(prefix)}*&md=p&max=${RESULTS_PER_PREFIX}`;
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? (data as DatamuseEntry[]) : [];
  } catch {
    return [];
  }
}

function fetchPrefixWithTimeout(prefix: string): Promise<DatamuseEntry[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  return fetchPrefix(prefix, ctrl.signal).finally(() => clearTimeout(timer));
}

function pickDisplayPos(posSet: Set<PartOfSpeech>, excludePos?: PartOfSpeech): PartOfSpeech | null {
  // When `excludePos` is set: prefer a POS that differs from it; if every POS
  // matches the lemma's POS, drop the entry. When unset: pick any available POS.
  const ordered: PartOfSpeech[] = ['noun', 'verb', 'adjective', 'adverb'];
  if (excludePos) {
    for (const p of ordered) {
      if (p !== excludePos && posSet.has(p)) return p;
    }
    return null;
  }
  for (const p of ordered) {
    if (posSet.has(p)) return p;
  }
  return null;
}

export function parseDatamuseFamily(
  data: unknown,
  lemma: string,
  excludePos?: PartOfSpeech,
): DerivedForm[] {
  if (!Array.isArray(data)) return [];
  const lower = lemma.toLowerCase();

  const candidates = (data as DatamuseEntry[])
    .filter((e): e is DatamuseEntry => !!e && typeof e === 'object' && typeof e.word === 'string')
    .sort((a, b) => {
      const sa = typeof a.score === 'number' ? a.score : 0;
      const sb = typeof b.score === 'number' ? b.score : 0;
      return sb - sa;
    });

  const out: DerivedForm[] = [];
  const seen = new Set<string>();
  for (const entry of candidates) {
    const word = String(entry.word).trim().toLowerCase();
    if (!word) continue;
    if (word === lower) continue;
    if (/[\s-]/.test(word)) continue;
    if (!isAsciiLatin(word)) continue;
    if (seen.has(word)) continue;

    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    const posSet = new Set<PartOfSpeech>();
    for (const t of tags) {
      if (typeof t !== 'string') continue;
      const mapped = DATAMUSE_POS_MAP[t.toLowerCase()];
      if (mapped) posSet.add(mapped);
    }
    if (posSet.size === 0) continue;

    const pos = pickDisplayPos(posSet, excludePos);
    if (!pos) continue;

    seen.add(word);
    out.push({ word, pos });
    if (out.length >= MAX_FORMS) break;
  }
  return out;
}

export async function wordFamilyFor(lemma: string, pos: PartOfSpeech): Promise<DerivedForm[]> {
  const lower = lemma.trim().toLowerCase();
  if (!lower || lower.length < 2 || !isAsciiLatin(lower)) return [];

  const prefixes = buildPrefixes(lower, pos);
  try {
    const fetchAll = Promise.allSettled(prefixes.map(p => fetchPrefixWithTimeout(p)))
      .then(results => {
        const merged: DatamuseEntry[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled') merged.push(...r.value);
        }
        // Production: don't filter by lemma POS — show all valid derivations.
        return parseDatamuseFamily(merged, lower);
      });
    const deadline = new Promise<DerivedForm[]>(resolve => {
      setTimeout(() => resolve([]), OVERALL_DEADLINE_MS);
    });
    return await Promise.race([fetchAll, deadline]);
  } catch {
    return [];
  }
}
