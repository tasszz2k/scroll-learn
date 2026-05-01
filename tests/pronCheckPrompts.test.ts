import { describe, it, expect } from 'vitest';
import {
  buildPronCheckPrompt,
  parsePronCheckJSON,
} from '../src/dashboard/components/shadow/pronCheckPrompts';
import type { ShadowScript } from '../src/common/types';

const SAMPLE_SCRIPT: ShadowScript = {
  id: 'sc1',
  title: 'Coffee shop',
  level: 'B1',
  speakerCount: 2,
  durationSec: 40,
  rate: 1.0,
  targetWords: ['thought', 'this'],
  context: 'two friends at a cafe',
  lines: [
    { speaker: 'A', text: 'I thought you said this was open today.' },
    { speaker: 'B', text: 'Right, but they close on Tuesdays.' },
  ],
  createdAt: 0,
};

describe('buildPronCheckPrompt', () => {
  const baseParams = {
    script: SAMPLE_SCRIPT,
    durationSec: 12,
    localTranscript: 'i thought you said this was open today right but they close on tuesdays',
  };

  it('embeds the script lines with 1-based indices', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('1. A: I thought you said this was open today.');
    expect(prompt).toContain('2. B: Right, but they close on Tuesdays.');
  });

  it('includes the CEFR level', () => {
    expect(buildPronCheckPrompt(baseParams)).toContain('CEFR level: B1');
  });

  it('asks for IPA phoneme symbols without slashes', () => {
    expect(buildPronCheckPrompt(baseParams)).toContain('without slashes');
  });

  it('embeds the local transcript verbatim as a noisy second opinion', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('i thought you said this was open today right but they close on tuesdays');
  });

  it('marks the transcript block as empty when the recognizer caught nothing', () => {
    const prompt = buildPronCheckPrompt({ ...baseParams, localTranscript: '' });
    expect(prompt).toContain('the local recognizer caught no audible speech');
  });

  it('frames the transcript as a competing hypothesis, not ground truth', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('noisy second opinion');
    expect(prompt).toContain('competing hypothesis');
    expect(prompt).toContain('NOT as ground truth');
    expect(prompt).toContain('webkitSpeechRecognition');
  });

  it('reports recording duration and target duration', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('Wall-clock recording length: 12 seconds');
    expect(prompt).toContain("Script's target duration at natural pace: 40 seconds");
  });

  it('forbids hallucinating "said" content from the script', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('"said" MUST come from EITHER the local transcript span');
    expect(prompt).toContain('NEVER from the script');
    expect(prompt).toContain('that is almost always a hallucination');
  });

  it('declares cross-check rules for resolving transcript-vs-audio disagreements', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('CROSS-CHECK RULES');
    expect(prompt).toContain('When transcript and audio AGREE');
    expect(prompt).toContain('typical failure on uncommon/technical vocabulary');
  });

  it('demands thorough problem-word flagging with a multi-substitution example', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('BE THOROUGH');
    expect(prompt).toContain('"viable"');
    expect(prompt).toContain('"helm"');
    expect(prompt).toContain('"modifying"');
  });

  it('forbids emitting the full IPA transcription of a word in phonemes', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('NEVER emit the full IPA transcription');
    expect(prompt).toContain('one to three IPA phoneme SYMBOLS');
  });

  it('distinguishes substituted words (flag) from skipped words (do not flag)', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('DISTINGUISH SUBSTITUTED FROM SKIPPED');
    expect(prompt).toContain('Skipped words get NO entry in problemWords');
  });

  it('warns that a perfect-script "said" indicates confabulation', () => {
    const prompt = buildPronCheckPrompt(baseParams);
    expect(prompt).toContain('A perfect-script "said" on every line means you confabulated');
  });
});

describe('parsePronCheckJSON', () => {
  it('parses a happy-path JSON response', () => {
    const raw = JSON.stringify({
      scores: { pronunciation: 82, naturalness: 70, fluency: 65 },
      summary: 'Solid first take.',
      lines: [
        {
          idx: 1,
          said: 'I thought you said this was open today',
          tip: 'Tighten the /θ/ in "thought".',
          problemWords: [
            { word: 'thought', phonemes: ['θ'], reason: 'voiced th' },
          ],
        },
      ],
    });
    const r = parsePronCheckJSON(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.scores).toEqual({ pronunciation: 82, naturalness: 70, fluency: 65 });
    expect(r.report.lines).toHaveLength(1);
    expect(r.report.lines[0].problemWords[0].word).toBe('thought');
    expect(r.report.lines[0].problemWords[0].phonemes).toEqual(['θ']);
    expect(r.report.lines[0].problemWords[0].reason).toBe('voiced th');
  });

  it('strips markdown fences and surrounding chatter', () => {
    const raw = `Here's your grading:\n\n\`\`\`json\n${JSON.stringify({
      scores: { pronunciation: 50, naturalness: 50, fluency: 50 },
      summary: '',
      lines: [],
    })}\n\`\`\``;
    const r = parsePronCheckJSON(raw);
    expect(r.ok).toBe(true);
  });

  it('clamps out-of-range or non-numeric scores to 0-100', () => {
    const raw = JSON.stringify({
      scores: { pronunciation: 150, naturalness: -10, fluency: 'broken' },
      summary: '',
      lines: [],
    });
    const r = parsePronCheckJSON(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.scores).toEqual({ pronunciation: 100, naturalness: 0, fluency: 0 });
  });

  it('rejects when scores are missing entirely', () => {
    const r = parsePronCheckJSON(JSON.stringify({ summary: 'x', lines: [] }));
    expect(r.ok).toBe(false);
  });

  it('coerces a plain-string problemWord to an object with empty phonemes', () => {
    const raw = JSON.stringify({
      scores: { pronunciation: 1, naturalness: 1, fluency: 1 },
      summary: '',
      lines: [
        { idx: 1, said: '', tip: '', problemWords: ['thought'] },
      ],
    });
    const r = parsePronCheckJSON(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.lines[0].problemWords).toEqual([
      { word: 'thought', phonemes: [] },
    ]);
  });

  it('strips slashes from phoneme symbols', () => {
    const raw = JSON.stringify({
      scores: { pronunciation: 1, naturalness: 1, fluency: 1 },
      summary: '',
      lines: [
        {
          idx: 1, said: '', tip: '',
          problemWords: [{ word: 'this', phonemes: ['/ð/'] }],
        },
      ],
    });
    const r = parsePronCheckJSON(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.lines[0].problemWords[0].phonemes).toEqual(['ð']);
  });

  it('drops malformed lines without rejecting the whole response', () => {
    const raw = JSON.stringify({
      scores: { pronunciation: 1, naturalness: 1, fluency: 1 },
      summary: '',
      lines: [
        { idx: 1, said: '', tip: '', problemWords: [] },
        { said: 'no idx', tip: '', problemWords: [] },
        null,
        'broken',
      ],
    });
    const r = parsePronCheckJSON(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.lines).toHaveLength(1);
    expect(r.report.lines[0].idx).toBe(1);
  });

  it('returns ok: false on totally unparseable input', () => {
    const r = parsePronCheckJSON('definitely not json');
    expect(r.ok).toBe(false);
  });

  it('returns ok: false on empty input', () => {
    const r = parsePronCheckJSON('');
    expect(r.ok).toBe(false);
  });
});
