import { describe, expect, it } from 'vitest';
import { buildShadowPrompt, parseShadowJSON } from '../src/dashboard/components/shadow/prompts';

describe('buildShadowPrompt', () => {
  it('embeds target words and the weak-phoneme list', () => {
    const prompt = buildShadowPrompt({
      targetWords: ['meanwhile', 'thus'],
      context: 'Two coworkers discussing a report deadline.',
      level: 'B1',
      speakerCount: 2,
      durationSec: 40,
      weakPhonemes: ['ʃ', 'θ'],
    });
    expect(prompt).toContain('meanwhile');
    expect(prompt).toContain('thus');
    expect(prompt).toContain('/ʃ/');
    expect(prompt).toContain('/θ/');
    expect(prompt).toContain('B1');
    // Includes Vietnamese gloss requirement at A1/A2/B1 levels.
    expect(prompt).toMatch(/glossVi/);
  });

  it('omits the weak-phoneme block instructions when none are passed', () => {
    const prompt = buildShadowPrompt({
      targetWords: [],
      context: 'A simple monologue about morning routines.',
      level: 'A2',
      speakerCount: 1,
      durationSec: 20,
      weakPhonemes: [],
    });
    expect(prompt).toContain('No weak-phoneme focus set yet');
    expect(prompt).toContain('"ipaFocus": []');
  });

  describe('NATURAL DELIVERY block', () => {
    const baseParams = {
      targetWords: ['meanwhile'],
      context: 'Two coworkers chatting.',
      level: 'B1' as const,
      speakerCount: 2,
      durationSec: 40,
      weakPhonemes: [] as string[],
    };

    it('emits the NATURAL DELIVERY heading and core guidance', () => {
      const prompt = buildShadowPrompt({ ...baseParams, register: 'casual' });
      expect(prompt).toContain('NATURAL DELIVERY');
      // Filler list anchors and pacing punctuation directives must appear.
      expect(prompt).toContain('"Hmm,"');
      expect(prompt).toContain('"Well,"');
      expect(prompt).toContain('"You know,"');
      expect(prompt).toContain('30-40 percent');
      expect(prompt).toContain('"..."');
      expect(prompt).toContain('"--"');
      expect(prompt).toContain('"?!"');
      // glossVi must explicitly cover the natural delivery (fillers).
      expect(prompt).toMatch(/glossVi[\s\S]*?fillers/);
    });

    it('marks casual register with heavy filler intensity', () => {
      const prompt = buildShadowPrompt({ ...baseParams, register: 'casual' });
      expect(prompt).toMatch(/Filler intensity[^\n]*casual[^\n]*: heavy/);
      // Heavy guidance line is present.
      expect(prompt).toMatch(/heavy:[\s\S]*?most casual lines/);
      // Contractions are encouraged outside academic.
      expect(prompt).toContain('Contractions are preferred');
    });

    it('marks neutral register with moderate filler intensity', () => {
      const prompt = buildShadowPrompt({ ...baseParams, register: 'neutral' });
      expect(prompt).toMatch(/Filler intensity[^\n]*neutral[^\n]*: moderate/);
      expect(prompt).toMatch(/moderate:[\s\S]*?about a third of lines/);
      expect(prompt).toContain('Contractions are preferred');
    });

    it('marks formal register with minimal filler intensity', () => {
      const prompt = buildShadowPrompt({ ...baseParams, register: 'formal' });
      expect(prompt).toMatch(/Filler intensity[^\n]*formal[^\n]*: minimal/);
      expect(prompt).toMatch(/minimal:[\s\S]*?single soft marker/);
      expect(prompt).toContain('Contractions are preferred');
    });

    it('marks academic register with no fillers and full forms', () => {
      const prompt = buildShadowPrompt({ ...baseParams, register: 'academic' });
      expect(prompt).toMatch(/Filler intensity[^\n]*academic[^\n]*: none/);
      expect(prompt).toMatch(/none: do NOT use fillers/);
      // Academic explicitly avoids contractions.
      expect(prompt).toContain('avoid contractions');
      expect(prompt).toContain('"it is"');
    });

    it('adds per-speaker personality guidance only when speakerCount >= 2', () => {
      const solo = buildShadowPrompt({ ...baseParams, speakerCount: 1, register: 'neutral' });
      expect(solo).toContain('Single speaker');
      expect(solo).not.toContain('Per-speaker personality');

      const duo = buildShadowPrompt({ ...baseParams, speakerCount: 2, register: 'neutral' });
      expect(duo).toContain('Per-speaker personality');
      expect(duo).toContain('A, B');
      // No stage directions allowed in text.
      expect(duo).toContain('no stage directions');
    });
  });
});

describe('parseShadowJSON', () => {
  it('parses a clean JSON response', () => {
    const raw = JSON.stringify({
      title: 'Coffee shop',
      lines: [
        { speaker: 'A', text: 'Hi, can I get a latte?', glossVi: 'Chào, cho tôi một ly latte.', ipaFocus: ['l', 'æ'] },
        { speaker: 'B', text: 'Sure, anything else?', glossVi: 'Vâng, bạn cần gì thêm không?', ipaFocus: [] },
      ],
    });
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.title).toBe('Coffee shop');
    expect(result.script.lines).toHaveLength(2);
    expect(result.script.lines[0].ipaFocus).toEqual(['l', 'æ']);
    // Empty arrays are normalized away.
    expect(result.script.lines[1].ipaFocus).toBeUndefined();
  });

  it('strips ```json fences', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'Fenced',
      lines: [{ speaker: 'A', text: 'Hello.' }],
    }) + '\n```';
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
  });

  it('strips surrounding chatter and parses inner JSON', () => {
    const raw = `Here is your script:\n${JSON.stringify({
      title: 'Test',
      lines: [{ speaker: 'A', text: 'Hi.' }],
    })}\nLet me know if you want a different angle.`;
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
  });

  it('strips slashes from ipaFocus entries when the model leaves them in', () => {
    const raw = JSON.stringify({
      title: 'x',
      lines: [{ speaker: 'A', text: 'thanks', ipaFocus: ['/θ/', 'ʃ'] }],
    });
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.lines[0].ipaFocus).toEqual(['θ', 'ʃ']);
  });

  it('rejects malformed responses', () => {
    const result = parseShadowJSON('totally not json');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty lines array', () => {
    const raw = JSON.stringify({ title: 'x', lines: [] });
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects a line missing speaker', () => {
    const raw = JSON.stringify({ title: 'x', lines: [{ text: 'oops' }] });
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(false);
  });

  it('rejects a line missing text', () => {
    const raw = JSON.stringify({ title: 'x', lines: [{ speaker: 'A' }] });
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(false);
  });

  it('handles JSON with embedded brace strings without breaking the brace counter', () => {
    const raw = JSON.stringify({
      title: 'Curly',
      lines: [{ speaker: 'A', text: 'It said "{not real braces}" and left.' }],
    });
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.lines[0].text).toContain('{not real braces}');
  });

  it('recovers from invalid backslash escapes inside string literals', () => {
    // The model sometimes emits Windows-style path separators or stray
    // backslashes inside text values. The literal "\I" sequence below is an
    // invalid JSON escape -- vanilla JSON.parse rejects it with "Bad escaped
    // character". The parser should sanitize and recover.
    const raw =
      '{"title":"GHEC repo","lines":[' +
      '{"speaker":"A","text":"installed to axon-devices\\InterviewRoom now","ipaFocus":[]}' +
      ']}';
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.lines[0].text).toBe('installed to axon-devices\\InterviewRoom now');
  });

  it('accepts text with natural-delivery punctuation (..., --, !, ?!, embedded commas)', () => {
    const raw = JSON.stringify({
      title: 'Natural delivery',
      lines: [
        { speaker: 'A', text: 'Hmm, well... I was going to say it -- but, honestly, never mind.', glossVi: 'Hmm, ờ thì... tôi định nói đấy -- mà thôi, kệ đi.' },
        { speaker: 'B', text: 'You did what?! Are you serious!', glossVi: 'Cậu làm gì cơ?! Cậu nói thật à!' },
        { speaker: 'A', text: 'Yeah, I mean, it just... happened, you know?', glossVi: 'Ờ thì, tự nhiên nó... xảy ra ấy mà.' },
      ],
    });
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.lines).toHaveLength(3);
    expect(result.script.lines[0].text).toContain('...');
    expect(result.script.lines[0].text).toContain('--');
    expect(result.script.lines[0].text).toContain(',');
    expect(result.script.lines[1].text).toContain('?!');
    expect(result.script.lines[1].text).toContain('!');
    expect(result.script.lines[2].text).toContain('...');
  });

  it('recovers when the model emits a raw backslash before a quoted word', () => {
    const raw =
      '{"title":"x","lines":[' +
      '{"speaker":"A","text":"path is C:\\Users\\me here"}' +
      ']}';
    const result = parseShadowJSON(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.lines[0].text).toBe('path is C:\\Users\\me here');
  });
});
