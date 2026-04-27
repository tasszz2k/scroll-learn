import { useState, useEffect } from 'react';

export type PromptOutputFormat = 'simple' | 'csv' | 'json';
export type CardTypeOption = 'text' | 'mcq-single' | 'mixed';
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
    return `Use CSV with headers: deck,kind,front,back,options,correct,tags. For MCQ, use pipe-separated options and 0-based correct index.`;
  }
  if (format === 'simple') {
    return `Use simple format, one card per line:\nQuestion|Answer\nFor MCQ: Question|CorrectAnswer|Wrong1|Wrong2|Wrong3`;
  }
  return `Use JSON: [{ "front": "...", "back": "...", "kind": "text" }, ...]`;
}

function buildGeneralPrompt(
  userContent: string,
  cardCount: number,
  outputFormat: PromptOutputFormat,
  cardType: CardTypeOption,
): string {
  const cardTypeInstructions =
    cardType === 'text'
      ? 'Generate only text-based question and answer pairs.'
      : cardType === 'mcq-single'
        ? 'Generate multiple choice questions with 4 options each. The first option after the question should be the correct answer.'
        : 'Generate a mix of text-based Q&A and multiple choice questions.';
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
  const [src, tgt] = direction === 'en->vi'
    ? ['English', 'Vietnamese']
    : ['Vietnamese', 'English'];
  const cardTypeInstructions =
    cardType === 'text'
      ? `Generate ONLY text translation cards: front = ${src}, back = ${tgt}.`
      : cardType === 'mcq-single'
        ? `Generate ONLY multiple-choice cards: question shows a ${src} word/phrase, options are 4 ${tgt} candidates with one correct.`
        : `Mix ~70% text translation cards (front = ${src}, back = ${tgt}) and ~30% multiple-choice cards (question = ${src} item, 4 ${tgt} options).`;
  const formatInstructions = formatInstructionsFor(outputFormat);
  return `You are creating ${tgt}-learning flashcards from notes a learner highlighted while reading ${src} content on the web.

LEARNER LEVEL (CEFR): ${CEFR_DESCRIPTIONS[englishLevel]}
Tailor BOTH the chosen vocabulary and the wording of translations / distractors to this level. Skip items that are clearly far below the learner's level (already trivially known) or far above (rare jargon they cannot use yet) unless they are central to the source.

Source notes (one item per line, possibly noisy):
---
${userContent.trim()}
---

CLEANING (do this BEFORE writing any cards):
1. Deduplicate exact and near-duplicate items (case-insensitive). If "meanwhile" appears 3 times, keep ONE.
2. Drop UI / site-chrome noise such as: "Main menu", "View history", "View source", "Donate", "Create account", "Log in", "Talk", "active", lone "Welcome", "From today's featured article", search/login labels, navigation breadcrumbs, button text. Anything that is clearly site UI rather than reading content.
3. Drop fragments that are pure punctuation, lone numbers, or single function words with no learning value (e.g. "the", "of", "a").
4. Keep meaningful vocabulary, idioms, collocations, transitional phrases (e.g. "meanwhile", "thus", "likewise", "due to"), and full sentences worth translating.

CONNECT THE DOTS (treat the whole list as ONE coherent reading session, not isolated lines):
1. Read the entire source first and form a mental model of the topic(s) and register before writing any card.
2. Cluster related items: synonyms / near-synonyms (e.g. "meanwhile" + "likewise" + "thus" are all logical-flow connectors), items from the same domain (e.g. anything about enzyme kinetics), collocations and their head nouns, etc.
3. Prefer cards that REUSE context from the source. When a word appears in a sentence in the notes, base the example on that sentence rather than inventing a generic one. When a paragraph defines a concept, build cards that draw on the paragraph's own framing.
4. Build at least a few cards that contrast or relate clustered items: "Which of these means 'as a result'?" with thus / meanwhile / likewise / undoubtedly as options; or "Pick the sentence where 'meanwhile' fits best" using shapes of the captured sentences. These contrast/usage cards are more valuable than four separate isolated translations of near-synonyms.
5. For long passages (e.g. the Enzyme kinetics paragraph), produce ONE full-sentence translation card AND 2-4 vocabulary cards drawn from that same passage, plus optionally a comprehension MCQ ("According to the passage, what does enzyme kinetics study?"). The vocabulary cards should reference the passage's usage in their hint or tag, so the learner sees the items as connected, not floating words.
6. Order the output by topic cluster, not by source line order. Cards in the same cluster should be adjacent.

CARD GENERATION:
- Target up to ${cardCount} cards. If the cleaned source has fewer learnable items, return fewer cards rather than padding with junk.
- Front = ${src} item as a learner would encounter it (favour the form found in the source over a dictionary headword when they differ). Back = concise, natural ${tgt} translation. If the ${src} item has multiple senses, pick the sense that fits the captured context, and include a brief usage hint or example sentence drawn from the source.
- ${cardTypeInstructions}
- For MCQ distractors: prefer pulling distractors from OTHER items in the same cluster within this source (e.g. when testing "meanwhile", use "thus" / "likewise" / "undoubtedly" as distractors). This forces the learner to disambiguate items they actually saw together. Fall back to invented plausible distractors only when the cluster is too small.
- Use a deck name that reflects the dominant topic of the source (e.g. "Logical Connectors", "Enzyme Kinetics", "Wikipedia Vocab"); use "Vocab" only if the source has no clear theme.
- Tags: short topical tags drawn from the clusters you identified (e.g. "transition", "academic", "biology"). Items in the same cluster should share a tag.

OUTPUT FORMAT:
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
