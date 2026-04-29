import type { ShadowLevel, ShadowLine } from '../../../common/types';

export interface ShadowPromptParams {
  targetWords: string[];
  context: string;
  level: ShadowLevel;
  speakerCount: number;        // 1-4
  durationSec: number;         // approximate; ~4s/line at natural pace
  // Phoneme symbols (without slashes) the learner is currently weakest on. Up
  // to ~5; the model is asked to flag which ones appear in each line.
  weakPhonemes: string[];
  // Register hint -- 'casual' | 'neutral' | 'formal' | 'academic' free-text.
  register?: string;
}

const LEVEL_DESCRIPTIONS: Record<ShadowLevel, string> = {
  A1: 'A1 (Beginner): very simple words, present tense, short sentences (5-8 words).',
  A2: 'A2 (Elementary): everyday vocabulary, basic past/future, sentences up to 10 words.',
  B1: 'B1 (Intermediate): common idioms, compound sentences, broader topical vocabulary.',
  B2: 'B2 (Upper-Intermediate): nuanced vocabulary, abstract topics, varied connectors.',
  C1: 'C1 (Advanced): academic and idiomatic language, complex sentence structures.',
  C2: 'C2 (Proficient): native-like vocabulary, subtle connotations, technical and literary language.',
};

export function buildShadowPrompt(params: ShadowPromptParams): string {
  const {
    targetWords,
    context,
    level,
    speakerCount,
    durationSec,
    weakPhonemes,
    register = 'neutral conversational',
  } = params;

  // Aim for ~4s per line at natural pace, capped to a reasonable range.
  const estLines = Math.max(4, Math.min(40, Math.round(durationSec / 4)));
  const speakerIds = Array.from({ length: Math.max(1, Math.min(4, speakerCount)) }, (_, i) =>
    String.fromCharCode(65 + i),
  );

  const wordsList = targetWords.length > 0
    ? targetWords.map(w => `- ${w}`).join('\n')
    : '- (none specified, the script is freely composed around the context)';

  const phonemeBlock = weakPhonemes.length > 0
    ? `WEAK-PHONEME FOCUS (the learner is currently struggling with these IPA sounds):
${weakPhonemes.map(p => `- /${p}/`).join('\n')}

For each line, naturally include 1-3 words that feature one or more of these phonemes (don't force every line, but aim for at least half of the lines to expose at least one weak phoneme). On each line you emit, fill the "ipaFocus" array with the symbols (without slashes) from the weak list that ACTUALLY occur in that line's words. Empty array if none.`
    : `No weak-phoneme focus set yet. Set "ipaFocus" to [] on every line.`;

  // Map the free-text register hint to a coarse intensity for fillers and
  // contractions. Anything that does not match a known keyword falls through to
  // moderate, matching the default 'neutral conversational' value above.
  const reg = register.toLowerCase();
  let fillerIntensity: 'heavy' | 'moderate' | 'minimal' | 'none';
  if (reg.includes('academic')) fillerIntensity = 'none';
  else if (reg.includes('formal')) fillerIntensity = 'minimal';
  else if (reg.includes('casual')) fillerIntensity = 'heavy';
  else fillerIntensity = 'moderate';

  const contractionsLine = fillerIntensity === 'none'
    ? `- Contractions: avoid contractions; the academic register prefers full forms ("it is", "we will", "do not").`
    : `- Contractions are preferred ("it's", "we'll", "don't"); they make the line sound spoken rather than written.`;

  const speakerPersonalityLine = speakerIds.length >= 2
    ? `- Per-speaker personality: give each of ${speakerIds.join(', ')} a slight, consistent voice (for example one is more probing and the other more measured) so the dialogue does not feel like a single voice in two roles. No caricature, no accents, no stage directions, and never put parentheticals like "(laughs)" inside "text".`
    : `- Single speaker: keep one consistent voice across the monologue, but vary phrasing and rhythm so it does not sound recited.`;

  const naturalDeliveryBlock = `NATURAL DELIVERY (write each "text" as it would actually be SPOKEN, not as clean prose)
- Filler intensity for this register (${register}): ${fillerIntensity}.image.png
- Verbal fillers and discourse markers to draw from when appropriate: "Hmm,", "Well,", "Yeah,", "Right,", "You know,", "I mean,", "Look,", "Honestly,", "Oh,", "Actually,". Roughly 30-40 percent of lines should open with or contain one of these, then SCALED by the intensity above:
  - heavy: most casual lines carry a filler or discourse marker; aim near the top of the 30-40 percent band and let some lines stack two ("Well, I mean,").
  - moderate: about a third of lines carry one filler; keep them light and varied.
  - minimal: only the most natural-sounding lines get a single soft marker ("Well," or "Right,"); most lines are clean.
  - none: do NOT use fillers; the academic register reads as written prose with no "Hmm,"/"Yeah,"/"You know,".
- Pacing punctuation inside "text": use "..." for hesitation or trailing-off, "--" for a self-interrupt or sudden pivot, comma-broken breath groups for long clauses, and "!" or "?!" where the emotion warrants. Lines must NOT all end on flat periods; mix in "?", "!", "...", and the occasional "?!".
${contractionsLine}
${speakerPersonalityLine}
- The "glossVi" field translates the FULL natural line including any fillers, hesitation, or self-interrupts. Render it the way a fluent native Vietnamese speaker would actually say the same thought in conversation -- not a literal mapping of "Hmm," to a Vietnamese token. Keep diacritics correct.`;

  return `You are generating an English shadowing-practice script.

A "shadowing" script is a short, NATURAL-sounding spoken dialogue (or monologue) the learner will play back and imitate in real time. It must be:
- comfortable to read aloud at native pace
- rhythmically varied (not a monotone list of equal-length sentences)
- contextually coherent: every line follows from the previous one

LEARNER CONTEXT
- CEFR level: ${LEVEL_DESCRIPTIONS[level]}
- Number of speakers: ${speakerIds.length} (${speakerIds.join(', ')}). ${speakerIds.length === 1 ? 'A monologue from speaker A.' : 'Balance turns roughly evenly across speakers.'}
- Approximate duration: ${durationSec} seconds at natural pace (~${estLines} lines).
- Register: ${register}.
- Target words/phrases the learner wants to practice (each must appear at least once in the script):
${wordsList}
- Topical context (use it to set scene, plot, or framing):
"""
${context.trim() || '(none provided -- pick a natural everyday situation)'}
"""

${phonemeBlock}

${naturalDeliveryBlock}

GLOSS
- Every line MUST include "glossVi": a concise, idiomatic Vietnamese translation of that line. Use proper diacritics (tiếng Việt có dấu).
- The dashboard renders Vietnamese directly under English in a karaoke layout for all levels, so glossVi is required at A1 through C2.
- For higher levels (B2, C1, C2) the gloss is the natural way a fluent Vietnamese speaker would say the same thing, NOT a word-for-word literal translation.

OUTPUT
Emit ONE JSON object exactly matching this schema and NOTHING ELSE -- no prose, no markdown fences, no commentary:

{
  "title": "Short descriptive title (3-7 words)",
  "lines": [
    { "speaker": "A", "text": "...", "glossVi": "...", "ipaFocus": ["ʃ", "θ"] },
    { "speaker": "B", "text": "...", "glossVi": "...", "ipaFocus": [] }
    // ... ${estLines} lines total, alternating or interleaving across speakers
  ]
}

CRITICAL CONSTRAINTS
- Output the JSON object as the entire response. Do NOT wrap it in markdown code fences. Do NOT prepend or append any explanation.
- "speaker" must be one of: ${speakerIds.map(s => '"' + s + '"').join(', ')}.
- "text" is the line of speech ONLY -- no stage directions, no "(A says)", no quotes around the line.
- Each "ipaFocus" entry must be a phoneme symbol without slashes, e.g. "ʃ" not "/ʃ/".
- Every target word must appear at least once. Aim for natural usage; don't cram them.
- Lines should average 6-14 words depending on level. Vary length so the rhythm feels natural.

Now emit the JSON.`;
}

export interface ParsedShadowScript {
  title: string;
  lines: ShadowLine[];
}

export type ParseShadowResult =
  | { ok: true; script: ParsedShadowScript }
  | { ok: false; error: string };

/**
 * Strip ```...``` fences and surrounding chatter, then JSON.parse the largest
 * top-level object. Tolerant of leading "Here's the script:" etc.
 */
export function extractJsonBlock(raw: string): string | null {
  if (!raw) return null;
  let text = raw.trim();

  // Strip code fences. Accept ```json ... ``` or just ``` ... ```.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Find the outermost {...} block. We balance braces while ignoring those
  // inside string literals (with backslash-escape awareness).
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
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

// Forgive common LLM slip-ups inside string literals: stray backslashes that
// are not part of a valid JSON escape (e.g. "axon-devices\InterviewRoom" or
// "C:\Users\me") would otherwise break JSON.parse with "Bad escaped
// character". We double those backslashes so the literal character survives.
export function sanitizeJsonEscapes(json: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (ch === '\\') {
      const next = json[i + 1];
      const isValidEscape =
        next === '"' || next === '\\' || next === '/' ||
        next === 'b' || next === 'f' || next === 'n' ||
        next === 'r' || next === 't' || next === 'u';
      if (isValidEscape) {
        out += ch + next;
        i++;
      } else {
        out += '\\\\';
      }
      continue;
    }
    if (ch === '"') {
      inString = false;
    }
    out += ch;
  }
  return out;
}

export function parseShadowJSON(raw: string): ParseShadowResult {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, error: 'Empty response from the model.' };
  }
  const block = extractJsonBlock(raw);
  if (!block) {
    return { ok: false, error: 'No JSON object found in the response.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (firstErr) {
    try {
      parsed = JSON.parse(sanitizeJsonEscapes(block));
    } catch {
      return { ok: false, error: `JSON parse failed: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}` };
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Response was not an object.' };
  }
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const linesRaw = obj.lines;
  if (!Array.isArray(linesRaw) || linesRaw.length === 0) {
    return { ok: false, error: 'Response has no "lines" array, or it is empty.' };
  }

  const lines: ShadowLine[] = [];
  for (let i = 0; i < linesRaw.length; i++) {
    const item = linesRaw[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `Line ${i + 1} is not an object.` };
    }
    const li = item as Record<string, unknown>;
    const speaker = typeof li.speaker === 'string' ? li.speaker.trim() : '';
    const text = typeof li.text === 'string' ? li.text.trim() : '';
    if (!speaker) {
      return { ok: false, error: `Line ${i + 1} is missing "speaker".` };
    }
    if (!text) {
      return { ok: false, error: `Line ${i + 1} is missing "text".` };
    }
    const glossVi = typeof li.glossVi === 'string' && li.glossVi.trim()
      ? li.glossVi.trim()
      : undefined;
    const ipaFocus = isStringArray(li.ipaFocus)
      ? li.ipaFocus.map(s => s.replace(/^\/|\/$/g, '').trim()).filter(Boolean)
      : undefined;
    const line: ShadowLine = { speaker, text };
    if (glossVi) line.glossVi = glossVi;
    if (ipaFocus && ipaFocus.length > 0) line.ipaFocus = ipaFocus;
    lines.push(line);
  }

  return {
    ok: true,
    script: {
      title: title || 'Shadowing script',
      lines,
    },
  };
}
