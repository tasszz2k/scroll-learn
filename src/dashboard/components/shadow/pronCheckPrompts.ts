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
  // The browser's webkitSpeechRecognition transcript. Sent to Gemini as a
  // SECOND-OPINION cross-check, not as ground truth: Gemini's audio analysis
  // alone tends to confabulate "Heard:" content from the script in the
  // prompt, so a competing hypothesis (the recognizer's reading) is needed
  // to force honest transcription. The recognizer is independently unreliable
  // on uncommon/technical vocabulary, so the prompt rules tell Gemini to
  // resolve transcript-vs-audio disagreements with the audio for grading,
  // while still anchoring "said" to what was actually heard (transcript or
  // audio) and never inventing it from the script.
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

YOUR INPUTS
1. The original SCRIPT below (what they were supposed to read).
2. The AUDIO FILE attached to this message. This is the primary signal for HOW each word sounded -- phoneme accuracy, stress, prosody, slurring, silence.
3. A LOCAL TRANSCRIPT below, captured by the browser's webkitSpeechRecognition during the recording. This is a noisy second opinion on WHAT was said -- treat it as a competing hypothesis from a phoneme-level matcher, NOT as ground truth. The recognizer mis-hears uncommon and technical English words (e.g. it tends to hear "helm" as "hand", "Iris" as "arrest", "larges" as "latches", "DevX" as "devastated") so it under-credits clean reads of technical vocabulary. But it is also incapable of inventing words wholesale from the script, which means it usefully bounds your own transcription: if the recognizer heard "ham chance" where the script says "helm chart's", at least one of you is right and neither of you is the script.

LEARNER CONTEXT
- The learner is reading a shadowing-practice script aloud, ALL speaker turns delivered by ONE voice (their own). Do NOT grade character-voice consistency, accent matching, or impersonation.
- CEFR level: ${script.level}. Hold them to a level-appropriate standard, not native-fluent unless they're C2.
- Be encouraging but specific; lead with what to fix next session.

SCRIPT (line index. SPEAKER: text)
"""
${numbered}
"""

LOCAL TRANSCRIPT (browser recognizer -- noisy second opinion)
"""
${transcriptBlock}
"""

RECORDING METADATA
- Wall-clock recording length: ${durationSec} seconds.
- Script's target duration at natural pace: ${targetSeconds} seconds (~${totalWords} words total).
- A recording much shorter than target suggests skipped lines.

ANTI-HALLUCINATION RULES (READ THESE FIRST)
- "said" MUST come from EITHER the local transcript span for that line OR words you can clearly verify in the audio. NEVER from the script. If you find yourself emitting a "said" that's word-for-word identical to the script line, you are confabulating -- listen again and write what was actually heard. The script is what they were SUPPOSED to read; "said" is what they ACTUALLY produced. These should differ whenever the transcript shows substitutions, even if the audio sounds reasonable to you on first pass.
- If the local transcript shows no fragment for a line and the audio at that timestamp is silent/skipped, "said" is "" and the line gets a "skipped" tip. Do NOT recover script text into "said" out of charity.
- If the local transcript is empty or only a couple of words while the script has many lines, the learner skipped most of the script. Set "pronunciation" near 0 and explain in "summary".

CROSS-CHECK RULES (transcript vs audio)
- When transcript and audio AGREE that a word matches the script: clean read, no flag.
- When transcript and audio AGREE that a word was substituted/wrong: clear miss, flag it.
- When transcript shows a substitution but the audio sounds correct to you: this is the recognizer's typical failure on uncommon/technical vocabulary. Listen ONE MORE TIME with skepticism -- if the audio is unambiguously the script word with clean phonemes, give credit (no flag). If the audio is at all unclear, flag it; the recognizer's mishearing is evidence the word was below the intelligibility bar.
- When transcript shows the script word but the audio sounds wrong: trust the audio, flag it. (Rare; recognizers usually don't auto-correct toward the script.)
- When transcript shows a word that the audio also sounds like: this is the OPPOSITE of confabulation -- two independent sources agree the learner said something other than the script word. ALWAYS flag this.

PROBLEM WORDS (walk every line)
- "problemWords" flags words that came out wrong, decided by the cross-check rules above. Empty array [] only when the line was skipped or read cleanly.
- DISTINGUISH SUBSTITUTED FROM SKIPPED. SUBSTITUTED: audio shows the learner attempted that slot with a different/wrong word, or both transcript and audio attest to a substitution. SKIPPED: the audio is silent at that slot AND the transcript shows nothing in that span. Skipped words get NO entry in problemWords -- the line just gets a tip telling the learner to read it next time.
- BE THOROUGH. Walk every script line word by word; for each script word, run the cross-check. Flag every SUBSTITUTED case. If five words in a line are substituted, the problemWords array has five entries. Do not stop after one or two examples.

GRADING AXES (each 0-100)
- "pronunciation" — segmental accuracy of what you hear in the audio. Use phoneme cues (consonant pairs /θ vs s/, /v vs w/, voiced vs unvoiced th, /r vs l/, vowel length ship vs sheep, final-consonant voicing). The dominant penalty is SKIP COVERAGE: lines or word-spans that are silent or unattempted in the audio drag the score down proportionally to how much was skipped. The secondary penalty is mispronunciation per the cross-check rules. Do NOT score high just because the script is in the prompt -- score what the audio actually sounds like.
- "naturalness" — prosody on the words that were read. Stress placement, intonation contour, sentence-level rhythm. Lower when every syllable carries equal weight, when stress lands on the wrong word, or when intonation is flat. Also lower when most lines were skipped (you can't sound natural reading nothing).
- "fluency" — flow. Pace, hesitation, restarts, audible reading-aloud tone. Use the duration ratio (recording vs target) and the number of script lines actually attempted. Skipping lines is the worst kind of disfluency -- score near 0 if most lines are missing.

PER-LINE NOTES
Emit one entry in "lines" for every line in the script:
- "idx": the 1-based line number from the script above.
- "said": what was actually heard for this line -- drawn from the local transcript span and/or the audio, NEVER copied from the script. Use "" if not attempted. If your "said" is letter-for-letter identical to the script line, double-check; that is almost always a hallucination.
- "tip": one specific actionable tip for that line. If the line was skipped, the tip is something like "Read this line next time; it was skipped in the recording." Lead with the fix, no praise.
- "problemWords": one entry for EVERY script word on this line that came out wrong per the cross-check rules. Walk word by word, do not stop after one example. EACH ENTRY MUST HAVE:
    - "word": the script word that was misread (lowercase, plain orthography). Use the SCRIPT spelling, not what the recognizer or audio produced.
    - "phonemes": one to three IPA phoneme SYMBOLS (without slashes) naming ONLY the specific sound(s) that diverged. Pick the minimum set that explains the miss. NEVER emit the full IPA transcription of the word -- e.g. for a mispronounced "understand" pinpoint the bad sound (["d"] if the final /d/ dropped, ["æ"] if the stressed vowel was wrong); do NOT emit ["ʌ","n","d","ə","s","t","æ","n","d"]. For "viable" produced as "available" the phonemes are ["v"] (the /v/ at the start was lost), not the whole IPA of "viable". Empty array [] if you genuinely cannot pin a specific phoneme.
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
      "said": "(what was actually heard, drawn from transcript and/or audio; not the script)",
      "tip": "...",
      "problemWords": [
        { "word": "modifying",  "phonemes": ["ŋ"], "reason": "dropped final -ing" },
        { "word": "helm",       "phonemes": ["h"], "reason": "transcript heard 'ham', audio confirms /h/ and /l/ collapsed" },
        { "word": "viable",     "phonemes": ["v"], "reason": "/v/ flattened to /b/" },
        { "word": "us",         "phonemes": ["s"], "reason": "final /s/ unclear" }
      ]
    }
  ]
}

CRITICAL CONSTRAINTS
- Output the JSON object as the entire response. Do NOT wrap it in code fences.
- Phoneme symbols MUST be IPA without slashes (e.g. "θ" not "/θ/").
- "said" is what was actually said (transcript and/or audio), NEVER copied from the script. A perfect-script "said" on every line means you confabulated -- redo.
- If the local transcript is empty AND the audio is silent, set every score to 0 and say so in "summary".
- Be honest. A short, incomplete, or mispronounced read should score low; a clean, complete read should score high.

Now listen to the audio, cross-check against the local transcript, and emit the JSON.`;
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
