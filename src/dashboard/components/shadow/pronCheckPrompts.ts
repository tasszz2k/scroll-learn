// Prompt builder + JSON parser for the AI pronunciation-check feature.
// The prompt embeds the script with line indices and asks Gemini to grade an
// attached audio recording on three axes (pronunciation/naturalness/fluency)
// plus per-line problem words tagged with IPA phoneme symbols.

import type {
  PronCheckLineNote,
  PronCheckProblemWord,
  PronCheckReport,
  ShadowScript,
} from '../../../common/types';
import { extractJsonBlock, sanitizeJsonEscapes } from './prompts';

export interface PronCheckPromptParams {
  script: ShadowScript;
  // Wall-clock recording length in seconds. Used as a fluency signal so the
  // model can compare actual pace to the script's target pace.
  durationSec: number;
  // Authoritative ground-truth transcript captured by the browser's local
  // SpeechRecognition during the recording. The chat UI's audio analysis is
  // unreliable -- it tends to confabulate "Heard:" content from the script
  // text in the prompt rather than from the audio. Including this transcript
  // and forcing per-line `said` to be drawn from it stops that hallucination.
  localTranscript: string;
}

export function buildPronCheckPrompt(params: PronCheckPromptParams): string {
  const { script, durationSec, localTranscript } = params;
  const numbered = script.lines
    .map((line, idx) => `${idx + 1}. ${line.speaker}: ${line.text}`)
    .join('\n');
  const totalWords = script.lines.reduce((sum, l) => sum + l.text.split(/\s+/).filter(Boolean).length, 0);
  const targetSeconds = script.durationSec;
  const transcript = (localTranscript ?? '').trim();
  const transcriptBlock = transcript || '(empty -- the local recognizer caught no audible speech)';

  return `You are an English pronunciation coach. The learner read a shadowing-practice script aloud and you are grading their delivery.

YOU HAVE TWO INPUTS:
1. The original SCRIPT below (what they were supposed to read).
2. A LOCAL TRANSCRIPT below, captured live by the browser's speech recognizer during the recording. This is the AUTHORITATIVE GROUND TRUTH for what words were actually spoken. The audio file attached to this message is for phoneme/prosody quality only -- DO NOT invent words that aren't in the local transcript.

LEARNER CONTEXT
- The learner is reading a shadowing-practice script aloud, ALL speaker turns delivered by ONE voice (their own). Do NOT grade character-voice consistency, accent matching, or impersonation.
- CEFR level: ${script.level}. Hold them to a level-appropriate standard, not native-fluent unless they're C2.
- Be encouraging but specific; lead with what to fix next session.

SCRIPT (line index. SPEAKER: text)
"""
${numbered}
"""

LOCAL TRANSCRIPT (ground truth -- what was actually said)
"""
${transcriptBlock}
"""

RECORDING METADATA
- Wall-clock recording length: ${durationSec} seconds.
- Script's target duration at natural pace: ${targetSeconds} seconds (~${totalWords} words total).
- A recording much longer than target suggests stalls, restarts, or word-by-word reading; much shorter suggests rushing or skipping lines.

ANTI-HALLUCINATION RULES (READ THESE FIRST)
- The per-line "said" field MUST be a substring of the LOCAL TRANSCRIPT. If a script line has NO matching fragment in the local transcript, "said" MUST be the empty string "" and the learner gets no credit for that line.
- DO NOT copy script text into "said". DO NOT paraphrase the script. If the learner skipped a line, leave "said" empty.
- If the local transcript is empty or only a couple of words while the script has many lines, the learner skipped most of the script. Set "pronunciation" near 0 and explain in "summary".
- "problemWords" only flags words that ARE in the transcript but came out wrong (substituted, slurred). If the word is missing from the transcript entirely, do NOT list it as a problemWord -- the line just gets empty "said" and a tip telling them to actually read it.

GRADING AXES (each 0-100)
- "pronunciation" — segmental accuracy of words that DID make it to the transcript. Use the audio for phoneme judgement (consonant pairs /θ vs s/, /v vs w/, voiced vs unvoiced th, /r vs l/, vowel length ship vs sheep, final-consonant voicing). Heavily penalise SCRIPT COVERAGE: if only 1 of 50 script words made it to the transcript, pronunciation cannot exceed ~10.
- "naturalness" — prosody on the words that were read. Stress placement, intonation contour, sentence-level rhythm. Lower when every syllable carries equal weight, when stress lands on the wrong word, or when intonation is flat. Also lower when most lines were skipped (you can't sound natural reading nothing).
- "fluency" — flow. Pace, hesitation, restarts, audible reading-aloud tone. Use the duration ratio (recording vs target) and the number of script lines actually attempted. Skipping lines is the worst kind of disfluency -- score near 0 if most lines are missing.

PER-LINE NOTES
Emit one entry in "lines" for every line in the script:
- "idx": the 1-based line number from the script above.
- "said": substring of the LOCAL TRANSCRIPT corresponding to this line, or "" if not attempted. NEVER copied from the script.
- "tip": one specific actionable tip for that line. If the line was skipped, the tip is something like "Read this line next time; it was skipped entirely." Lead with the fix, no praise.
- "problemWords": objects for words actually in the transcript that came out wrong. Empty array [] if the line was skipped or clean. EACH ENTRY MUST HAVE:
    - "word": the misread word (lowercase, plain orthography).
    - "phonemes": IPA phoneme SYMBOLS (without slashes) from the standard 44-phoneme English set, naming the specific sounds missed. e.g. ["θ"] for "thought", ["ð"] for "this". Empty array if you can't pin a specific phoneme.
    - "reason": optional one-liner ("voiced th instead of voiceless", "primary stress on second syllable", "dropped the final /t/").

OUTPUT
Emit ONE JSON object exactly matching this schema and NOTHING ELSE -- no prose, no markdown fences, no commentary:

{
  "scores": {
    "pronunciation": 0-100,
    "naturalness": 0-100,
    "fluency": 0-100
  },
  "summary": "2-4 sentence coaching summary. Lead with the single biggest thing to work on next session. Plain text or simple markdown (paragraphs, **bold**). No code fences, no headings.",
  "lines": [
    {
      "idx": 1,
      "said": "(substring of local transcript, or empty)",
      "tip": "...",
      "problemWords": [
        { "word": "thought", "phonemes": ["θ"], "reason": "voiced th instead of voiceless" }
      ]
    }
  ]
}

CRITICAL CONSTRAINTS
- Output the JSON object as the entire response. Do NOT wrap it in code fences.
- Phoneme symbols MUST be IPA without slashes (e.g. "θ" not "/θ/").
- "said" comes from the LOCAL TRANSCRIPT, never from the script. Empty when no match.
- If the local transcript is empty, set every score to 0 and say so in "summary".
- Be honest. A short, incomplete read should score low; a clean, complete read should score high.

Now grade and emit the JSON.`;
}

export type PronCheckParseResult =
  | { ok: true; report: PronCheckReport }
  | { ok: false; error: string };

function asInt(v: unknown): number {
  if (typeof v !== 'number' || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function coerceProblemWord(raw: unknown): PronCheckProblemWord | null {
  // Tolerant: accept either a full object or a plain string (legacy/short
  // model output). Drop slashes from any phoneme symbols just in case.
  if (typeof raw === 'string') {
    const word = raw.trim();
    if (!word) return null;
    return { word, phonemes: [] };
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const word = asString(o.word).trim();
  if (!word) return null;
  const phsIn = Array.isArray(o.phonemes) ? o.phonemes : [];
  const phonemes = phsIn
    .filter((p): p is string => typeof p === 'string')
    .map(p => p.replace(/^\/|\/$/g, '').trim())
    .filter(Boolean);
  const reason = typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim() : undefined;
  const out: PronCheckProblemWord = { word: word.toLowerCase(), phonemes };
  if (reason) out.reason = reason;
  return out;
}

function coerceLine(raw: unknown): PronCheckLineNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const idxRaw = o.idx;
  const idx = typeof idxRaw === 'number' && isFinite(idxRaw) ? Math.round(idxRaw) : NaN;
  if (!Number.isFinite(idx) || idx < 0) return null;
  const said = asString(o.said);
  const tip = asString(o.tip);
  const pwRaw = Array.isArray(o.problemWords) ? o.problemWords : [];
  const problemWords = pwRaw
    .map(coerceProblemWord)
    .filter((p): p is PronCheckProblemWord => p !== null);
  return { idx, said, tip, problemWords };
}

export function parsePronCheckJSON(raw: string): PronCheckParseResult {
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
      return {
        ok: false,
        error: `JSON parse failed: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}`,
      };
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Response was not an object.' };
  }
  const obj = parsed as Record<string, unknown>;
  const scoresRaw = obj.scores;
  if (!scoresRaw || typeof scoresRaw !== 'object') {
    return { ok: false, error: 'Response is missing "scores".' };
  }
  const sObj = scoresRaw as Record<string, unknown>;
  const scores = {
    pronunciation: asInt(sObj.pronunciation),
    naturalness: asInt(sObj.naturalness),
    fluency: asInt(sObj.fluency),
  };
  const summary = asString(obj.summary).trim();
  const linesRaw = Array.isArray(obj.lines) ? obj.lines : [];
  const lines = linesRaw
    .map(coerceLine)
    .filter((l): l is PronCheckLineNote => l !== null);

  return {
    ok: true,
    report: {
      scores,
      summary: summary || 'No summary provided.',
      lines,
    },
  };
}
