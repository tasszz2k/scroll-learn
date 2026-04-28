import { useState, useEffect } from 'react';

export type PromptOutputFormat = 'simple' | 'csv' | 'json';
export type CardTypeOption = 'text' | 'mcq-single' | 'cloze' | 'mixed';
export type PromptMode = 'general' | 'translation';
export type TranslationDirection = 'en->vi' | 'vi->en';
export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

const CEFR_LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const CEFR_DESCRIPTIONS: Record<CEFRLevel, string> = {
  A1: 'A1 (Beginner): very simple words and present-tense sentences.',
  A2: 'A2 (Elementary): everyday vocabulary, short sentences, basic past/future.',
  B1: 'B1 (Intermediate): common idioms, compound sentences, broader topical vocabulary.',
  B2: 'B2 (Upper-Intermediate): nuanced vocabulary, abstract topics, varied connectors.',
  C1: 'C1 (Advanced): academic and idiomatic language, complex sentence structures.',
  C2: 'C2 (Proficient): native-like vocabulary, subtle connotations, technical and literary language.',
};
const ENGLISH_LEVEL_KEY = 'scroll-learn:prompt-english-level';

interface PromptGeneratorProps {
  initialInput?: string;
  inputPlaceholder?: string;
  defaultCardCount?: number;
  defaultFormat?: PromptOutputFormat;
  defaultCardType?: CardTypeOption;
  mode?: PromptMode;
  defaultDirection?: TranslationDirection;
  onGenerated?: () => void;
}

function formatInstructionsFor(format: PromptOutputFormat): string {
  if (format === 'csv') {
    return `Use CSV with this exact header row:
deck,kind,front,back,backExtra,options,correct,fuzziness,mediaUrl,tags

Column rules:
- deck: deck name (string)
- kind: text | mcq-single | mcq-multi | cloze (defaults to text if blank)
- front: question text shown to the learner. For cloze, embed the answer in {{double-braces}}, e.g. "I {{have}} already discussed this."
- back: answer text. For text cards keep it 1-5 words. For multiple accepted answers separate with || (double pipe). For MCQ, may be left blank (derived from options[correct]).
- backExtra: REQUIRED on every card that teaches a real learnable item (vocabulary, idiom, grammar point, concept). Rich, learner-facing reveal-only content shown AFTER answering — this is the primary teaching surface, so make it dense and useful (headword + part of speech, meaning, at least one natural example with its translation under the bullet, plus word family / collocations / register / contrast as relevant). When several cards target the same item (text + cloze + mcq-single), each one MUST carry a DIFFERENT backExtra that teaches the item from a different angle (text -> definition + family; cloze -> syntax + collocations; mcq-single -> contrast vs the distractors). Do NOT copy the same body across cluster mates, and do NOT leave any row empty. Leave blank ONLY for pure-recall drills with no context worth teaching. Markdown-lite is supported: blank line = paragraph break, "* " starts a bulleted list, indented lines under a bullet attach as continuation lines, **word** is bold. Wrap the whole field in double quotes and escape internal quotes by doubling them so newlines stay inside the cell.
- options: MCQ only. Exactly 4 pipe-separated options: opt1|opt2|opt3|opt4. Leave blank for non-MCQ.
- correct: MCQ only. 0-based index of the correct option.
- fuzziness: leave empty.
- mediaUrl: leave empty.
- tags: optional pipe-separated topical tags, e.g. transition|academic.

Quoting: wrap any field that contains a comma, double-quote, or newline in double quotes; double an internal quote to escape it. Example MCQ row:
Vocab,mcq-single,"What does 'meanwhile' mean?",,,trong khi đó|do đó|tương tự|chắc chắn,0,,,transition`;
  }
  if (format === 'simple') {
    return `Use simple format, one card per line:
Question|Answer            (text)
Question|Answer1||Answer2  (text with multiple accepted answers, joined by || on the back)
Question|CorrectAnswer|Wrong1|Wrong2|Wrong3   (MCQ - first answer after the question is correct, rest are distractors)
For cloze, write the question with {{answer}} braces and put the answer after the pipe.
Note: simple format does NOT support backExtra (rich reveal-only details). Switch to CSV or JSON if you want to attach definitions, examples, or word families.`;
  }
  return `Use JSON. Each card is an object:
{ "deck": "...", "kind": "text|mcq-single|mcq-multi|cloze", "front": "...", "back": "...", "backExtra": "optional rich context shown after answering, supports markdown-lite (paragraphs, * bullets, **bold**)", "options": ["a","b","c","d"], "correct": 0, "tags": ["tag1"] }
- For text: kind="text", omit options/correct.
- For MCQ: kind="mcq-single", provide exactly 4 options and a 0-based correct index. back is optional.
- For cloze: kind="cloze", front contains {{answer}}, back contains the answer word.
- backExtra is REQUIRED on every card that teaches a real learnable item (vocab, idiom, grammar point, concept) and OPTIONAL only for pure-recall drills. When several cards target the same item, each one MUST carry a DIFFERENT backExtra that teaches the item from a different angle (text -> definition + family; cloze -> syntax + collocations; mcq-single -> contrast vs the distractors). Do NOT copy the same body across cluster mates. Use \\n for newlines inside the JSON string.
- Output a single JSON array.`;
}

const BACK_EXTRA_GUIDANCE = `BACK DETAILS (REQUIRED reveal-only context for every learnable item)
The backExtra field renders a rich panel the learner sees AFTER they answer. Treat it as the highest-leverage teaching surface in each card: this is where the learner LEARNS, the front/back is just where they get TESTED. Make it dense with value, not filler.

Goal: DIVERSITY. The learner will meet the same item across multiple cards (text + cloze + mcq-single). Each card's backExtra must explore a DIFFERENT angle of that item — different facets, different examples, different framings — so each repeat exposure is a fresh learning event, not a copy-paste of the previous one.

REQUIRED, with one exception:
- Every card that targets a real learnable item (vocabulary word, idiom, phrasal verb, collocation, grammar point, concept) MUST have backExtra. Do NOT leave it blank just because the card is mcq-single or cloze. The learner needs the same reveal panel regardless of which form they answered in.
- The ONLY exception is pure-recall drills with no surrounding context worth teaching (e.g. "What is 7x8?", "Capital of France?"). For those, leave backExtra blank.

CLUSTER MATES MUST CARRY DIFFERENT backExtra (CRITICAL — this is the diversity rule):
- When you generate multiple cards for the SAME item (e.g. text + cloze + mcq-single all targeting "inequality"), every one of those cards MUST have its OWN backExtra body, and those bodies MUST teach the item from DIFFERENT angles. Do NOT copy the same paragraph onto each row, and do NOT leave the mcq/cloze rows empty.
- Reason: the learner meets the same item three times across the cluster. Repeating identical reveal panels wastes those exposures. Each card is a fresh chance to expose a different facet — meaning, family, register, contrast, syntax, collocations, false friends, etc. Diversity is the goal: explore the item, do not restate it.

PER-KIND backExtra ANGLES (use as a starting point, mix and adapt):
- text card (cue -> word, or word -> translation): lead with meaning + part of speech + Vietnamese gloss, then give the core word family / derived forms and 1-2 example sentences that show the most natural use. This is the "definition entry" view of the item.
- cloze card (production in a sentence): focus on the SYNTAX. Show the sentence patterns this word habitually appears in, common collocations and the prepositions it takes, register notes, and 1-2 alternative sentences using the same pattern. This is the "how it lives in a sentence" view.
- mcq-single (recognition / contrast): focus on DISAMBIGUATION. Contrast the correct answer against each of the distractors in 1-2 lines each ("X means..., whereas Y means...", with Vietnamese glosses). Add a brief note on the most common learner confusions for this item. This is the "why not the others" view.
- mcq-multi: focus on the subtle distinctions that determine which set of options applies — when do you pick A AND B together vs A alone, what shared semantic feature unifies the correct set, etc.
- Across the cluster, also try to vary the example sentences themselves — do not reuse the same sentence in three different cards.

QUALITY BAR (every backExtra must be genuinely useful):
- Lead with the headword and its part of speech, e.g. "**inequality** (noun)".
- VOCABULARY items: on the line directly under the headword, include IPA pronunciation prefixed with region tags. Use the exact format "us /IPA/   uk /IPA/" (US first, two spaces, UK second). If only one variant is in the source you are working with, just emit "us /IPA/". Use proper IPA characters (ə, æ, ɪ, ʃ, ŋ, ˈ, etc.) — not ASCII approximations. Skip this for grammar points, idioms, concepts, and other non-vocabulary kinds where pronunciation is not the unit of learning. (For multi-word vocabulary like "pedagogical paradigm", give the IPA of the head word; for phrasal verbs like "break down", IPA is optional.)
- Always include: a clear meaning (in English; add a brief Vietnamese gloss with diacritics when useful), at least ONE natural example sentence, and the example sentence's Vietnamese translation on a continuation line under the bullet.
- Add when applicable: word family / derived forms (verb/adjective/adverb), common collocations, register / formality note, a contrast with one near-synonym from the same cluster (this is high-leverage for B1+ learners).
- Drop generic dictionary fluff. Every line must answer "why does the learner need this?" If a section adds nothing for THIS item, omit it.
- Length: there is no upper cap. Long is fine — even encouraged — IF every line carries weight. A 25-line backExtra with two example sentences in different registers, a real word family, a contrast vs a near-synonym, and a register note is great. A 25-line backExtra padded with restatements is not. Density over brevity, but never filler.

FORMAT (markdown-lite, same as the dashboard renderer):
- Blank lines separate paragraphs.
- Lines starting with "* " (or "- ") are bullets. Indented continuation lines under a bullet (4-space indent) attach to that bullet as a secondary line — use this for the "-> Vietnamese translation" line under each English example.
- **word** is bold (use for the headword, structure name, or key contrast term). No other markup is supported.

EXAMPLE SHAPES (mix freely per item; do NOT force every card into a vocab template):

- Vocabulary item:
  **wiring** (noun)
  us /ˈwaɪ.ɚ.ɪŋ/   uk /ˈwaɪə.rɪŋ/

  Meaning: the system of wires that carries electricity in a building or device. Vietnamese: hệ thống dây điện; việc lắp dây điện.

  Word family:
  * wire (noun / verb): dây điện; lắp dây điện
  * wireless (adj): không dây
  * rewire (verb): lắp lại hệ thống dây điện

  Examples:
  * The house has old wiring.
      -> Ngôi nhà có hệ thống dây điện cũ.
  * We need to check the wiring before plugging it in.
      -> Chúng ta cần kiểm tra hệ thống dây điện trước khi cắm.

- Grammar point / structure:
  **Used to + base verb** describes a past habit or state that is no longer true.

  Common pitfalls:
  * Negative is "didn't use to", NOT "didn't used to".
  * Question is "Did you use to...?", NOT "Did you used to...?".

  Contrast: "be used to + V-ing" means "be accustomed to" — different meaning entirely.

  Examples:
  * I used to live in Hanoi.
      -> Trước đây tôi từng sống ở Hà Nội.

- Idiom / phrasal verb:
  **break down** (phrasal verb, separable for objects)

  Meanings:
  * (machine) stop functioning. Vietnamese: chết máy, hỏng.
  * (person) lose composure, cry. Vietnamese: suy sụp, bật khóc.

  Register: neutral; common in everyday speech.

  Examples:
  * The car broke down on the highway.
      -> Chiếc xe chết máy giữa đường cao tốc.
  * She broke down when she heard the news.
      -> Cô ấy suy sụp khi nghe tin đó.

- Collocation / connector:
  **meanwhile** (adverb) signals two things happening in parallel time. Vietnamese: trong khi đó.

  Contrast cluster mates:
  * meanwhile: parallel time. -> Hai việc cùng lúc.
  * however: contrast, NOT time. -> Diễn tả sự đối lập.
  * thus: result. -> Diễn tả kết quả.

  Example:
  * He cooked dinner; meanwhile, she set the table.
      -> Anh ấy nấu bữa tối; trong khi đó, cô ấy dọn bàn.

Pick the shape that fits the item; omit any section that doesn't help. English inside backExtra must match the learner's CEFR level when one is set. Vietnamese MUST keep proper diacritics on every word.`;

function buildGeneralPrompt(
  userContent: string,
  cardCount: number,
  outputFormat: PromptOutputFormat,
  cardType: CardTypeOption,
): string {
  const cardTypeInstructions =
    cardType === 'text'
      ? 'Generate only text-based question and answer pairs. Keep answers 1-5 words; use || to list multiple accepted answers.'
      : cardType === 'mcq-single'
        ? 'Generate multiple-choice questions with exactly 4 options each. Distractors must be plausible (semantically close but wrong), not trivially wrong.'
        : cardType === 'cloze'
          ? 'Generate fill-in-the-blank cloze cards: each front is a sentence with the target word wrapped in {{double-braces}}, and the back contains just that word.'
          : 'Mix card types in roughly these proportions: ~40% mcq-single, ~30% text, ~30% cloze. Vary which kind tests which item; do not generate three identical-shape cards in a row.';
  const formatInstructions = formatInstructionsFor(outputFormat);
  const backExtraNote = `NON-NEGOTIABLE RULE: every card that teaches a real learnable item (vocab, idiom, grammar point, concept) MUST have a non-empty backExtra column. This applies equally to text, cloze, mcq-single, and mcq-multi rows. There is NO mcq exception and NO cloze exception. Skip backExtra ONLY for pure-recall drills with no surrounding context worth teaching (e.g. "What is 7x8?").

When you generate multiple cards for the same item (text + cloze + mcq-single all targeting the same word/structure), every card MUST have its OWN backExtra body, and those bodies MUST teach the item from DIFFERENT angles. Do NOT copy the same paragraph across rows, and do NOT leave any row empty. Suggested angles per kind: text -> definition + word family + meaning; cloze -> syntax + collocations + sentence patterns; mcq-single -> contrast against the distractors and common confusions. Vary the example sentences across the cluster too.

Make backExtra meaningful and dense: lead with the headword in **bold** plus part of speech, give a clear meaning, include at least one natural example sentence with its translation when relevant, and add word family / collocations / register / contrast with a near-synonym whenever those help. Length is uncapped — long is fine if every line earns its place.

For VOCABULARY items specifically, add a pronunciation line directly under the headword/POS line in the format "us /IPA/   uk /IPA/" (use proper IPA characters: ə, æ, ɪ, ʃ, ŋ, ˈ, etc., not ASCII). Skip the IPA line for grammar points, idioms, and concepts where pronunciation is not the unit of learning.

Markdown-lite: blank line = paragraph break, "* " = bulleted list, indented lines under a bullet = continuation lines (use for the "-> translation" line under each example), **word** = bold.

VERIFICATION CHECKLIST (run before emitting the final output)
Scan every row. If any learnable-item card (including mcq-single, mcq-multi, and cloze rows) has an empty backExtra, fix it now. If two rows in the same cluster share the same backExtra body, rewrite one. For vocab items, confirm the IPA pronunciation line is present right under the headword. Confirm every backExtra reads as a coherent finished passage — no sentence cut off mid-clause, no paragraph collides with the next ("...independent and  (adverb)" is a FAILURE). Only then emit the data.`;
  const trimmed = userContent.trim();
  const isRawData = trimmed.length > 200 || trimmed.includes('\n');
  return isRawData
    ? `Convert the following content into ${cardCount} flashcards.\n\n---\n${trimmed}\n---\n\n${cardTypeInstructions}\n\n${backExtraNote}\n\n${formatInstructions}\n\nOutput ONLY the data in the specified format.`
    : `Create ${cardCount} flashcards on: ${trimmed || '[topic]'}\n\n${cardTypeInstructions}\n\n${backExtraNote}\n\n${formatInstructions}\n\nOutput ONLY the data in the specified format.`;
}

function buildTranslationPrompt(
  userContent: string,
  cardCount: number,
  outputFormat: PromptOutputFormat,
  cardType: CardTypeOption,
  direction: TranslationDirection,
  englishLevel: CEFRLevel,
): string {
  const sourceLang = direction === 'en->vi' ? 'English' : 'Vietnamese';
  const cardTypeInstructions =
    cardType === 'text'
      ? `Generate ONLY text translation cards. Keep each answer 1-5 words; use || on the back when several translations are equally acceptable (e.g. "meanwhile" -> "in the meantime||at the same time").`
      : cardType === 'mcq-single'
        ? `Generate ONLY multiple-choice cards: a short cue plus exactly 4 candidate options, one correct.`
        : cardType === 'cloze'
          ? `Generate ONLY cloze (fill-in-the-blank) cards. Front = a short English sentence (preferably drawn from the source notes) with the target English word in {{double-braces}}. Back = just that word.`
          : `Mix card kinds in roughly these proportions: ~40% mcq-single, ~30% text translation, ~30% cloze. Vary the kind across the same cluster so the learner meets each concept in multiple shapes.`;
  const formatInstructions = formatInstructionsFor(outputFormat);
  return `You are creating English-learning flashcards from notes a learner highlighted while reading ${sourceLang} content on the web. The goal is to improve their English.

NON-NEGOTIABLE RULE (read this twice, apply to every row you emit)
- EVERY card that teaches a real learnable item (vocabulary word, idiom, phrasal verb, collocation, grammar point, concept) MUST have a non-empty backExtra column. This applies equally to text rows, cloze rows, mcq-single rows, and mcq-multi rows. There is NO mcq exception. There is NO cloze exception.
- When several cards target the same item, each card's backExtra must be DIFFERENT and teach the item from a different angle (definition / syntax / contrast). Do NOT copy the same body across rows. Do NOT leave any row empty.
- The only legitimate empty-backExtra case is a pure recall drill with no surrounding context worth teaching (e.g. "What is 7x8?"). For language-learning notes, that case is rare.
- Before you finish, you will run a VERIFICATION CHECKLIST (specified at the bottom of this prompt) and fix any violations.

LEARNER PROFILE
- CEFR English level: ${CEFR_DESCRIPTIONS[englishLevel]}
- Tailor vocabulary, sentence complexity, and distractor difficulty to the CEFR level. Skip items the learner already knows trivially OR cannot yet use, unless they are central to the source.
- Preserve domain-specific terms in their source form when there is no natural translation in the target language (proper nouns, brand names, technical jargon, abbreviations, code identifiers). Do NOT force a translation that nobody actually uses.

SOURCE NOTES (one item per line, possibly noisy)
---
${userContent.trim()}
---

CLEANING (do this BEFORE writing any cards)
1. Deduplicate exact and near-duplicate items (case-insensitive). If "meanwhile" appears 3 times, keep ONE.
2. Drop UI / site-chrome noise: "Main menu", "View history", "View source", "Donate", "Create account", "Log in", "Talk", "active", lone "Welcome", "From today's featured article", login labels, navigation breadcrumbs, button text. Anything that is clearly site UI rather than reading content.
3. Drop fragments that are pure punctuation, lone numbers, or single function words with no learning value (e.g. "the", "of", "a").
4. Keep meaningful vocabulary, idioms, collocations, transitional phrases (e.g. "meanwhile", "thus", "likewise", "due to"), and full sentences worth translating.

CONNECT THE DOTS (treat the whole list as ONE coherent reading session, not isolated lines)
1. Read the entire source first and form a mental model of the topic(s) and register before writing any card.
2. Cluster related items: synonyms / near-synonyms (e.g. "meanwhile" + "likewise" + "thus" are all logical-flow connectors), items from the same domain (e.g. enzyme kinetics terminology), collocations and their head nouns, etc.
3. Reuse the source's own context. When a word appears in a sentence in the notes, base the example on that sentence rather than inventing a generic one. When a paragraph defines a concept, build cards that draw on the paragraph's own framing.
4. Include a few contrast / disambiguation cards across cluster mates rather than four isolated translations of near-synonyms. Pull MCQ distractors from OTHER items in the same cluster.
5. For long passages, produce ONE full-sentence translation card AND 2-4 vocabulary cards from that passage, plus optionally a comprehension MCQ. Shared cluster -> shared tag.
6. For the SAME high-value item, generate 2-3 reinforcement cards in different shapes (a translation card + a cloze using the source sentence + an MCQ contrasting it with cluster mates). The CSV deduper will keep only exact duplicates, so vary the question wording.
7. Order the output by topic cluster, not by source line order. Cards in the same cluster should be adjacent.

ANSWER LANGUAGE (IMPORTANT)
- The learner is improving their English. Cards that force them to RECALL or PRODUCE English are more valuable than cards that only test recognition.
- Bias the output so that ~70-80% of cards have ENGLISH on the back (or as the cloze blank, or as the correct MCQ option). The remaining ~20-30% may have Vietnamese on the back for recognition variety.
- The Direction setting (currently: ${direction === 'en->vi' ? 'EN -> VI' : 'VI -> EN'}) describes what the SOURCE notes are mostly written in (${sourceLang}); it does NOT force every answer to be in the other language. Mix freely as described below.

CARD KIND GUIDANCE
- text translation (English-answer preferred):
  * Preferred shape: front = a short Vietnamese cue / definition / synonym, back = the English word or phrase from the source. Keep back 1-5 words. Use || to list equally valid English alternatives.
  * Variety shape (~20-30%): front = English item from the source, back = concise Vietnamese translation, 1-5 words.
- mcq-single (English-answer preferred):
  * Preferred shape: question shows a Vietnamese cue (or English context with a blank), the 4 options are English candidates, one correct. Distractors come from cluster mates whenever possible.
  * Variety shape (~20-30%): question shows an English item, the 4 options are Vietnamese translations, one correct.
- cloze (always English-answer):
  * Front is a short ENGLISH sentence (lifted or lightly adapted from the source) with the target English word in {{double-braces}}; back is just that English word. Cloze always tests production of English in English context.
- Bidirectional vocab (mixed mode only): for each high-value vocab item, include at least one card with English on the back AND, less often, one with Vietnamese on the back, so the learner gets both production and recognition practice on the same item.
- ${cardTypeInstructions}

LANGUAGE QUALITY
- English answers should be natural and idiomatic. Match the register of the source (academic, casual, technical) rather than defaulting to formal business English. Preserve untranslatable domain terms (proper nouns, brand names, technical jargon) in their original English form rather than inventing forced equivalents.
- Vietnamese fields (cues, the minority of Vietnamese-answer backs, options, example glosses) MUST use proper diacritics (tiếng Việt có dấu). Write "bỏ qua" not "bo qua", "tổng hợp" not "tong hop", "trong khi đó" not "trong khi do". This is non-negotiable on every Vietnamese field, including options, tags, and example sentences. Pick the most natural register; avoid stiff word-for-word translations when an idiomatic Vietnamese phrase exists.

${BACK_EXTRA_GUIDANCE}

DECK & TAGS
- Deck name: reflect the dominant topic of the source (e.g. "Logical Connectors", "Enzyme Kinetics", "Wikipedia Vocab"). Use "Vocab" only if the source has no clear theme.
- Tags: short topical tags drawn from the clusters (e.g. transition, academic, biology). Items in the same cluster share a tag.

VOLUME
- Target up to ${cardCount} cards total. If the cleaned source has fewer learnable items, return fewer cards rather than padding with junk. Better 30 sharp cards than 60 with filler.

CLUSTER WORKED EXAMPLE (study this before writing your output)
The following three rows show how the SAME item ("inequality") is taught across three card kinds. Notice that EVERY row has a non-empty backExtra column AND each one teaches a different angle of the same word. This is the standard you must hit for every learnable item in your output:

Vocab,text,sự bất bình đẳng,inequality,"**inequality** (noun)
us /ˌɪn.ɪˈkwɑː.lə.t̬i/   uk /ˌɪn.ɪˈkwɒl.ə.ti/

Meaning: an unfair difference between groups of people, especially in society. Vietnamese: sự bất bình đẳng.

Word family:
* equal (adj): bằng nhau, công bằng
* equality (noun): sự bình đẳng
* unequal (adj): không công bằng

Example:
* Income inequality has risen sharply.
    -> Sự bất bình đẳng thu nhập đã tăng mạnh.",,,,,academic|sociology
Vocab,cloze,The report highlights growing {{inequality}} in education.,inequality,"**inequality** — sentence patterns

Common collocations:
* income / wealth / gender / racial inequality
* growing / rising / widening inequality
* tackle / address / reduce inequality

Register: academic, journalistic.

Example:
* Tackling gender inequality requires policy reform.
    -> Giải quyết bất bình đẳng giới đòi hỏi cải cách chính sách.",,,,,academic|sociology
Vocab,mcq-single,Which word refers to a lack of fairness or balance in society?,inequality,"**inequality** vs the distractors

* inequality: unfair social/economic difference. -> sự bất bình đẳng.
* paradigm: a model or framework, NOT about fairness. -> mô hình, hình mẫu.
* pedagogical: relating to teaching. -> thuộc về sư phạm.
* opinion: a personal view, NOT about distribution. -> ý kiến, quan điểm.

Common confusion: 'inequality' is about SOCIAL/ECONOMIC distribution, not personal disagreement.",inequality|paradigm|pedagogical|opinion,0,,,academic|sociology

Notice: three rows, three different backExtra bodies (definition / syntax / contrast). The mcq-single row has the SAME structural shape — it carries its own backExtra exactly like the text row does. Replicate this pattern for every item in your output.

VERIFICATION CHECKLIST (run before emitting the final output)
After writing all cards, scan EACH row and confirm:
1. Is this row a learnable-item card (vocab / idiom / grammar / concept)? If yes, the backExtra column MUST be non-empty. If you find an empty backExtra on a learnable-item row — including any mcq-single, mcq-multi, or cloze row — fix it now. Do not output a row in that broken state.
2. Each cluster (cards sharing the same target item) has DIFFERENT backExtra bodies covering different angles. If two rows share the same body, rewrite one.
3. Headword + part of speech in **bold** appears at the top of each backExtra. Vietnamese keeps proper diacritics. Example sentences have a translation continuation line under the bullet.
4. For VOCABULARY items, the IPA pronunciation line ("us /IPA/   uk /IPA/" with real IPA characters) appears directly under the headword line. Grammar / idiom / concept cards skip this. If a vocab card is missing IPA, add it now.
5. COMPLETENESS: every backExtra reads as a coherent, finished passage. No sentence ends mid-clause. No paragraph collides with the next ("...giáo dụgm**" or "...independent and  (adverb)" are FAILURES — they show truncation). Every "Meaning:" line ends in a period. Every example sentence ends in a period. Every label like "Word family:" or "Examples:" is followed by its actual content, not the start of the next section. If you spot any truncation or merge, rewrite the affected backExtra in full before emitting.
6. CSV-specific: every multi-line backExtra is wrapped in double quotes; internal "" are doubled. Empty cells appear as ,, with no space.
7. Once all checks pass, emit the data. Do not emit checklist results, commentary, or markdown fences — just the raw data.

OUTPUT FORMAT
${formatInstructions}

Output ONLY the data in the specified format. No commentary, no explanations, no markdown code fences.`;
}

export default function PromptGenerator({
  initialInput = '',
  inputPlaceholder = "A topic (e.g., 'Spanish basics') or paste content",
  defaultCardCount = 20,
  defaultFormat = 'csv',
  defaultCardType = 'mixed',
  mode = 'general',
  defaultDirection = 'en->vi',
  onGenerated,
}: PromptGeneratorProps) {
  const [promptInput, setPromptInput] = useState(initialInput);
  const [promptCardCount, setPromptCardCount] = useState(defaultCardCount);
  const [promptOutputFormat, setPromptOutputFormat] = useState<PromptOutputFormat>(defaultFormat);
  const [promptCardType, setPromptCardType] = useState<CardTypeOption>(defaultCardType);
  const [direction, setDirection] = useState<TranslationDirection>(defaultDirection);
  const [englishLevel, setEnglishLevel] = useState<CEFRLevel>(() => {
    try {
      const saved = localStorage.getItem(ENGLISH_LEVEL_KEY);
      if (saved && (CEFR_LEVELS as string[]).includes(saved)) return saved as CEFRLevel;
    } catch { /* ignore storage access errors */ }
    return 'A2';
  });
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(ENGLISH_LEVEL_KEY, englishLevel); } catch { /* ignore */ }
  }, [englishLevel]);

  function handleGenerate() {
    const prompt = mode === 'translation'
      ? buildTranslationPrompt(promptInput, promptCardCount, promptOutputFormat, promptCardType, direction, englishLevel)
      : buildGeneralPrompt(promptInput, promptCardCount, promptOutputFormat, promptCardType);
    setGeneratedPrompt(prompt);
    setPromptCopied(false);
    onGenerated?.();
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  const isTranslation = mode === 'translation';
  const controlsTemplate = isTranslation ? '1fr 1fr 1fr 1fr 1fr' : '1fr 1fr 1fr';

  return (
    <div className="card-flat" style={{ padding: 24, marginBottom: 32 }}>
      <div className="eyebrow">
        Prompt generator · for ChatGPT, Claude, etc.
        {isTranslation && <span style={{ marginLeft: 10, color: 'var(--clay-deep)' }}>· translation mode</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginTop: 14 }}>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>Topic or raw text</label>
          <textarea
            className="input-editorial"
            value={promptInput}
            onChange={e => setPromptInput(e.target.value)}
            placeholder={inputPlaceholder}
            style={{ minHeight: 100, fontFamily: 'inherit', resize: 'vertical' }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: controlsTemplate, gap: 10, marginTop: 12 }}>
            <div>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Cards</label>
              <input
                type="number"
                className="input-editorial"
                value={promptCardCount}
                onChange={e => setPromptCardCount(parseInt(e.target.value) || 20)}
                min={1}
                max={200}
              />
            </div>
            <div>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Format</label>
              <select
                className="input-editorial"
                value={promptOutputFormat}
                onChange={e => setPromptOutputFormat(e.target.value as PromptOutputFormat)}
              >
                <option value="csv">CSV</option>
                <option value="simple">Simple</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Type</label>
              <select
                className="input-editorial"
                value={promptCardType}
                onChange={e => setPromptCardType(e.target.value as CardTypeOption)}
              >
                <option value="mixed">Mixed</option>
                <option value="text">Text only</option>
                <option value="mcq-single">MCQ only</option>
                <option value="cloze">Cloze only</option>
              </select>
            </div>
            {isTranslation && (
              <>
                <div>
                  <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>Direction</label>
                  <select
                    className="input-editorial"
                    value={direction}
                    onChange={e => setDirection(e.target.value as TranslationDirection)}
                  >
                    <option value="en->vi">EN → VI</option>
                    <option value="vi->en">VI → EN</option>
                  </select>
                </div>
                <div>
                  <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>EN level</label>
                  <select
                    className="input-editorial"
                    value={englishLevel}
                    onChange={e => setEnglishLevel(e.target.value as CEFRLevel)}
                    title={CEFR_DESCRIPTIONS[englishLevel]}
                  >
                    {CEFR_LEVELS.map(lvl => (
                      <option key={lvl} value={lvl}>{lvl}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
          <div style={{ marginTop: 14 }}>
            <button onClick={handleGenerate} className="btn btn-clay" type="button">
              Generate prompt
            </button>
          </div>
        </div>
        <div>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>Generated prompt</label>
          <textarea
            className="input-editorial"
            readOnly
            value={generatedPrompt}
            placeholder="Click 'Generate prompt' to see the result"
            style={{ minHeight: 220, fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace", fontSize: 12, resize: 'vertical' }}
          />
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleCopy} disabled={!generatedPrompt} className="btn btn-ghost" type="button">
              {promptCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
