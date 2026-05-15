import { describe, expect, it } from 'vitest';
import {
  buildKeywordSuggestPrompt,
  buildKeywordAutoGroupPrompt,
  extractJsonArrayBlock,
  extractJsonObjectBlock,
  parseKeywordSuggestJson,
  parseKeywordAutoGroupJson,
} from '../src/dashboard/components/keywordSuggestPrompt';

describe('buildKeywordSuggestPrompt', () => {
  it('embeds the topic verbatim', () => {
    const prompt = buildKeywordSuggestPrompt('crypto drama');
    expect(prompt).toContain('crypto drama');
  });

  it('trims surrounding whitespace from the topic', () => {
    const prompt = buildKeywordSuggestPrompt('   election politics   ');
    expect(prompt).toContain('TOPIC\nelection politics\n');
    expect(prompt).not.toContain('   election');
  });

  it('asks for both English and Vietnamese coverage', () => {
    const prompt = buildKeywordSuggestPrompt('sports');
    expect(prompt.toLowerCase()).toContain('vietnamese');
    expect(prompt).toContain('diacritics');
  });

  it('asks for a JSON array output and forbids prose / fences', () => {
    const prompt = buildKeywordSuggestPrompt('topic');
    expect(prompt).toMatch(/JSON array/i);
    expect(prompt).toMatch(/no code fences/i);
  });

  it('asks the model to use lowercase and avoid stop-words', () => {
    const prompt = buildKeywordSuggestPrompt('topic');
    expect(prompt).toMatch(/lowercase/i);
    expect(prompt).toMatch(/stop-words/i);
  });
});

describe('extractJsonArrayBlock', () => {
  it('returns the array verbatim when the response is just JSON', () => {
    const raw = '["a", "b", "c"]';
    expect(extractJsonArrayBlock(raw)).toBe(raw);
  });

  it('strips ```json fences', () => {
    const raw = '```json\n["a", "b"]\n```';
    expect(extractJsonArrayBlock(raw)).toBe('["a", "b"]');
  });

  it('strips bare ``` fences', () => {
    const raw = '```\n["a", "b"]\n```';
    expect(extractJsonArrayBlock(raw)).toBe('["a", "b"]');
  });

  it('extracts the array even when surrounded by chatter', () => {
    const raw = 'Sure, here you go:\n["a", "b"]\nLet me know if you need more.';
    expect(extractJsonArrayBlock(raw)).toBe('["a", "b"]');
  });

  it('balances brackets when the array contains square brackets in strings', () => {
    const raw = '["a [b]", "c"]';
    expect(extractJsonArrayBlock(raw)).toBe('["a [b]", "c"]');
  });

  it('returns null when no array is present', () => {
    expect(extractJsonArrayBlock('totally not json')).toBeNull();
  });
});

describe('parseKeywordSuggestJson', () => {
  it('parses a clean JSON array', () => {
    const result = parseKeywordSuggestJson('["bitcoin", "crypto", "ethereum"]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['bitcoin', 'crypto', 'ethereum']);
  });

  it('strips ```json fences and parses', () => {
    const raw = '```json\n["a", "b"]\n```';
    const result = parseKeywordSuggestJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['a', 'b']);
  });

  it('parses an array embedded in chatter', () => {
    const raw = 'Here are the keywords: ["foo", "bar"] -- enjoy.';
    const result = parseKeywordSuggestJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['foo', 'bar']);
  });

  it('preserves Vietnamese diacritics', () => {
    const raw = '["tiền tệ", "chính trị", "miễn trừ"]';
    const result = parseKeywordSuggestJson(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['tiền tệ', 'chính trị', 'miễn trừ']);
  });

  it('trims whitespace and stray double-quote characters from each entry', () => {
    const result = parseKeywordSuggestJson('["  hello  ", "\\"world\\""]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['hello', 'world']);
  });

  it('skips non-string entries', () => {
    const result = parseKeywordSuggestJson('["a", 42, null, true, "b"]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['a', 'b']);
  });

  it('dedupes case-insensitively', () => {
    const result = parseKeywordSuggestJson('["War", "war", "WAR", "conflict"]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['War', 'conflict']);
  });

  it('caps very long arrays at 30 entries', () => {
    const items = Array.from({ length: 80 }, (_, i) => `kw${i}`);
    const result = parseKeywordSuggestJson(JSON.stringify(items));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toHaveLength(30);
  });

  it('rejects empty input', () => {
    const result = parseKeywordSuggestJson('');
    expect(result.ok).toBe(false);
  });

  it('recovers an inner array when the model wraps it in an object', () => {
    // Defensive: some Gemini responses arrive as {"keywords": [...]} even
    // though the prompt asks for a bare array. Fall through to the inner
    // array rather than failing.
    const result = parseKeywordSuggestJson('{"keywords": ["a", "b"]}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keywords).toEqual(['a', 'b']);
  });

  it('rejects an object response that contains no array', () => {
    const result = parseKeywordSuggestJson('{"keywords": "a, b, c"}');
    expect(result.ok).toBe(false);
  });

  it('rejects an array of only empty strings', () => {
    const result = parseKeywordSuggestJson('["", "  ", "\\""]');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain('no usable keywords');
  });

  it('rejects malformed JSON', () => {
    const result = parseKeywordSuggestJson('["a", "b"');
    expect(result.ok).toBe(false);
  });
});

describe('buildKeywordAutoGroupPrompt', () => {
  it('embeds every input keyword on its own line', () => {
    const prompt = buildKeywordAutoGroupPrompt(['bitcoin', 'election', 'kpop']);
    expect(prompt).toContain('\nbitcoin\n');
    expect(prompt).toContain('\nelection\n');
    expect(prompt).toContain('\nkpop\n');
  });

  it('preserves Vietnamese diacritics in the embedded keyword list', () => {
    const prompt = buildKeywordAutoGroupPrompt(['tiền tệ', 'miễn trừ']);
    expect(prompt).toContain('tiền tệ');
    expect(prompt).toContain('miễn trừ');
  });

  it('lists existing group labels when provided', () => {
    const prompt = buildKeywordAutoGroupPrompt(['bitcoin'], ['Crypto', 'Politics']);
    expect(prompt).toContain('EXISTING TOPIC GROUPS');
    expect(prompt).toContain('- Crypto');
    expect(prompt).toContain('- Politics');
  });

  it('omits the existing-groups block when no labels are provided', () => {
    const prompt = buildKeywordAutoGroupPrompt(['bitcoin']);
    expect(prompt).not.toContain('EXISTING TOPIC GROUPS');
  });

  it('asks for a JSON object output and forbids fences / prose', () => {
    const prompt = buildKeywordAutoGroupPrompt(['x']);
    expect(prompt).toMatch(/JSON object/);
    expect(prompt).toMatch(/no code fences/i);
    expect(prompt).toMatch(/no prose/i);
  });

  it('forbids the model from inventing or translating keywords', () => {
    const prompt = buildKeywordAutoGroupPrompt(['x']);
    expect(prompt).toMatch(/Do NOT invent/i);
    expect(prompt).toMatch(/do NOT translate/i);
  });

  it('asks for 2 to 8 groups', () => {
    const prompt = buildKeywordAutoGroupPrompt(['x']);
    expect(prompt).toMatch(/2 to 8 topic groups/);
  });
});

describe('extractJsonObjectBlock', () => {
  it('returns the object verbatim when the response is just JSON', () => {
    const raw = '{"groups": []}';
    expect(extractJsonObjectBlock(raw)).toBe(raw);
  });

  it('strips ```json fences', () => {
    const raw = '```json\n{"groups": []}\n```';
    expect(extractJsonObjectBlock(raw)).toBe('{"groups": []}');
  });

  it('extracts the object even when surrounded by chatter', () => {
    const raw = 'Sure, here you go:\n{"groups": []}\nLet me know if you need more.';
    expect(extractJsonObjectBlock(raw)).toBe('{"groups": []}');
  });

  it('balances braces when strings contain braces', () => {
    const raw = '{"a": "x { y } z", "b": 1}';
    expect(extractJsonObjectBlock(raw)).toBe(raw);
  });

  it('returns null when no object is present', () => {
    expect(extractJsonObjectBlock('totally not json')).toBeNull();
  });
});

describe('parseKeywordAutoGroupJson', () => {
  const inputs = ['bitcoin', 'ethereum', 'election', 'senate', 'kpop', 'bts'];

  it('parses a clean grouped response', () => {
    const raw = JSON.stringify({
      groups: [
        { label: 'Crypto', keywords: ['bitcoin', 'ethereum'] },
        { label: 'Politics', keywords: ['election', 'senate'] },
        { label: 'K-Pop', keywords: ['kpop', 'bts'] },
      ],
    });
    const result = parseKeywordAutoGroupJson(raw, inputs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(3);
    expect(result.groups[0]).toEqual({ label: 'Crypto', keywords: ['bitcoin', 'ethereum'] });
  });

  it('strips ```json fences and parses', () => {
    const raw = '```json\n' + JSON.stringify({
      groups: [{ label: 'X', keywords: ['bitcoin'] }],
    }) + '\n```';
    const result = parseKeywordAutoGroupJson(raw, inputs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0].keywords).toEqual(['bitcoin']);
  });

  it('filters out keywords the model invented (not in the original input)', () => {
    const raw = JSON.stringify({
      groups: [
        { label: 'Crypto', keywords: ['bitcoin', 'dogecoin', 'shiba'] },
      ],
    });
    const result = parseKeywordAutoGroupJson(raw, inputs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0].keywords).toEqual(['bitcoin']);
  });

  it('preserves the user\'s original casing even if the model lowercased', () => {
    const raw = JSON.stringify({
      groups: [{ label: 'People', keywords: ['vladimir putin'] }],
    });
    const result = parseKeywordAutoGroupJson(raw, ['Vladimir Putin', 'Trump']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0].keywords).toEqual(['Vladimir Putin']);
  });

  it('preserves Vietnamese diacritics from the original input', () => {
    const raw = JSON.stringify({
      groups: [{ label: 'Finance', keywords: ['tiền tệ'] }],
    });
    const result = parseKeywordAutoGroupJson(raw, ['tiền tệ']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0].keywords).toEqual(['tiền tệ']);
  });

  it('places each keyword in at most one group (first occurrence wins)', () => {
    const raw = JSON.stringify({
      groups: [
        { label: 'Crypto', keywords: ['bitcoin'] },
        { label: 'Other', keywords: ['bitcoin', 'ethereum'] },
      ],
    });
    const result = parseKeywordAutoGroupJson(raw, inputs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0]).toEqual({ label: 'Crypto', keywords: ['bitcoin'] });
    expect(result.groups[1]).toEqual({ label: 'Other', keywords: ['ethereum'] });
  });

  it('drops groups whose keywords all got filtered out', () => {
    const raw = JSON.stringify({
      groups: [
        { label: 'Crypto', keywords: ['bitcoin'] },
        { label: 'Filler', keywords: ['totally-fake-keyword'] },
      ],
    });
    const result = parseKeywordAutoGroupJson(raw, inputs);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].label).toBe('Crypto');
  });

  it('rejects empty input', () => {
    const result = parseKeywordAutoGroupJson('', inputs);
    expect(result.ok).toBe(false);
  });

  it('rejects a response that is not a JSON object', () => {
    const result = parseKeywordAutoGroupJson('["a", "b"]', inputs);
    expect(result.ok).toBe(false);
  });

  it('rejects a response missing the groups array', () => {
    const result = parseKeywordAutoGroupJson('{"clusters": []}', inputs);
    expect(result.ok).toBe(false);
  });

  it('rejects a response that filters down to zero usable groups', () => {
    const raw = JSON.stringify({
      groups: [
        { label: 'Filler', keywords: ['not-real-1'] },
        { label: 'Other', keywords: ['not-real-2'] },
      ],
    });
    const result = parseKeywordAutoGroupJson(raw, inputs);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain('no usable groups');
  });

  it('matches keywords case-insensitively against the input set', () => {
    const raw = JSON.stringify({
      groups: [{ label: 'Crypto', keywords: ['BITCOIN', 'Ethereum'] }],
    });
    const result = parseKeywordAutoGroupJson(raw, ['bitcoin', 'ethereum']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups[0].keywords).toEqual(['bitcoin', 'ethereum']);
  });

  it('rejects malformed JSON', () => {
    const result = parseKeywordAutoGroupJson('{"groups": [', inputs);
    expect(result.ok).toBe(false);
  });
});
