---
name: grammar-police-learn
description: >
  Process Grammar Police JSON exports into learning materials for a DevOps engineer.
  Generates reports (common mistakes, month-over-month comparison), exercises, related
  knowledge, and Scroll-Learn CSV flashcards (minimum 100 questions, MCQ/text/cloze mix).
  Use when asked to process grammar police data, generate learning cards from grammar
  corrections, create flashcards from grammar exports, analyze grammar mistakes,
  or import grammar police data into Scroll-Learn.
---

# Grammar Police Learn

Process exported Grammar Police JSON data into structured learning materials and
Scroll-Learn flashcard decks. Tailored for a DevOps engineer writing daily in
English for work (Slack, PR reviews, Jira, emails, technical proposals).

## Input

A Grammar Police JSON export file at `local-test/data/learning_data_YYYY_MM_DD.json`.

Format: array of objects with `input`, `correction`, `explanation` fields.
- `explanation: "Mode: grammar"` -- English grammar correction
- `explanation: "Mode: translate"` -- English-Vietnamese translation

## Data Quality Warning

The Grammar Police tool uses GPT-4o-mini with limited context. Its corrections
are NOT always correct:
- Misinterprets technical jargon (e.g., "PR" as "public relations" instead of "pull request")
- Over-corrects casual but acceptable phrasing into stiff formal English
- Produces awkward or unnatural corrections
- Gets the correction wrong entirely

Treat exported data as **reference only**. Independently assess each entry, identify
the actual error (if any), and generate your own correct answer.

## Execution Steps

### Step 1: Read and Filter

1. Read the specified JSON file.
2. Deduplicate entries (identical `input` text appearing multiple times).
3. Discard entries with empty `correction`.
4. Separate into **grammar** entries (`Mode: grammar`) and **translate** entries (`Mode: translate`).
5. For grammar entries, discard "minor-only" entries where the only difference is:
   - Punctuation changes (adding/removing periods, commas, colons, semicolons)
   - Capitalization only
6. Discard entries where the tool clearly misunderstood technical context
   (e.g., "PR" corrected as "public relations", "CI" expanded incorrectly).
7. Discard entries that are purely formal rewriting without a real grammar error
   (casual phrasing rewritten to overly formal business English is not a mistake).

### Step 2: Analyze Patterns

**User context**: DevOps engineer. Technical terms (helm, CI, VPA, ArgoCD,
namespace, rollout, kubectl, PR, LGTM, etc.) are daily vocabulary -- do NOT
filter them out. Learning should help express technical concepts in correct English.

Categorize each grammar error into one or more patterns:

| Category | Examples |
|---|---|
| spelling | "reasign" -> "reassign", "pharse" -> "phase", "enterperise" -> "enterprise" |
| verb-form | "we has" -> "we have", "it require" -> "it requires", "I have discuss" -> "I have discussed" |
| article | "in AI era" -> "in the AI era", "working on other task" -> "working on another task" |
| preposition | "access to prod" -> "access prod", "depend on across" -> "depend on" |
| plural | "other configuration" -> "other configurations", "we are customer" -> "we are customers" |
| word-choice | "following this example" -> "follow this example", "ensure" vs "ensuring" |
| sentence-structure | word order issues, fragments, run-on sentences |
| professional-phrasing | "resp you asap" -> "I will respond as soon as possible" |

### Step 3: Check for Previous Month Data

Derive the output folder from the input filename:
`learning_data_2026_03_15.json` -> `local-test/data/learning_data_2026_03/`

Scan `local-test/data/` for the previous month's folder. For `learning_data_2026_03/`,
look for `learning_data_2026_02/report.md`. If found, read it to extract comparison data.

### Step 4: Generate Outputs

All files go into the output folder derived in Step 3.

#### 4a. report.md

Write a learning-focused report with these sections:

**Summary**
- Total entries processed, grammar count, translate count
- Entries filtered out (with reasons)
- Error category distribution (table)

**Most Common Mistakes** (top patterns with 2-3 examples each)
- Show the original input, the actual error, and the correct form
- Group by category

**Vocabulary List** (from translate entries)
- Table: English | Vietnamese | Context/Notes

**Weak Areas** -- recurring patterns that need focused practice

**Month-over-Month Comparison** (only if previous report exists)
- Category count comparison (table: category | last month | this month | trend)
- Repeated mistakes: errors appearing in both months (persistent weak spots)
- Improvements: patterns from last month not seen this month
- New mistakes: patterns appearing for the first time
- Trend summary: concise paragraph on progress

#### 4b. exercises.md and answer_key.md

Generate practice exercises grouped by type in `exercises.md`:

**Spot the Error** -- present a sentence, ask what is wrong
**Fill in the Blank** -- sentence with a blank for the correct word/form
**Rewrite** -- present an incorrect sentence, ask for corrected version
**Vocabulary Matching** -- match English terms to Vietnamese translations

Use real examples from the data. Keep exercises practical and relevant to
DevOps workplace communication.

Do NOT include answers in exercises.md. Put all answers in a separate
`answer_key.md` file, organized by exercise number for easy cross-reference.

#### 4c. related_knowledge.md

**Grammar Rules** -- for each error pattern found, explain the rule with
DevOps-context examples (not generic textbook examples).

**Commonly Confused Words** -- words the user mixes up, with usage tips.

**Professional Communication Patterns** -- templates and tips for:
- Writing clear PR descriptions
- Slack status updates and requests
- Escalation emails
- Jira comments and technical proposals

**DevOps Abbreviations** -- common abbreviations and their proper usage
in sentences (LGTM, CI/CD, VPA, PR, etc.).

**Vocabulary Deep Dive** -- for translate entries: example sentences,
synonyms, related words. Write this section in Vietnamese to reinforce
the target language.

#### 4d. grammar_deck.csv and vocabulary_deck.csv

Generate CSV files for Scroll-Learn import. Read `references/csv-format.md`
for the exact format specification, column definitions, and examples.

Key requirements:
- **Minimum 100 questions across both decks** -- generate more if data supports it.
  Split proportionally by data (e.g., 80% grammar entries -> ~80% grammar cards).
- Mix question types: ~40% mcq-single, ~30% text, ~30% cloze
- Keep answers SHORT (1-5 words max)
- Generate multiple cards per recurring error pattern (reinforcement)
- Avoid exact duplicate questions
- Vocabulary cards go both directions: EN->VN and VN->EN
- Vietnamese answers MUST use proper diacritics: "bỏ qua" not "bo qua",
  "tổng hợp" not "tong hop", "miễn trừ" not "mien tru"

For grammar cards:
- **mcq-single**: "Which is correct?" focused on the specific error point
- **text**: "Correct the spelling: [word]?" or "What word fits: [context]?"
- **cloze**: Sentence with `{{correct_word}}` for fill-in

For vocabulary cards:
- **mcq-single**: "What does '[word]' mean?" (EN->VN) or "'[VN word]' means?" (VN->EN)
- **text**: "Translate: [word/phrase]" in either direction
- **cloze**: "The [language] word for '[word]' is {{answer}}"

Tag each card with its error category for tracking.

## Language

- report.md: English
- exercises.md: English
- answer_key.md: English
- related_knowledge.md: English for grammar sections, Vietnamese for
  vocabulary explanations (Vocabulary Deep Dive section)
- CSV files: English for grammar cards; Vietnamese with proper diacritics
  for vocabulary answers

**All Vietnamese text MUST use proper diacritics (tiếng Việt có dấu).**
Write "tổng hợp" not "tong hop", "bỏ qua" not "bo qua", "chuyên môn"
not "chuyen mon". This applies everywhere: CSV answers, report tables,
exercises, related knowledge, and any other output.

## Output Folder Structure

```
local-test/data/learning_data_YYYY_MM/
  report.md
  exercises.md
  answer_key.md
  related_knowledge.md
  grammar_deck.csv
  vocabulary_deck.csv
```
