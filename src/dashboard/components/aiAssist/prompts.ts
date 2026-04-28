import type { Card, Note } from '../../../common/types';

const FORMAT_INSTRUCTION = `FORMAT
Reply in markdown-lite only:
- Blank line = paragraph break.
- Lines starting with "* " (or "- ") are bulleted.
- Indented lines under a bullet attach as continuation lines.
- **word** is bold (use for headwords or key terms).
Do NOT use code fences, tables, headings (# ##), images, or links. No HTML. No emoji.`;

function describeCard(card: Card): string {
  const lines: string[] = [];
  lines.push(`Kind: ${card.kind}`);
  lines.push(`Front: ${card.front}`);
  if (card.back) lines.push(`Back: ${card.back}`);
  if (card.options && card.options.length > 0) {
    lines.push(`Options: ${card.options.join(' | ')}`);
    if (typeof card.correct === 'number') {
      lines.push(`Correct option: ${card.options[card.correct] ?? '(unknown)'}`);
    } else if (Array.isArray(card.correct)) {
      const correctLabels = card.correct
        .map(i => card.options?.[i])
        .filter((s): s is string => typeof s === 'string');
      lines.push(`Correct options: ${correctLabels.join(' | ')}`);
    }
  }
  if (card.canonicalAnswers && card.canonicalAnswers.length > 0) {
    lines.push(`Accepted answers: ${card.canonicalAnswers.join(' | ')}`);
  }
  if (card.backExtra) {
    lines.push('Existing notes (backExtra):');
    lines.push(card.backExtra);
  }
  if (card.tags && card.tags.length > 0) {
    lines.push(`Tags: ${card.tags.join(', ')}`);
  }
  return lines.join('\n');
}

function describeNote(note: Note): string {
  const lines: string[] = [];
  lines.push(`Captured text: ${note.text}`);
  if (note.translation) lines.push(`Existing translation: ${note.translation}`);
  if (note.pageTitle) lines.push(`Source page: ${note.pageTitle}`);
  if (note.url) lines.push(`URL: ${note.url}`);
  if (note.domain) lines.push(`Domain: ${note.domain}`);
  if (note.senses && note.senses.length > 0) {
    const senseLines = note.senses
      .map(s => `${s.pos}: ${s.terms.join(', ')}`)
      .filter(l => !!l.trim());
    if (senseLines.length > 0) {
      lines.push(`Existing senses: ${senseLines.join(' | ')}`);
    }
  }
  if (note.derivedForms && note.derivedForms.length > 0) {
    const family = note.derivedForms.map(f => `${f.word} (${f.pos})`).join(', ');
    lines.push(`Word family: ${family}`);
  }
  return lines.join('\n');
}

export function buildCardExplainPrompt(card: Card): string {
  return `You are a patient language tutor helping a learner who just answered a flashcard. Explain the answer so the learner deeply understands it.

CARD
---
${describeCard(card)}
---

TASK
Write a clear, learner-focused explanation of this card. Lead with the headword in **bold** and its part of speech (or a short label for grammar/concept cards). Then cover the most useful subset of:
- Meaning. Add a brief Vietnamese gloss when it helps comprehension.
- 1 to 2 natural example sentences. For each, attach the Vietnamese translation on a continuation line under the bullet.
- For vocabulary items, the word family or common collocations (verb / noun / adjective / adverb forms).
- Common confusions, near-synonyms, or pitfalls a learner at this stage typically hits.
- For grammar / concept cards, cover the rule, exceptions, and contrasts with related structures.

Density over length. Skip sections that don't apply. Do not restate the front and back verbatim.

${FORMAT_INSTRUCTION}`;
}

export function buildCardAskPrompt(card: Card, question: string): string {
  return `You are a patient language tutor. The learner is studying the flashcard below and has a follow-up question. Answer the question precisely, using the card as context.

CARD
---
${describeCard(card)}
---

LEARNER QUESTION
${question.trim()}

TASK
Answer the learner's question directly. Stay tightly scoped to what they asked - do not repeat a full card explanation unless the question asks for one. When useful, give one short example sentence with a Vietnamese translation on a continuation line under the bullet.

${FORMAT_INSTRUCTION}`;
}

export function buildNoteExplainPrompt(note: Note): string {
  return `You are a patient language tutor helping a learner who highlighted a passage on the web. Explain the highlighted text so the learner deeply understands it.

CAPTURED NOTE
---
${describeNote(note)}
---

TASK
Write a learner-focused explanation of the highlighted text. Adapt the depth to the captured content:
- If it is a single word: lead with the headword in **bold** plus part of speech, give meaning + Vietnamese gloss, the word family, and 1 to 2 natural example sentences (each with a Vietnamese continuation line under the bullet). Mention register and common collocations when useful.
- If it is a phrase or idiom: explain its meaning and when it is used, contrast it briefly with one near-synonym, and give a natural example sentence with translation.
- If it is a full sentence or longer passage: give a clean translation, then point out 2 to 3 high-value learnable items inside it (vocab, idioms, grammar) with a one-line note on each.

Density over length. Drop sections that don't help.

${FORMAT_INSTRUCTION}`;
}

export function buildNoteAskPrompt(note: Note, question: string): string {
  return `You are a patient language tutor. The learner highlighted the passage below on the web and has a follow-up question. Answer the question precisely, using the captured passage as context.

CAPTURED NOTE
---
${describeNote(note)}
---

LEARNER QUESTION
${question.trim()}

TASK
Answer the learner's question directly. Stay tightly scoped to what they asked. When useful, give one short example sentence with a Vietnamese translation on a continuation line under the bullet.

${FORMAT_INSTRUCTION}`;
}

// Free-form chat prompt for the sidebar Chat tab. No card or note context --
// the learner is asking ad-hoc questions while studying. Subsequent turns in
// the same Gemini window inherit chat history naturally, so we only need a
// system-style framing on the first turn; useGeminiAssist reuses the window
// when contextKey stays the same.
export function buildFreeformAskPrompt(question: string, isFirstTurn: boolean): string {
  if (!isFirstTurn) {
    // Follow-up turn: Gemini already has the system framing in its chat
    // context. Just send the bare question to keep the prompt focused.
    return question.trim();
  }
  return `You are a patient language tutor helping a learner who is studying flashcards. They will ask you ad-hoc questions -- about vocabulary, grammar, idioms, translations between English and Vietnamese, or anything else that comes up while they study. Answer each question directly and concisely.

LEARNER QUESTION
${question.trim()}

TASK
Answer the learner's question. Stay tightly scoped to what they asked. When useful, give one short example sentence with a Vietnamese translation on a continuation line under the bullet. If a translation is helpful (either direction), include it.

${FORMAT_INSTRUCTION}`;
}
