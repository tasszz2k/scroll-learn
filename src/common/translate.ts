// Lightweight EN<->VI translator using Google's public translate endpoint.
// No API key, no extra dependencies.

import type { TranslateLang } from './types';

export type { TranslateLang };

// Vietnamese-only diacritics (letters and tone marks not present in plain English).
const VI_DIACRITIC_RE = /[ăâđêôơưĂÂĐÊÔƠƯàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸ]/;

export function detectVietnamese(text: string): boolean {
  return VI_DIACRITIC_RE.test(text);
}

export function isSingleWord(text: string): boolean {
  const stripped = text.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!stripped) return false;
  return !/\s/.test(stripped);
}

export type PartOfSpeech =
  | 'noun' | 'verb' | 'adjective' | 'adverb'
  | 'pronoun' | 'preposition' | 'conjunction' | 'interjection' | 'other';

export interface DictionarySense {
  pos: PartOfSpeech;
  posLabel: string;
  terms: string[];
}

const POS_LABEL_MAP: Record<string, PartOfSpeech> = {
  noun: 'noun',
  'danh từ': 'noun',
  verb: 'verb',
  'động từ': 'verb',
  adjective: 'adjective',
  'tính từ': 'adjective',
  adverb: 'adverb',
  'trạng từ': 'adverb',
  preposition: 'preposition',
  'giới từ': 'preposition',
  conjunction: 'conjunction',
  'liên từ': 'conjunction',
  pronoun: 'pronoun',
  'đại từ': 'pronoun',
  interjection: 'interjection',
  'thán từ': 'interjection',
};

function normalizePosLabel(label: string): PartOfSpeech {
  return POS_LABEL_MAP[label.trim().toLowerCase()] ?? 'other';
}

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

async function callEndpointRaw(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`translate http ${res.status}`);
  }
  return res.json();
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise(resolve => setTimeout(resolve, 500));
    return await fn();
  }
}

function extractTranslation(data: unknown): string {
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('translate: unexpected response shape');
  }
  const segments = data[0] as Array<[string, string, ...unknown[]]>;
  return segments.map(seg => (seg && typeof seg[0] === 'string' ? seg[0] : '')).join('');
}

export function parseDictionarySenses(data: unknown): DictionarySense[] {
  if (!Array.isArray(data)) return [];
  // The bd block is a top-level array whose elements are
  // [posLabel: string, [terms: string[]], ...].
  for (const block of data) {
    if (!Array.isArray(block)) continue;
    if (block.length === 0) continue;
    // Heuristic: every entry in the block must look like [string, [string, ...], ...].
    const looksLikeBd = block.every((entry: unknown) =>
      Array.isArray(entry) &&
      typeof entry[0] === 'string' &&
      Array.isArray(entry[1]),
    );
    if (!looksLikeBd) continue;

    const senses: DictionarySense[] = [];
    for (const entry of block) {
      const arr = entry as unknown[];
      const posLabel = String(arr[0] ?? '').trim();
      if (!posLabel) continue;
      const termsRaw = arr[1];
      if (!Array.isArray(termsRaw)) continue;
      const terms = termsRaw
        .map(t => (typeof t === 'string' ? t : ''))
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 5);
      if (terms.length === 0) continue;
      senses.push({
        pos: normalizePosLabel(posLabel),
        posLabel,
        terms,
      });
    }
    if (senses.length > 0) return senses;
  }
  return [];
}

async function callEndpoint(text: string, from: TranslateLang, to: TranslateLang): Promise<string> {
  const url = `${ENDPOINT}?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  return extractTranslation(await callEndpointRaw(url));
}

export async function translate(text: string, from: TranslateLang, to: TranslateLang): Promise<string> {
  if (!text.trim()) return text;
  if (from === to) return text;
  return withRetry(() => callEndpoint(text, from, to));
}

export async function translateWithDictionary(
  text: string,
  from: TranslateLang,
  to: TranslateLang,
): Promise<{ translation: string; senses: DictionarySense[] }> {
  if (!text.trim() || from === to) {
    return { translation: text, senses: [] };
  }
  const url = `${ENDPOINT}?client=gtx&sl=${from}&tl=${to}&dt=t&dt=bd&q=${encodeURIComponent(text)}`;
  const data = await withRetry(() => callEndpointRaw(url));
  const translation = extractTranslation(data);
  let senses: DictionarySense[] = [];
  try {
    senses = parseDictionarySenses(data);
  } catch {
    senses = [];
  }
  return { translation, senses };
}

export interface TranslateItem {
  id: string;
  text: string;
}

export type DirectionResolver = (text: string) => { from: TranslateLang; to: TranslateLang };

export async function translateMany(
  items: TranslateItem[],
  resolveDirection: DirectionResolver,
  onProgress: (done: number) => void,
  concurrency = 5,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor = index + 1;
      const item = items[index];
      try {
        const { from, to } = resolveDirection(item.text);
        const translated = await translate(item.text, from, to);
        results.set(item.id, translated);
      } catch {
        // Persistent failure: leave empty so caller can fall back to original text
        results.set(item.id, '');
      }
      done += 1;
      onProgress(done);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}
