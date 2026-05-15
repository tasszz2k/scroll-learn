// Keyword suggestion prompt + parser. Powers the "AI suggest" row in
// Settings -> Keyword filters. The user types a topic they want to hide from
// their feed (e.g. "crypto drama", "election politics"), the model returns a
// short JSON array of related keywords, and the parent merges those into
// localSettings.blockedKeywords. The keyword auto-save effect in Settings
// then persists the new list to chrome.storage automatically.
//
// Bilingual by design: the active learner's keyword list is mixed
// English / Vietnamese (see CLAUDE.md "Hide posts by keyword" examples), so
// the prompt asks for both. Matching is whole-word and case-insensitive in
// blocker.ts, so we ask the model to use lowercase to keep the chip list
// tidy.

export interface KeywordSuggestParseOk {
  ok: true;
  keywords: string[];
}

export interface KeywordSuggestParseErr {
  ok: false;
  error: string;
}

export type KeywordSuggestParseResult = KeywordSuggestParseOk | KeywordSuggestParseErr;

const MIN_REQUEST = 8;
const MAX_REQUEST = 15;

export function buildKeywordSuggestPrompt(topic: string): string {
  const cleaned = topic.trim();
  return `You are helping a user filter their social media feed (Facebook, YouTube, Instagram). The user wants to hide every post about the following topic so they can focus on learning instead of doomscrolling.

TOPIC
${cleaned}

TASK
Generate ${MIN_REQUEST} to ${MAX_REQUEST} short keywords or short phrases (1-3 words each) that are likely to appear in posts about this topic. The blocker matches whole words case-insensitively, so each keyword acts as a filter trigger.

Cover a useful mix of:
- Direct topic terms and obvious synonyms.
- Notable people, organizations, places, or brands tied to the topic.
- Common slang, abbreviations, hashtags (drop the leading #), and spelling variants.
- Vietnamese terms for the same concepts. The user reads mixed English / Vietnamese content, so include both languages. Use proper Vietnamese diacritics (e.g. "tien te" must be written "tiền tệ").

Rules:
- Use lowercase.
- Keep each entry short. No full sentences. No explanations.
- No duplicates. No generic stop-words ("the", "and", "post", "today").
- Avoid keywords that would over-match unrelated posts.
- No emoji.

OUTPUT
Return ONLY a JSON array of strings. No prose, no code fences, no commentary.

Example for the topic "celebrity gossip":
["celebrity", "gossip", "drama", "scandal", "kardashian", "paparazzi", "showbiz", "tin sao", "drama showbiz", "sao việt"]

Now generate the JSON array for the topic above.`;
}

// Pulls the outermost [...] JSON block out of a model response, balancing
// brackets while ignoring those inside string literals. Mirrors the approach
// used by extractJsonBlock in src/dashboard/components/shadow/prompts.ts but
// targets arrays instead of objects.
export function extractJsonArrayBlock(raw: string): string | null {
  if (!raw) return null;
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const start = text.indexOf('[');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const HARD_CAP = 30;

export function parseKeywordSuggestJson(raw: string): KeywordSuggestParseResult {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty response from the model.' };
  }
  const block = extractJsonArrayBlock(raw);
  if (!block) {
    return { ok: false, error: 'No JSON array found in the response.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: 'Response was not a JSON array.' };
  }

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    // Trim whitespace and quote characters the model sometimes leaves in.
    const cleaned = item.trim().replace(/^["']+|["']+$/g, '').trim();
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    keywords.push(cleaned);
    if (keywords.length >= HARD_CAP) break;
  }

  if (keywords.length === 0) {
    return { ok: false, error: 'Response had no usable keywords.' };
  }
  return { ok: true, keywords };
}

/* -------- AI auto-group: cluster existing keywords into topic groups -------- */

export interface KeywordAutoGroupOk {
  ok: true;
  groups: { label: string; keywords: string[] }[];
}

export interface KeywordAutoGroupErr {
  ok: false;
  error: string;
}

export type KeywordAutoGroupResult = KeywordAutoGroupOk | KeywordAutoGroupErr;

const MIN_GROUPS = 2;
const MAX_GROUPS = 8;

export function buildKeywordAutoGroupPrompt(
  keywords: string[],
  existingLabels: string[] = [],
): string {
  const cleanedKeywords = keywords
    .map(k => k.trim())
    .filter(k => k.length > 0);

  const existingBlock = existingLabels.length > 0
    ? `EXISTING TOPIC GROUPS (the user already curated these. Prefer matching a keyword here when it fits, instead of inventing a new label.)
${existingLabels.map(l => `- ${l}`).join('\n')}

`
    : '';

  return `You are helping a user organize their social media keyword blocklist into clean topic groups. The user has a flat list of keywords with no grouping; cluster them by topic so they can mute one whole topic at a time.

KEYWORDS (one per line, preserve casing and Vietnamese diacritics)
${cleanedKeywords.join('\n')}

${existingBlock}TASK
Cluster the keywords into ${MIN_GROUPS} to ${MAX_GROUPS} topic groups.

Rules:
- Every input keyword MUST appear in exactly one output group (no duplicates across groups, no skipped keywords).
- Use the input keywords verbatim. Do NOT invent new keywords, do NOT translate, do NOT change casing or diacritics.
- Group labels: short and human-readable (1 to 4 words, Title Case, English). Examples: "Crypto", "Politics", "K-Pop", "Vietnamese Celebrities", "Sports Scores".
- Prefer an existing user label when a keyword fits one of them.
- Avoid filler labels like "Other", "Misc", or "Various". If a keyword truly fits nowhere, put it in a group named exactly "Uncategorized".
- No emoji. No quotes around labels.

OUTPUT
Return ONLY a JSON object of the following shape. No prose, no code fences, no commentary.

{
  "groups": [
    { "label": "Crypto", "keywords": ["bitcoin", "ethereum", "altcoin"] },
    { "label": "Politics", "keywords": ["election", "senate"] }
  ]
}

Now generate the JSON object for the keywords above.`;
}

// Pulls the outermost {...} JSON block out of a model response, balancing
// braces while ignoring those inside string literals.
export function extractJsonObjectBlock(raw: string): string | null {
  if (!raw) return null;
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Parse the auto-group reply. Filters keywords back to the original input set
// (case-insensitive) so the model cannot invent or translate keywords on us.
// Each keyword lands in at most one group (first occurrence wins). Groups with
// no surviving keywords are dropped.
export function parseKeywordAutoGroupJson(
  raw: string,
  inputKeywords: string[],
): KeywordAutoGroupResult {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty response from the model.' };
  }
  const block = extractJsonObjectBlock(raw);
  if (!block) {
    return { ok: false, error: 'No JSON object found in the response.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Response was not a JSON object.' };
  }
  const obj = parsed as Record<string, unknown>;
  const groupsRaw = obj.groups;
  if (!Array.isArray(groupsRaw)) {
    return { ok: false, error: 'Response was missing a "groups" array.' };
  }

  // Build a case-insensitive lookup from lowercased input -> original casing
  // so we can both recognize and preserve the user's keyword spelling.
  const allowed = new Map<string, string>();
  for (const kw of inputKeywords) {
    const cleaned = kw.trim();
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (!allowed.has(lower)) allowed.set(lower, cleaned);
  }

  const placed = new Set<string>();
  const groups: { label: string; keywords: string[] }[] = [];
  for (const g of groupsRaw) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) continue;
    const gObj = g as Record<string, unknown>;
    const labelRaw = gObj.label;
    const kwRaw = gObj.keywords;
    if (typeof labelRaw !== 'string') continue;
    if (!Array.isArray(kwRaw)) continue;
    const label = labelRaw.trim().replace(/^["']+|["']+$/g, '').trim();
    if (!label) continue;

    const accepted: string[] = [];
    for (const item of kwRaw) {
      if (typeof item !== 'string') continue;
      const lower = item.trim().toLowerCase();
      if (!lower) continue;
      if (placed.has(lower)) continue;
      const original = allowed.get(lower);
      if (!original) continue;
      placed.add(lower);
      accepted.push(original);
    }
    if (accepted.length === 0) continue;
    groups.push({ label, keywords: accepted });
  }

  if (groups.length === 0) {
    return { ok: false, error: 'Response produced no usable groups.' };
  }
  return { ok: true, groups };
}
