import { useState, useRef } from 'react';
import type { Deck, Card, ParsedCard, Response } from '../../common/types';
import { parseSimpleFormat, parseCSV, parseJSON } from '../../common/parser';

type ImportFormat = 'simple' | 'csv' | 'json';
type PromptOutputFormat = 'simple' | 'csv' | 'json';
type CardTypeOption = 'text' | 'mcq-single' | 'mixed';

interface ImportPanelProps {
  decks: Deck[];
  onImport: (cards: Card[], deckId: string) => Promise<Response<{ inserted: number }>>;
  onCreateDeck: (deck: Omit<Deck, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Response<Deck>>;
}

export default function ImportPanel({ decks, onImport, onCreateDeck }: ImportPanelProps) {
  const [format, setFormat] = useState<ImportFormat>('csv');
  const [content, setContent] = useState('');
  const [separator, setSeparator] = useState('|');
  const [selectedDeck, setSelectedDeck] = useState<string>(decks[0]?.id || '');
  const [newDeckName, setNewDeckName] = useState('');
  const [createNewDeck, setCreateNewDeck] = useState(decks.length === 0);
  const [parsedCards, setParsedCards] = useState<ParsedCard[]>([]);
  const [errors, setErrors] = useState<Array<{ line: number; message: string; raw: string }>>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; count: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAllCards, setShowAllCards] = useState(false);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);

  // Prompt Generator State
  const [showPromptGenerator, setShowPromptGenerator] = useState(false);
  const [promptInput, setPromptInput] = useState('');
  const [promptCardCount, setPromptCardCount] = useState(20);
  const [promptOutputFormat, setPromptOutputFormat] = useState<PromptOutputFormat>('csv');
  const [promptCardType, setPromptCardType] = useState<CardTypeOption>('mixed');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  function generatePrompt() {
    const cardTypeInstructions = 
      promptCardType === 'text' 
        ? 'Generate only text-based question and answer pairs.'
        : promptCardType === 'mcq-single'
          ? 'Generate multiple choice questions with 4 options each. The first option after the question should be the correct answer.'
          : 'Generate a mix of text-based Q&A and multiple choice questions.';

    let formatInstructions: string;
    
    if (promptOutputFormat === 'csv') {
      formatInstructions = `Use this CSV format with headers:
deck,kind,front,back,options,correct,tags

Column descriptions:
- deck: Deck name (use the topic name)
- kind: "text" for open answer, "mcq-single" for multiple choice
- front: The question
- back: The correct answer text (REQUIRED for all card types)
- options: For MCQ only - pipe-separated options like "CorrectAnswer|Wrong1|Wrong2|Wrong3" (correct answer MUST be included in options)
- correct: For MCQ only - 0-based index of correct option in the options list
- tags: Optional tags separated by pipe |

IMPORTANT RULES:
1. The "back" column must ALWAYS contain the correct answer text
2. For MCQ, the correct answer in "back" must also appear in "options"
3. The "correct" index must match where the correct answer appears in options (0-based)
4. Use pipe | to separate options, not commas
5. Use pipe | to separate multiple tags, not commas

Example CSV output:
deck,kind,front,back,options,correct,tags
Geography,text,What is the capital of France?,Paris,,,europe
Geography,text,What is the largest ocean?,Pacific Ocean,,,geography
Programming,mcq-single,Which language is used for web styling?,CSS,CSS|HTML|Python|Java,0,web|frontend
Programming,mcq-single,What does HTTP stand for?,HyperText Transfer Protocol,HyperText Transfer Protocol|High Tech Protocol|Home Tool Protocol|Hyper Tool Program,0,web`;
    } else if (promptOutputFormat === 'simple') {
      formatInstructions = `Use this simple format (one card per line, pipe-separated):
Question|Answer

For multiple choice questions, use:
Question|CorrectAnswer|WrongOption1|WrongOption2|WrongOption3

Example output:
What is the capital of France?|Paris
What color is the sky?|Blue
Which planet is closest to the Sun?|Mercury|Venus|Mars|Jupiter`;
    } else {
      formatInstructions = `Use this JSON format:
[
  {
    "front": "Question text here",
    "back": "Answer text here",
    "kind": "text"
  },
  {
    "front": "Multiple choice question?",
    "back": "Correct Answer",
    "kind": "mcq-single",
    "options": ["Correct Answer", "Wrong 1", "Wrong 2", "Wrong 3"],
    "correct": 0
  }
]

For "kind", use: "text" for open answer, "mcq-single" for multiple choice.
For MCQ, "correct" is the 0-based index of the correct option.`;
    }

    const userContent = promptInput.trim();
    const isRawData = userContent.length > 200 || userContent.includes('\n');

    let prompt: string;

    if (isRawData) {
      prompt = `I have the following content that I want to convert into flashcards for studying:

---
${userContent}
---

Please create ${promptCardCount} flashcard${promptCardCount > 1 ? 's' : ''} from this content.

${cardTypeInstructions}

${formatInstructions}

Important:
- Extract key facts, definitions, and concepts
- Make questions clear and specific
- Keep answers concise but complete
- Vary the difficulty level
- Output ONLY the flashcard data in the specified format, no explanations`;
    } else {
      prompt = `I want to learn about: ${userContent || '[Your topic here]'}

Please create ${promptCardCount} flashcard${promptCardCount > 1 ? 's' : ''} to help me study this topic.

${cardTypeInstructions}

${formatInstructions}

Important:
- Cover fundamental concepts to advanced topics
- Include definitions, key facts, and practical applications
- Make questions clear and specific  
- Keep answers concise but complete
- Vary the difficulty level
- Output ONLY the flashcard data in the specified format, no explanations`;
    }

    setGeneratedPrompt(prompt);
    setPromptCopied(false);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }

  const formatOptions: { value: ImportFormat; label: string; description: string }[] = [
    { 
      value: 'simple', 
      label: 'Simple', 
      description: 'One card per line: question|answer' 
    },
    { 
      value: 'csv', 
      label: 'CSV', 
      description: 'Spreadsheet format with headers' 
    },
    { 
      value: 'json', 
      label: 'JSON', 
      description: 'Array of card objects' 
    },
  ];

  function handleParse() {
    let result;
    
    switch (format) {
      case 'simple':
        result = parseSimpleFormat(content, separator);
        break;
      case 'csv':
        result = parseCSV(content);
        break;
      case 'json':
        result = parseJSON(content);
        break;
    }
    
    setParsedCards(result.cards);
    setErrors(result.errors);
    setImportResult(null);
    setShowAllCards(false);
    setSelectedCardIndex(null);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setContent(text);
      
      // Auto-detect format
      if (file.name.endsWith('.json')) {
        setFormat('json');
      } else if (file.name.endsWith('.csv')) {
        setFormat('csv');
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (parsedCards.length === 0) return;
    
    setImporting(true);
    setImportResult(null);
    
    try {
      let targetDeckId = selectedDeck;
      
      // Create new deck if needed
      if (createNewDeck && newDeckName.trim()) {
        const result = await onCreateDeck({
          name: newDeckName.trim(),
          description: `Imported ${parsedCards.length} cards`,
        });
        
        if (result.ok && result.data) {
          targetDeckId = result.data.id;
        } else {
          throw new Error('Failed to create deck');
        }
      }
      
      if (!targetDeckId) {
        throw new Error('No deck selected');
      }
      
      // Convert parsed cards to full cards
      const cardsToImport = parsedCards.map(pc => ({
        deckId: targetDeckId,
        kind: pc.kind,
        front: pc.front,
        back: pc.back,
        options: pc.options,
        correct: pc.correct,
        canonicalAnswers: pc.canonicalAnswers,
        mediaUrl: pc.mediaUrl,
        tags: pc.tags,
      })) as unknown as Card[];
      
      const result = await onImport(cardsToImport, targetDeckId);
      
      if (result.ok) {
        setImportResult({ success: true, count: result.data?.inserted || parsedCards.length });
        setParsedCards([]);
        setContent('');
      } else {
        throw new Error('Import failed');
      }
    } catch (error) {
      setImportResult({ success: false, count: 0 });
      console.error('Import error:', error);
    } finally {
      setImporting(false);
    }
  }

  function clearAll() {
    setContent('');
    setParsedCards([]);
    setErrors([]);
    setImportResult(null);
    setShowAllCards(false);
    setSelectedCardIndex(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Import Cards</h2>
        <p className="text-surface-500 mt-1">Import flashcards from Quizlet, CSV, or JSON</p>
      </div>

      {/* AI Prompt Generator */}
      <div className="rounded-xl border border-surface-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900 overflow-hidden">
        <button
          onClick={() => setShowPromptGenerator(!showPromptGenerator)}
          className="w-full flex items-center justify-between p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
              </svg>
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-surface-900 dark:text-surface-50">AI Prompt Generator</h3>
              <p className="text-sm text-surface-500">Generate a prompt for ChatGPT to create flashcards</p>
            </div>
          </div>
          <svg
            className={`w-5 h-5 text-surface-400 transition-transform ${showPromptGenerator ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
          </svg>
        </button>

        {showPromptGenerator && (
          <div className="border-t border-surface-200 dark:border-surface-700 p-6 space-y-5">
            {/* Input Section */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                What do you want to learn? (or paste raw content)
              </label>
              <textarea
                className="w-full rounded-lg border border-surface-300 bg-white px-4 py-3 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 min-h-[120px] resize-y"
                value={promptInput}
                onChange={e => setPromptInput(e.target.value)}
                placeholder="Examples:
- JavaScript async/await patterns
- Spanish vocabulary for travel
- World War II major events
- Or paste your study notes, textbook content, etc..."
              />
            </div>

            {/* Options Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Number of Cards
                </label>
                <select
                  className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                  value={promptCardCount}
                  onChange={e => setPromptCardCount(parseInt(e.target.value))}
                >
                  <option value={10}>10 cards</option>
                  <option value={20}>20 cards</option>
                  <option value={30}>30 cards</option>
                  <option value={50}>50 cards</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Card Type
                </label>
                <select
                  className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                  value={promptCardType}
                  onChange={e => setPromptCardType(e.target.value as CardTypeOption)}
                >
                  <option value="mixed">Mixed (Q&A + MCQ)</option>
                  <option value="text">Text Only (Q&A)</option>
                  <option value="mcq-single">MCQ Only</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Output Format
                </label>
                <select
                  className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                  value={promptOutputFormat}
                  onChange={e => setPromptOutputFormat(e.target.value as PromptOutputFormat)}
                >
                  <option value="csv">CSV (recommended)</option>
                  <option value="simple">Simple (pipe-separated)</option>
                  <option value="json">JSON</option>
                </select>
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={generatePrompt}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 focus:ring-purple-500"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
              </svg>
              Generate Prompt
            </button>

            {/* Generated Prompt */}
            {generatedPrompt && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300">
                    Generated Prompt
                  </label>
                  <button
                    onClick={copyPrompt}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      promptCopied
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600'
                    }`}
                  >
                    {promptCopied ? (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                        Copy
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  className="w-full rounded-lg border border-surface-300 bg-surface-50 px-4 py-3 text-sm font-mono text-surface-700 dark:border-surface-700 dark:bg-surface-800/50 dark:text-surface-300 min-h-[200px] resize-y"
                  value={generatedPrompt}
                  readOnly
                />
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                  </svg>
                  <div className="text-sm text-blue-700 dark:text-blue-300">
                    <strong>Next steps:</strong>
                    <ol className="list-decimal ml-4 mt-1 space-y-1">
                      <li>Copy the prompt above</li>
                      <li>Open <a href="https://chat.openai.com" target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">ChatGPT</a> or your preferred AI</li>
                      <li>Paste the prompt and get the flashcard data</li>
                      <li>Paste the AI response in the Card Data section below</li>
                    </ol>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Format Selection */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Import Format</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {formatOptions.map(option => (
            <button
              key={option.value}
              onClick={() => setFormat(option.value)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                format === option.value
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
              }`}
            >
              <div className={`font-medium ${format === option.value ? 'text-primary-600 dark:text-primary-400' : 'text-surface-900 dark:text-surface-100'}`}>
                {option.label}
              </div>
              <div className="text-sm text-surface-500 mt-1">{option.description}</div>
            </button>
          ))}
        </div>
        
        {format === 'simple' && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Separator Character</label>
            <input
              type="text"
              className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 w-20"
              value={separator}
              onChange={e => setSeparator(e.target.value || '|')}
              maxLength={1}
            />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-surface-900 dark:text-surface-50">Card Data</h3>
          <div className="flex gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".txt,.csv,.json"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-surface-200 text-surface-900 hover:bg-surface-300 focus:ring-surface-400 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600 text-sm"
            >
              Upload File
            </button>
            {content && (
              <button onClick={clearAll} className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-transparent hover:bg-surface-100 dark:hover:bg-surface-800 text-sm">
                Clear
              </button>
            )}
          </div>
        </div>
        
        <textarea
          className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 min-h-[200px] font-mono text-sm resize-y"
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={
            format === 'simple'
              ? `Question 1|Answer 1\nQuestion 2|Answer 2\n[deck:Spanish]Hola|Hello\nWhat is 2+2?|4|3|5|6`
              : format === 'csv'
                ? `deck,kind,front,back,options,correct,tags\nMath,text,What is 2+2?,4,,,basics\nMath,mcq-single,What is 3+3?,6,6|7|8|9,0,basics|arithmetic`
                : `[\n  { "front": "What is 2+2?", "back": "4", "kind": "text" },\n  { "front": "What is 3+3?", "back": "6", "kind": "mcq-single", "options": ["6", "7", "8", "9"], "correct": 0 }\n]`
          }
        />
        
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-surface-500">
            {content.split('\n').filter(l => l.trim()).length} lines
          </div>
          <button
            onClick={handleParse}
            disabled={!content.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500"
          >
            Parse Cards
          </button>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <h3 className="font-semibold text-red-700 dark:text-red-300 mb-2">
            {errors.length} Error{errors.length > 1 ? 's' : ''} Found
          </h3>
          <div className="space-y-2 text-sm">
            {errors.slice(0, 5).map((error, index) => (
              <div key={index} className="text-red-600 dark:text-red-400">
                <span className="font-medium">Line {error.line}:</span> {error.message}
                {error.raw && (
                  <span className="text-red-500/70 ml-2 truncate">({error.raw.slice(0, 30)}...)</span>
                )}
              </div>
            ))}
            {errors.length > 5 && (
              <div className="text-red-500">...and {errors.length - 5} more errors</div>
            )}
          </div>
        </div>
      )}

      {/* Preview */}
      {parsedCards.length > 0 && (
        <div className="rounded-xl border border-surface-200 bg-white shadow-sm dark:border-surface-800 dark:bg-surface-900 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-primary-600 dark:text-primary-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-surface-900 dark:text-surface-50">
                  Preview
                </h3>
                <p className="text-sm text-surface-500">{parsedCards.length} cards parsed successfully</p>
              </div>
            </div>
            {parsedCards.length > 5 && (
              <button
                onClick={() => setShowAllCards(!showAllCards)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-surface-100 text-surface-700 hover:bg-surface-200 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600 transition-colors"
              >
                {showAllCards ? (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
                    </svg>
                    Show Less
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
                    </svg>
                    Show All ({parsedCards.length})
                  </>
                )}
              </button>
            )}
          </div>
          
          <div className="divide-y divide-surface-100 dark:divide-surface-800 max-h-[600px] overflow-y-auto">
            {(showAllCards ? parsedCards : parsedCards.slice(0, 5)).map((card, index) => (
              <div
                key={index}
                onClick={() => setSelectedCardIndex(selectedCardIndex === index ? null : index)}
                className={`p-4 cursor-pointer transition-colors hover:bg-surface-50 dark:hover:bg-surface-800/50 ${
                  selectedCardIndex === index ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Row number */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-100 dark:bg-surface-700 flex items-center justify-center text-sm font-medium text-surface-500">
                    {index + 1}
                  </div>
                  
                  {/* Card content */}
                  <div className="flex-1 min-w-0 space-y-3">
                    {/* Header row with type and tags */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        card.kind === 'mcq-single' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                        card.kind === 'mcq-multi' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
                        card.kind === 'text' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                        card.kind === 'cloze' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
                        'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300'
                      }`}>
                        {card.kind}
                      </span>
                      {card.deckName && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-400">
                          {card.deckName}
                        </span>
                      )}
                      {card.tags && card.tags.length > 0 && card.tags.slice(0, 3).map((tag, i) => (
                        <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          {tag}
                        </span>
                      ))}
                      {card.tags && card.tags.length > 3 && (
                        <span className="text-xs text-surface-400">+{card.tags.length - 3} more</span>
                      )}
                    </div>
                    
                    {/* Question - Always show full */}
                    <div className="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-6 h-6 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-400 flex items-center justify-center text-xs font-bold">
                          Q
                        </span>
                        <p className="text-sm text-surface-900 dark:text-surface-100 leading-relaxed">
                          {card.front}
                        </p>
                      </div>
                    </div>
                    
                    {/* Answer - Always show full */}
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <span className="flex-shrink-0 w-6 h-6 rounded bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400 flex items-center justify-center text-xs font-bold">
                          A
                        </span>
                        <p className="text-sm text-green-800 dark:text-green-200 leading-relaxed">
                          {card.back}
                        </p>
                      </div>
                    </div>
                    
                    {/* MCQ Options - Show when expanded or always for MCQ */}
                    {card.options && card.options.length > 0 && (
                      <div className={`${selectedCardIndex === index ? '' : 'hidden'} mt-2 pt-3 border-t border-surface-200 dark:border-surface-700`}>
                        <p className="text-xs font-medium text-surface-400 uppercase tracking-wide mb-2">All Options:</p>
                        <div className="grid gap-1.5">
                          {card.options.map((option, optIndex) => (
                            <div
                              key={optIndex}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                                (typeof card.correct === 'number' && card.correct === optIndex) ||
                                (Array.isArray(card.correct) && card.correct.includes(optIndex))
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 ring-1 ring-green-300 dark:ring-green-700'
                                  : 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300'
                              }`}
                            >
                              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white dark:bg-surface-600 flex items-center justify-center text-xs font-medium">
                                {String.fromCharCode(65 + optIndex)}
                              </span>
                              <span>{option}</span>
                              {((typeof card.correct === 'number' && card.correct === optIndex) ||
                                (Array.isArray(card.correct) && card.correct.includes(optIndex))) && (
                                <svg className="w-4 h-4 ml-auto text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                                </svg>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Expand indicator - only show for MCQ cards */}
                  {card.options && card.options.length > 0 && (
                    <div className="flex-shrink-0">
                      <svg
                        className={`w-5 h-5 text-surface-400 transition-transform ${selectedCardIndex === index ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {!showAllCards && parsedCards.length > 5 && (
            <div className="p-4 border-t border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 text-center">
              <button
                onClick={() => setShowAllCards(true)}
                className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
              >
                View all {parsedCards.length} cards
              </button>
            </div>
          )}
        </div>
      )}

      {/* Destination Deck */}
      {parsedCards.length > 0 && (
        <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Destination Deck</h3>
          
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!createNewDeck}
                  onChange={() => setCreateNewDeck(false)}
                  className="w-4 h-4 text-primary-600"
                  disabled={decks.length === 0}
                />
                <span className={decks.length === 0 ? 'text-surface-400' : ''}>Existing Deck</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={createNewDeck}
                  onChange={() => setCreateNewDeck(true)}
                  className="w-4 h-4 text-primary-600"
                />
                <span>Create New Deck</span>
              </label>
            </div>
            
            {createNewDeck ? (
              <input
                type="text"
                className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                value={newDeckName}
                onChange={e => setNewDeckName(e.target.value)}
                placeholder="New deck name"
              />
            ) : (
              <select
                className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
                value={selectedDeck}
                onChange={e => setSelectedDeck(e.target.value)}
                disabled={decks.length === 0}
              >
                {decks.length === 0 ? (
                  <option value="">No decks available</option>
                ) : (
                  decks.map(deck => (
                    <option key={deck.id} value={deck.id}>{deck.name}</option>
                  ))
                )}
              </select>
            )}
          </div>

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-surface-200 dark:border-surface-700">
            <div className="text-sm text-surface-500">
              {parsedCards.length} cards ready to import
            </div>
            <button
              onClick={handleImport}
              disabled={importing || (createNewDeck ? !newDeckName.trim() : !selectedDeck)}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500"
            >
              {importing ? 'Importing...' : 'Import Cards'}
            </button>
          </div>
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div className={`card ${
          importResult.success 
            ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
            : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20'
        }`}>
          {importResult.success ? (
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-green-600 dark:text-green-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
              <span className="text-green-700 dark:text-green-300 font-medium">
                Successfully imported {importResult.count} cards!
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
              </svg>
              <span className="text-red-700 dark:text-red-300 font-medium">
                Import failed. Please try again.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Help */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900 bg-surface-50 dark:bg-surface-800/50">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-3">Format Help</h3>
        <div className="grid gap-4 text-sm">
          <div>
            <h4 className="font-medium text-surface-700 dark:text-surface-300">Simple Format</h4>
            <p className="text-surface-500 mt-1">
              One card per line. Use separator (default: |) between question and answer.
              <br />
              For MCQ, add more options: <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">Question|Correct|Wrong1|Wrong2</code>
              <br />
              Add deck prefix: <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">[deck:MyDeck]Question|Answer</code>
            </p>
          </div>
          <div>
            <h4 className="font-medium text-surface-700 dark:text-surface-300">CSV Format</h4>
            <div className="text-surface-500 mt-1 space-y-2">
              <p>
                Headers: <code className="bg-surface-200 dark:bg-surface-700 px-1 rounded">deck,kind,front,back,options,correct,tags</code>
              </p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><strong>front</strong>: The question (also accepts: question, q, prompt)</li>
                <li><strong>back</strong>: The answer - REQUIRED for all cards (also accepts: answer, a, response)</li>
                <li><strong>kind</strong>: text, mcq-single, mcq-multi, cloze, audio (also accepts: type)</li>
                <li><strong>options</strong>: For MCQ - pipe-separated like <code className="bg-surface-200 dark:bg-surface-700 px-0.5 rounded">A|B|C|D</code></li>
                <li><strong>correct</strong>: For MCQ - 0-based index of correct option</li>
                <li><strong>tags</strong>: Use pipe | to separate multiple tags</li>
              </ul>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Note: For MCQ, the correct answer must be in both "back" AND included in "options"
              </p>
            </div>
          </div>
          <div>
            <h4 className="font-medium text-surface-700 dark:text-surface-300">JSON Format</h4>
            <p className="text-surface-500 mt-1">
              Array of card objects with front, back, kind, options (array), correct (index).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
