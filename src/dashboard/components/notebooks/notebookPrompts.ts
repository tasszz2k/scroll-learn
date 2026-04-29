// Prompt builders for the Notebooks AI menu (Ask / Summarize / Generate
// quiz). Mirrors the patterns in src/dashboard/components/aiAssist/prompts.ts
// but targets multi-paragraph authored markdown instead of a single
// captured-note string.

import type { Notebook } from '../../../common/types';

const FORMAT_INSTRUCTION_EXPLAIN = `FORMAT
Reply in markdown-lite only:
- Blank line = paragraph break.
- Lines starting with "* " (or "- ") are bulleted.
- Indented lines under a bullet attach as continuation lines.
- **word** is bold (use for headwords or key terms).
Do NOT use code fences, tables, headings (# ##), images, or links. No HTML. No emoji.`;

// Trim very long bodies so the prompt stays under Gemini's input window.
// 32KB is well below any model's actual cap and matches "a few thousand
// words" -- enough to summarise a long lecture note in full.
const MAX_BODY_CHARS = 32_000;

function describeNotebook(notebook: Notebook, body: string): string {
  const lines: string[] = [];
  if (notebook.title) lines.push(`Title: ${notebook.title}`);
  if (notebook.tags.length > 0) lines.push(`Tags: ${notebook.tags.join(', ')}`);
  if (notebook.folderPath) lines.push(`Folder: ${notebook.folderPath}`);
  for (const [k, v] of Object.entries(notebook.properties)) {
    if (v) lines.push(`${k}: ${v}`);
  }
  const truncated = body.length > MAX_BODY_CHARS
    ? body.slice(0, MAX_BODY_CHARS) + '\n\n[...content truncated...]'
    : body;
  lines.push('---');
  lines.push(truncated || '(notebook is empty)');
  return lines.join('\n');
}

export function buildNotebookAskPrompt(
  notebook: Notebook,
  body: string,
  question: string,
  isFirstTurn: boolean,
): string {
  if (!isFirstTurn) {
    // Follow-up turn: Gemini already has the system framing in its chat
    // context. Just send the bare question to keep the prompt focused.
    return question.trim();
  }
  return `You are a patient learning coach. The learner is studying a notebook they wrote themselves and has a question. Use the notebook content as primary context.

NOTEBOOK
---
${describeNotebook(notebook, body)}
---

LEARNER QUESTION
${question.trim()}

TASK
Answer the learner's question directly, using the notebook as context. If the answer is not in the notebook, say so clearly and provide the best general answer instead. Stay tightly scoped to what the learner asked.

${FORMAT_INSTRUCTION_EXPLAIN}`;
}

export function buildNotebookSummarizePrompt(notebook: Notebook, body: string): string {
  return `You are a patient learning coach. Summarise the learner's own notebook in a way that helps them quickly review what they wrote.

NOTEBOOK
---
${describeNotebook(notebook, body)}
---

TASK
Produce a learner-friendly summary of this notebook. Lead with a one-line synopsis in **bold**. Then give 3 to 6 bullet points that capture the highest-value ideas, decisions, examples, or open questions. Drop fluff. If the notebook references a specific framework, technology, or concept, mention it explicitly so the summary stands on its own when read out of context.

${FORMAT_INSTRUCTION_EXPLAIN}`;
}

// Quiz-generation prompt: returns the same CSV envelope `useGeminiAutomation`
// already extracts from the chat output. The CSV header MUST match what the
// dashboard's existing parser expects (`deck,kind,front,...`) so the
// pendingImport pipeline can ingest it without any changes.
export function buildNotebookQuizPrompt(notebook: Notebook, body: string): string {
  return `You are a flashcard author. Convert the learner's notebook below into a deck of spaced-repetition flashcards they can drill against.

NOTEBOOK
---
${describeNotebook(notebook, body)}
---

TASK
Produce 8 to 16 high-quality flashcards that test the most important learnable items in this notebook -- definitions, key relationships, named tools or APIs, common pitfalls, and worked examples. Mix the card kinds so the learner is not just answering MCQ:
- Roughly half cloze cards (\`{{answer}}\` syntax inline in the front).
- Roughly a third short-answer (kind=text). Keep canonical answers concise.
- Up to a third multiple choice (kind=mcq-single) for cards where there are clear distractors.

Skip trivia and avoid duplicating the same fact across multiple cards. Prefer cards that probe understanding, not surface recall.

OUTPUT FORMAT
Reply with a single CSV block (no prose around it, no code fences). Use exactly this header:
deck,kind,front,back,backExtra,options,correct,canonicalAnswers,tags

Rules:
- The "deck" column is the same value on every row: a short, descriptive deck name derived from the notebook title.
- "kind" is one of: text, cloze, mcq-single.
- For cloze cards, write the cloze marker inline in the front text using the syntax {{answer}}.
- For mcq-single, list options separated by " | " and put the 0-based index of the correct option in "correct".
- For text cards, list one or two acceptable answers in "canonicalAnswers" separated by " | ".
- Quote any field that contains a comma or newline. Use straight ASCII quotes only.
- Do not output any extra commentary or text outside the CSV.`;
}
