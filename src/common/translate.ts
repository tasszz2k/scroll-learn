// Lightweight EN<->VI translator using Google's public translate endpoint.
// No API key, no extra dependencies.

export type TranslateLang = 'en' | 'vi';

// Vietnamese-only diacritics (letters and tone marks not present in plain English).
const VI_DIACRITIC_RE = /[ăâđêôơưĂÂĐÊÔƠƯàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸ]/;

export function detectVietnamese(text: string): boolean {
  return VI_DIACRITIC_RE.test(text);
}

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

async function callEndpoint(text: string, from: TranslateLang, to: TranslateLang): Promise<string> {
  const url = `${ENDPOINT}?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`translate http ${res.status}`);
  }
  const data = await res.json();
  // Response shape: [[[translated, original, ...], ...], ...]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('translate: unexpected response shape');
  }
  const segments = data[0] as Array<[string, string, ...unknown[]]>;
  return segments.map(seg => (seg && typeof seg[0] === 'string' ? seg[0] : '')).join('');
}

export async function translate(text: string, from: TranslateLang, to: TranslateLang): Promise<string> {
  if (!text.trim()) return text;
  if (from === to) return text;
  try {
    return await callEndpoint(text, from, to);
  } catch {
    // One retry with a small backoff
    await new Promise(resolve => setTimeout(resolve, 500));
    return await callEndpoint(text, from, to);
  }
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
