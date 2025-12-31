import type { CardKind, ParsedCard, ParseResult, ParseError } from './types';

/**
 * Normalize text for comparison and storage
 * - Apply NFKC normalization
 * - Optionally convert to lowercase
 * - Remove specified characters
 * - Collapse whitespace
 */
export function normalizeText(
  text: string,
  eliminateChars: string = '.,!?()\'"',
  lowercase: boolean = true
): string {
  // Apply NFKC normalization (compatibility decomposition + canonical composition)
  let normalized = text.normalize('NFKC');
  
  // Convert to lowercase if requested
  if (lowercase) {
    normalized = normalized.toLowerCase();
  }
  
  // Remove eliminated characters
  for (const char of eliminateChars) {
    // Escape special regex characters
    const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(new RegExp(escaped, 'g'), '');
  }
  
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

/**
 * Parse a simple Quizlet-like format line
 * Format: [deck:deck-name]Question|Answer1|Answer2...
 * - First part is the question (front)
 * - Second part is the answer (back)
 * - Additional parts become options for MCQ
 */
export function parseSimpleLine(
  line: string,
  separator: string = '|'
): ParsedCard | null {
  if (!line.trim()) return null;
  
  let deckName: string | undefined;
  let content = line.trim();
  
  // Extract deck prefix if present
  const deckMatch = content.match(/^\[deck:([^\]]+)\]/i);
  if (deckMatch) {
    deckName = deckMatch[1].trim();
    content = content.slice(deckMatch[0].length).trim();
  }
  
  // Split by separator
  const parts = content.split(separator).map(p => p.trim()).filter(p => p.length > 0);
  
  if (parts.length < 2) return null;
  
  const front = parts[0];
  const back = parts[1];
  
  // If more than 2 parts, treat as MCQ with options
  if (parts.length > 2) {
    const options = parts.slice(1);
    return {
      front,
      back: options[0], // First answer is the correct one
      kind: 'mcq-single',
      options,
      correct: 0, // First option is correct
      canonicalAnswers: [normalizeText(options[0])],
      deckName,
    };
  }
  
  // Check if it's a cloze card (contains {{...}})
  if (front.includes('{{') && front.includes('}}')) {
    return {
      front,
      back,
      kind: 'cloze',
      canonicalAnswers: extractClozeAnswers(front),
      deckName,
    };
  }
  
  // Default to text card
  return {
    front,
    back,
    kind: 'text',
    canonicalAnswers: [normalizeText(back)],
    deckName,
  };
}

/**
 * Extract answers from cloze format
 * Format: Text with {{answer}} blanks
 */
function extractClozeAnswers(text: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const answers: string[] = [];
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    answers.push(normalizeText(match[1]));
  }
  
  return answers;
}

/**
 * Parse simple format text (multiple lines)
 */
export function parseSimpleFormat(
  content: string,
  separator: string = '|'
): ParseResult {
  const lines = content.split('\n');
  const cards: ParsedCard[] = [];
  const errors: ParseError[] = [];
  
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      return;
    }
    
    const card = parseSimpleLine(trimmed, separator);
    if (card) {
      cards.push(card);
    } else {
      errors.push({
        line: index + 1,
        message: 'Invalid format: expected at least question and answer separated by ' + separator,
        raw: trimmed,
      });
    }
  });
  
  return { cards, errors };
}

/**
 * Parse CSV content
 * Expected columns: deck,kind,front,back,options,correct,fuzziness,mediaUrl,tags
 */
export function parseCSV(content: string): ParseResult {
  const lines = content.split('\n');
  const cards: ParsedCard[] = [];
  const errors: ParseError[] = [];
  
  if (lines.length < 2) {
    return { cards, errors: [{ line: 1, message: 'CSV must have header and at least one data row', raw: '' }] };
  }
  
  // Parse header
  const headerLine = lines[0].trim();
  const headers = parseCSVLine(headerLine);
  
  const columnMap: Record<string, number> = {};
  headers.forEach((h, i) => {
    columnMap[h.toLowerCase().trim()] = i;
  });
  
  // Helper to get value by column name with fallback aliases
  const getColumnIndex = (...names: string[]): number | undefined => {
    for (const name of names) {
      if (columnMap[name] !== undefined) {
        return columnMap[name];
      }
    }
    return undefined;
  };
  
  // Map common column name variations
  const frontIdx = getColumnIndex('front', 'question', 'q', 'prompt', 'term');
  const backIdx = getColumnIndex('back', 'answer', 'a', 'response', 'definition');
  const kindIdx = getColumnIndex('kind', 'type', 'cardtype', 'card_type');
  const optionsIdx = getColumnIndex('options', 'choices', 'answers', 'alternatives');
  const correctIdx = getColumnIndex('correct', 'correct_answer', 'answer_index', 'correctindex', 'right');
  const tagsIdx = getColumnIndex('tags', 'tag', 'categories', 'labels');
  const deckIdx = getColumnIndex('deck', 'deckname', 'deck_name', 'collection');
  const mediaIdx = getColumnIndex('mediaurl', 'media_url', 'media', 'audio', 'image');
  
  // Required columns - 'front' (or alias) is always required
  if (frontIdx === undefined) {
    errors.push({
      line: 1,
      message: 'Missing required column: front (or question/q/prompt/term)',
      raw: headerLine,
    });
    return { cards, errors };
  }
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      const values = parseCSVLine(line);
      
      const getValueByIdx = (idx: number | undefined): string => {
        return idx !== undefined ? (values[idx] || '').trim() : '';
      };
      
      const front = getValueByIdx(frontIdx);
      const back = getValueByIdx(backIdx);
      const kindStr = getValueByIdx(kindIdx) || 'text';
      const kind = validateCardKind(kindStr) ? kindStr : 'text';
      
      const optionsStr = getValueByIdx(optionsIdx);
      const options = optionsStr ? parseOptionsField(optionsStr) : undefined;
      
      const correctStr = getValueByIdx(correctIdx);
      const correct = parseCorrectField(correctStr, kind);
      
      // Validate required fields based on card type
      if (!front) {
        errors.push({
          line: i + 1,
          message: 'Missing front (question) value',
          raw: line,
        });
        continue;
      }
      
      // For MCQ cards, back is optional - derive from options if not provided
      const isMcq = kind === 'mcq-single' || kind === 'mcq-multi';
      let finalBack = back;
      
      if (isMcq) {
        // MCQ cards need options
        if (!options || options.length === 0) {
          errors.push({
            line: i + 1,
            message: 'MCQ cards require options',
            raw: line,
          });
          continue;
        }
        // If back is empty, use the correct option as back
        if (!finalBack && typeof correct === 'number' && options[correct]) {
          finalBack = options[correct];
        } else if (!finalBack && Array.isArray(correct) && correct.length > 0 && options[correct[0]]) {
          finalBack = options[correct[0]];
        } else if (!finalBack) {
          finalBack = options[0]; // Fallback to first option
        }
      } else if (!back) {
        // Text/cloze/audio cards require back
        errors.push({
          line: i + 1,
          message: 'Missing back (answer) value',
          raw: line,
        });
        continue;
      }
      
      const mediaUrl = getValueByIdx(mediaIdx) || undefined;
      const tagsStr = getValueByIdx(tagsIdx);
      // Parse tags - support both comma and pipe separated
      const tags = tagsStr ? tagsStr.split(/[,|]/).map(t => t.trim()).filter(t => t) : undefined;
      const deckName = getValueByIdx(deckIdx) || undefined;
      
      // Build canonical answers
      let canonicalAnswers: string[] | undefined;
      if (kind === 'text' || kind === 'cloze') {
        canonicalAnswers = [normalizeText(finalBack)];
      } else if (kind === 'mcq-single' && options && typeof correct === 'number') {
        canonicalAnswers = [normalizeText(options[correct])];
      } else if (kind === 'mcq-multi' && options && Array.isArray(correct)) {
        canonicalAnswers = correct.map(idx => normalizeText(options[idx] || ''));
      }
      
      cards.push({
        front,
        back: finalBack,
        kind,
        options,
        correct,
        canonicalAnswers,
        mediaUrl,
        tags,
        deckName,
      });
    } catch (e) {
      errors.push({
        line: i + 1,
        message: e instanceof Error ? e.message : 'Parse error',
        raw: line,
      });
    }
  }
  
  return { cards, errors };
}

/**
 * Parse a single CSV line respecting quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else if (char === '"') {
        // End of quoted value
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Parse options field (pipe-separated or JSON array)
 */
function parseOptionsField(value: string): string[] {
  const trimmed = value.trim();
  
  // Try JSON array first
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // Fall through to pipe-separated
    }
  }
  
  // Pipe-separated
  return trimmed.split('|').map(s => s.trim()).filter(s => s);
}

/**
 * Parse correct field (index or array of indices)
 */
function parseCorrectField(value: string, kind: CardKind): number | number[] | undefined {
  if (!value) return undefined;
  
  const trimmed = value.trim();
  
  if (kind === 'mcq-multi') {
    // Multiple correct answers
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(Number);
        }
      } catch {
        // Fall through
      }
    }
    return trimmed.split('|').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  }
  
  // Single correct answer
  const num = parseInt(trimmed, 10);
  return isNaN(num) ? undefined : num;
}

/**
 * Validate card kind
 */
function validateCardKind(kind: string): kind is CardKind {
  return ['mcq-single', 'mcq-multi', 'text', 'cloze', 'audio'].includes(kind);
}

/**
 * Parse JSON content (array of cards)
 */
export function parseJSON(content: string): ParseResult {
  const errors: ParseError[] = [];
  
  try {
    const parsed = JSON.parse(content);
    
    if (!Array.isArray(parsed)) {
      return {
        cards: [],
        errors: [{ line: 1, message: 'JSON must be an array of cards', raw: '' }],
      };
    }
    
    const cards: ParsedCard[] = [];
    
    parsed.forEach((item, index) => {
      if (typeof item !== 'object' || item === null) {
        errors.push({
          line: index + 1,
          message: 'Each card must be an object',
          raw: JSON.stringify(item).slice(0, 100),
        });
        return;
      }
      
      const { front, back, kind, options, correct, canonicalAnswers, mediaUrl, tags, deck, deckName: itemDeckName } = item;
      
      if (!front) {
        errors.push({
          line: index + 1,
          message: 'Card must have a front field',
          raw: JSON.stringify(item).slice(0, 100),
        });
        return;
      }
      
      const validKind = validateCardKind(kind) ? kind : 'text';
      const isMcq = validKind === 'mcq-single' || validKind === 'mcq-multi';
      const parsedOptions = Array.isArray(options) ? options.map(String) : undefined;
      const parsedCorrect = typeof correct === 'number' || Array.isArray(correct) ? correct : undefined;
      
      // Derive back from options for MCQ if not provided
      let finalBack = back ? String(back) : '';
      if (isMcq && !finalBack && parsedOptions && parsedOptions.length > 0) {
        if (typeof parsedCorrect === 'number' && parsedOptions[parsedCorrect]) {
          finalBack = parsedOptions[parsedCorrect];
        } else if (Array.isArray(parsedCorrect) && parsedCorrect.length > 0 && parsedOptions[parsedCorrect[0]]) {
          finalBack = parsedOptions[parsedCorrect[0]];
        } else {
          finalBack = parsedOptions[0];
        }
      }
      
      if (!isMcq && !finalBack) {
        errors.push({
          line: index + 1,
          message: 'Non-MCQ card must have a back field',
          raw: JSON.stringify(item).slice(0, 100),
        });
        return;
      }
      
      // Build canonical answers
      let finalCanonicalAnswers: string[];
      if (Array.isArray(canonicalAnswers)) {
        finalCanonicalAnswers = canonicalAnswers.map(String);
      } else if (validKind === 'mcq-single' && parsedOptions && typeof parsedCorrect === 'number') {
        finalCanonicalAnswers = [normalizeText(parsedOptions[parsedCorrect] || '')];
      } else if (validKind === 'mcq-multi' && parsedOptions && Array.isArray(parsedCorrect)) {
        finalCanonicalAnswers = parsedCorrect.map(idx => normalizeText(parsedOptions[idx] || ''));
      } else {
        finalCanonicalAnswers = [normalizeText(finalBack)];
      }
      
      cards.push({
        front: String(front),
        back: finalBack,
        kind: validKind,
        options: parsedOptions,
        correct: parsedCorrect,
        canonicalAnswers: finalCanonicalAnswers,
        mediaUrl: mediaUrl ? String(mediaUrl) : undefined,
        tags: Array.isArray(tags) ? tags.map(String) : undefined,
        deckName: (deck || itemDeckName) ? String(deck || itemDeckName) : undefined,
      });
    });
    
    return { cards, errors };
  } catch (e) {
    return {
      cards: [],
      errors: [{
        line: 1,
        message: e instanceof Error ? e.message : 'Invalid JSON',
        raw: content.slice(0, 100),
      }],
    };
  }
}

/**
 * Auto-detect format and parse
 */
export function autoDetectAndParse(content: string, separator: string = '|'): ParseResult {
  const trimmed = content.trim();
  
  // Try JSON first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const jsonResult = parseJSON(trimmed);
    if (jsonResult.cards.length > 0 || jsonResult.errors.length === 0) {
      return jsonResult;
    }
  }
  
  // Check if it looks like CSV (has common CSV headers)
  const firstLine = trimmed.split('\n')[0].toLowerCase();
  if (firstLine.includes('front') && firstLine.includes('back')) {
    return parseCSV(trimmed);
  }
  
  // Default to simple format
  return parseSimpleFormat(trimmed, separator);
}

/**
 * Convert parsed card to display format for preview
 */
export function formatCardForPreview(card: ParsedCard): {
  type: string;
  question: string;
  answer: string;
  options?: string;
  deck?: string;
} {
  return {
    type: card.kind,
    question: card.front.length > 50 ? card.front.slice(0, 47) + '...' : card.front,
    answer: card.back.length > 50 ? card.back.slice(0, 47) + '...' : card.back,
    options: card.options?.join(', '),
    deck: card.deckName,
  };
}

