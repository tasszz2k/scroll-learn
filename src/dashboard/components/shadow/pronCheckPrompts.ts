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
  // The browser's webkitSpeechRecognition transcript. NOT sent to Gemini --
  // the recognizer is unreliable on uncommon/technical vocabulary (e.g. it
  // hears "helm" as "hand", "larges" as "latches") so feeding it as input
  // poisons the per-word grade. Only its word count is forwarded as a
  // coverage hint. The full text stays in the UI for the user's reference.
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
  const transcriptWordCount = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  const coveragePct = totalWords > 0 ? Math.round((transcriptWordCount / totalWords) * 100) : 0;

  return `You are an English pronunciation coach. The learner read a shadowing-practice script aloud and you are grading their delivery.

YOUR INPUTS
1. The original SCRIPT below (what they were supposed to read).
2. The AUDIO FILE attached to this message. THIS IS THE GROUND TRUTH for what was said and how it was pronounced. Listen to it carefully end-to-end. Every grade and every per-word call you make MUST come from what you actually hear in the audio.

A noisy second-hand transcript from the browser's webkitSpeechRecognition is intentionally NOT included in this prompt. That recognizer mis-hears uncommon and technical English words (e.g. "helm" as "hand", "Iris" as "arrest", "larges" as "latches", "DevX" as "devastated") so feeding it to you would penalise the learner for the recognizer's errors instead of their actual pronunciation. The only thing forwarded from the recognizer is a coverage count below; treat it as a sanity check, not as content.

LEARNER CONTEXT
- The learner is reading a shadowing-practice script aloud, ALL speaker turns delivered by ONE voice (their own). Do NOT grade character-voice consistency, accent matching, or impersonation.
- CEFR level: ${script.level}. Hold them to a level-appropriate standard, not native-fluent unless they're C2.
- Be encouraging but specific; lead with what to fix next session.

SCRIPT (line index. SPEAKER: text)
"""
${numbered}
"""

RECORDING METADATA
- Wall-clock recording length: ${durationSec} seconds.
- Script's target duration at natural pace: ${targetSeconds} seconds (~${totalWords} words total).
- Browser-recognizer coverage hint: caught roughly ${transcriptWordCount} word${transcriptWordCount === 1 ? '' : 's'} (~${coveragePct}% of script). This is a NOISY hint -- a low number can mean the learner skipped lines OR that the recognizer just didn't catch them; resolve the ambiguity by listening to the audio. Recording length much shorter than target ALSO suggests skipped lines.

ANTI-HALLUCINATION RULES (READ THESE FIRST)
- "said" MUST come from what you HEAR in the audio for that line. Quote the script word(s) when the audio matches them; quote what the learner actually said when they substituted; leave "" when the line is silent or unattempted in the audio.
- If you do not hear a line attempted in the audio (silence, pause, or jump straight to a later line), "said" is "" and the line gets a "skipped" tip. Do NOT recover script text into "said" out of charity. Do NOT paraphrase the script.
- If the audio contains very little speech relative to the script length (use the duration ratio and the recognizer coverage hint as a cross-check), set "pronunciation" near 0 and explain in "summary".

PROBLEM WORDS (audio-driven, walk every line)
- "problemWords" flags words the AUDIO shows came out wrong: mispronounced phonemes, the wrong word entirely, slurred, or with dropped endings. Decide entirely from the audio. The browser recognizer's notion of what was said is not available to you and is not the basis for these flags.
- DISTINGUISH SUBSTITUTED FROM SKIPPED. A word is SUBSTITUTED when the audio shows the learner attempted that slot but produced a different/wrong word (or so distorted that you can't recognise it). A word is SKIPPED when the audio is silent at that slot, or jumps from an earlier word straight to a later one. Skipped words get NO entry in problemWords -- the line just gets a tip telling the learner to read it next time.
- BE THOROUGH. Walk every script line word by word; for each script word, listen to its slot in the audio and decide: correct / substituted / skipped. Flag every SUBSTITUTED case. If five words in a line are substituted, the problemWords array has five entries. Do not stop after one or two examples. Under-flagging deprives the learner of feedback on words they actually need to work on.

GRADING AXES (each 0-100)
- "pronunciation" — segmental accuracy of what you hear in the audio. Use phoneme cues (consonant pairs /θ vs s/, /v vs w/, voiced vs unvoiced th, /r vs l/, vowel length ship vs sheep, final-consonant voicing). Score should reflect what the audio sounds like, not the noisy recognizer. If the audio is clean and accurate, score high even if the recognizer would have mis-heard technical words. The dominant penalty is SKIP COVERAGE: lines/words that are silent or unattempted in the audio drag the score down proportionally. The secondary penalty is audio-confirmed mispronunciation.
- "naturalness" — prosody on the words that were read. Stress placement, intonation contour, sentence-level rhythm. Lower when every syllable carries equal weight, when stress lands on the wrong word, or when intonation is flat. Also lower when most lines were skipped (you can't sound natural reading nothing).
- "fluency" — flow. Pace, hesitation, restarts, audible reading-aloud tone. Use the duration ratio (recording vs target) and the number of script lines actually attempted. Skipping lines is the worst kind of disfluency -- score near 0 if most lines are missing.

PER-LINE NOTES
Emit one entry in "lines" for every line in the script:
- "idx": the 1-based line number from the script above.
- "said": what you HEAR the learner say for this line in the audio, or "" if not attempted. Quote the script wording when the audio matches; quote what was actually said when it was substituted. Never invented from the script.
- "tip": one specific actionable tip for that line. If the line was skipped, the tip is something like "Read this line next time; it was skipped in the recording." Lead with the fix, no praise.
- "problemWords": one entry for EVERY script word on this line that the AUDIO shows came out wrong -- substitutions, slurs, dropped endings, wrong vowels. Walk word by word, do not stop after one example. Empty array [] only when the line was skipped or read cleanly. EACH ENTRY MUST HAVE:
    - "word": the script word that was misread (lowercase, plain orthography). Use the SCRIPT spelling.
    - "phonemes": one to three IPA phoneme SYMBOLS (without slashes) naming ONLY the specific sound(s) that diverged on this word in the audio. Pick the minimum set that explains the miss. NEVER emit the full IPA transcription of the word -- e.g. for a mispronounced "understand" pinpoint the bad sound (["d"] if the final /d/ dropped, ["æ"] if the stressed vowel was wrong); do NOT emit ["ʌ","n","d","ə","s","t","æ","n","d"]. For "viable" produced as "available" the phonemes are ["v"] (the /v/ at the start was lost), not the whole IPA of "viable". Empty array [] if you genuinely cannot pin a specific phoneme; do NOT use that as a fallback for "I would have written all of them".
    - "reason": optional one-liner ("voiced th instead of voiceless", "primary stress on second syllable", "dropped the final /t/", "/v/ flattened to /b/, sounded like 'available'").

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
      "said": "(what you heard the learner say, or empty)",
      "tip": "...",
      "problemWords": [
        { "word": "modifying",  "phonemes": ["ŋ"], "reason": "dropped final -ing" },
        { "word": "helm",       "phonemes": ["h"], "reason": "/h/ and /l/ collapsed, came out closer to 'them'" },
        { "word": "viable",     "phonemes": ["v"], "reason": "/v/ flattened to /b/" },
        { "word": "us",         "phonemes": ["s"], "reason": "final /s/ unclear" }
      ]
    }
  ]
}

CRITICAL CONSTRAINTS
- Output the JSON object as the entire response. Do NOT wrap it in code fences.
- Phoneme symbols MUST be IPA without slashes (e.g. "θ" not "/θ/").
- Decide everything from the audio. The recognizer coverage count is a hint, not a content source.
- If the audio is silent or contains no recognisable speech, set every score to 0 and say so in "summary".
- Be honest. A short, incomplete, or mispronounced read should score low; a clean, complete read should score high even if the recognizer would have mis-heard technical words.

Now listen to the audio and emit the JSON.`;
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
