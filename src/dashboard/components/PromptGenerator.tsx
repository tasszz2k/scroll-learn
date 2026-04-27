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
deck,kind,front,back,options,correct,fuzziness,mediaUrl,tags

Column rules:
- deck: deck name (string)
- kind: text | mcq-single | mcq-multi | cloze (defaults to text if blank)
- front: question text shown to the learner. For cloze, embed the answer in {{double-braces}}, e.g. "I {{have}} already discussed this."
- back: answer text. For text cards keep it 1-5 words. For multiple accepted answers separate with || (double pipe). For MCQ, may be left blank (derived from options[correct]).
- options: MCQ only. Exactly 4 pipe-separated options: opt1|opt2|opt3|opt4. Leave blank for non-MCQ.
- correct: MCQ only. 0-based index of the correct option.
- fuzziness: leave empty.
- mediaUrl: leave empty.
- tags: optional pipe-separated topical tags, e.g. transition|academic.

Quoting: wrap any field that contains a comma, double-quote, or newline in double quotes; double an internal quote to escape it. Example MCQ row:
Vocab,mcq-single,"What does 'meanwhile' mean?",,trong khi đó|do đó|tương tự|chắc chắn,0,,,transition`;
  }
  if (format === 'simple') {
    return `Use simple format, one card per line:
Question|Answer            (text)
Question|Answer1||Answer2  (text with multiple accepted answers, joined by || on the back)
Question|CorrectAnswer|Wrong1|Wrong2|Wrong3   (MCQ — first answer after the question is correct, rest are distractors)
For cloze, write the question with {{answer}} braces and put the answer after the pipe.`;
  }
  return `Use JSON. Each card is an object:
{ "deck": "...", "kind": "text|mcq-single|mcq-multi|cloze", "front": "...", "back": "...", "options": ["a","b","c","d"], "correct": 0, "tags": ["tag1"] }
- For text: kind="text", omit options/correct.
- For MCQ: kind="mcq-single", provide exactly 4 options and a 0-based correct index. back is optional.
- For cloze: kind="cloze", front contains {{answer}}, back contains the answer word.
- Output a single JSON array.`;
}

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
  const trimmed = userContent.trim();
  const isRawData = trimmed.length > 200 || trimmed.includes('\n');
  return isRawData
    ? `Convert the following content into ${cardCount} flashcards.\n\n---\n${trimmed}\n---\n\n${cardTypeInstructions}\n\n${formatInstructions}\n\nOutput ONLY the data in the specified format.`
    : `Create ${cardCount} flashcards on: ${trimmed || '[topic]'}\n\n${cardTypeInstructions}\n\n${formatInstructions}\n\nOutput ONLY the data in the specified format.`;
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

DECK & TAGS
- Deck name: reflect the dominant topic of the source (e.g. "Logical Connectors", "Enzyme Kinetics", "Wikipedia Vocab"). Use "Vocab" only if the source has no clear theme.
- Tags: short topical tags drawn from the clusters (e.g. transition, academic, biology). Items in the same cluster share a tag.

VOLUME
- Target up to ${cardCount} cards total. If the cleaned source has fewer learnable items, return fewer cards rather than padding with junk. Better 30 sharp cards than 60 with filler.

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
