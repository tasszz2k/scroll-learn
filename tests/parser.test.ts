import { describe, it, expect } from 'vitest';
import { normalizeText, parseSimpleLine, parseSimpleFormat, parseCSV, parseJSON } from '../src/common/parser';

describe('normalizeText', () => {
  it('should remove punctuation by default', () => {
    expect(normalizeText('Hello, World!')).toBe('hello world');
    expect(normalizeText('What is 2+2?')).toBe('what is 2+2');
  });

  it('should convert to lowercase when enabled', () => {
    expect(normalizeText('HELLO WORLD', '', true)).toBe('hello world');
    expect(normalizeText('MixedCase', '', true)).toBe('mixedcase');
  });

  it('should preserve case when lowercase is disabled', () => {
    expect(normalizeText('HELLO WORLD', '', false)).toBe('HELLO WORLD');
  });

  it('should collapse whitespace', () => {
    expect(normalizeText('hello    world')).toBe('hello world');
    expect(normalizeText('  hello  world  ')).toBe('hello world');
    expect(normalizeText('hello\n\tworld')).toBe('hello world');
  });

  it('should apply NFKC normalization', () => {
    // Full-width characters should be normalized
    expect(normalizeText('hello')).toBe('hello');
  });

  it('should handle custom eliminate characters', () => {
    expect(normalizeText('hello-world', '-')).toBe('helloworld');
    expect(normalizeText('a@b#c', '@#')).toBe('abc');
  });

  it('should handle empty strings', () => {
    expect(normalizeText('')).toBe('');
    expect(normalizeText('   ')).toBe('');
  });

  it('should handle special characters', () => {
    expect(normalizeText("It's a test (really)")).toBe('its a test really');
    expect(normalizeText('"quoted"')).toBe('quoted');
  });
});

describe('parseSimpleLine', () => {
  it('should parse basic question|answer format', () => {
    const result = parseSimpleLine('What is 2+2?|4');
    expect(result).not.toBeNull();
    expect(result?.front).toBe('What is 2+2?');
    expect(result?.back).toBe('4');
    expect(result?.kind).toBe('text');
  });

  it('should parse MCQ with multiple options', () => {
    const result = parseSimpleLine('Capital of France?|Paris|London|Berlin|Madrid');
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('mcq-single');
    expect(result?.options).toEqual(['Paris', 'London', 'Berlin', 'Madrid']);
    expect(result?.correct).toBe(0);
  });

  it('should handle custom separator', () => {
    const result = parseSimpleLine('Question;Answer', ';');
    expect(result).not.toBeNull();
    expect(result?.front).toBe('Question');
    expect(result?.back).toBe('Answer');
  });

  it('should extract deck prefix', () => {
    const result = parseSimpleLine('[deck:Spanish]Hola|Hello');
    expect(result).not.toBeNull();
    expect(result?.deckName).toBe('Spanish');
    expect(result?.front).toBe('Hola');
    expect(result?.back).toBe('Hello');
  });

  it('should detect cloze format', () => {
    const result = parseSimpleLine('The capital of France is {{Paris}}|Paris');
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('cloze');
    expect(result?.canonicalAnswers).toContain('paris');
  });

  it('should return null for invalid lines', () => {
    expect(parseSimpleLine('')).toBeNull();
    expect(parseSimpleLine('only question')).toBeNull();
    expect(parseSimpleLine('   ')).toBeNull();
  });

  it('should trim whitespace', () => {
    const result = parseSimpleLine('  Question  |  Answer  ');
    expect(result).not.toBeNull();
    expect(result?.front).toBe('Question');
    expect(result?.back).toBe('Answer');
  });
});

describe('parseSimpleFormat', () => {
  it('should parse multiple lines', () => {
    const input = `
      Question 1|Answer 1
      Question 2|Answer 2
      Question 3|Answer 3
    `;
    const result = parseSimpleFormat(input);
    expect(result.cards).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should skip empty lines and comments', () => {
    const input = `
      # This is a comment
      Question|Answer
      
      // Another comment
      Question 2|Answer 2
    `;
    const result = parseSimpleFormat(input);
    expect(result.cards).toHaveLength(2);
  });

  it('should collect errors for invalid lines', () => {
    const input = `
      Valid|Answer
      Invalid line without separator
      Another Valid|Answer
    `;
    const result = parseSimpleFormat(input);
    expect(result.cards).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(3);
  });
});

describe('parseCSV', () => {
  it('should parse basic CSV', () => {
    const input = `front,back,kind
What is 2+2?,4,text
Capital of France?,Paris,text`;
    
    const result = parseCSV(input);
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0].front).toBe('What is 2+2?');
    expect(result.cards[0].back).toBe('4');
    expect(result.cards[0].kind).toBe('text');
  });

  it('should handle quoted values with commas', () => {
    const input = `front,back
"Hello, World",Greeting`;
    
    const result = parseCSV(input);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].front).toBe('Hello, World');
  });

  it('should parse MCQ options', () => {
    const input = `front,back,kind,options,correct
What is red?,Color,mcq-single,Red|Blue|Green,0`;
    
    const result = parseCSV(input);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].options).toEqual(['Red', 'Blue', 'Green']);
    expect(result.cards[0].correct).toBe(0);
  });

  it('should error on missing required columns', () => {
    const input = `question,answer
Test,Answer`;
    
    const result = parseCSV(input);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('Missing required column');
  });

  it('should handle empty input', () => {
    const result = parseCSV('');
    expect(result.cards).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});

describe('parseJSON', () => {
  it('should parse valid JSON array', () => {
    const input = JSON.stringify([
      { front: 'Question 1', back: 'Answer 1', kind: 'text' },
      { front: 'Question 2', back: 'Answer 2', kind: 'text' },
    ]);
    
    const result = parseJSON(input);
    expect(result.cards).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle MCQ cards', () => {
    const input = JSON.stringify([
      {
        front: 'Pick the color',
        back: 'Red',
        kind: 'mcq-single',
        options: ['Red', 'Blue', 'Green'],
        correct: 0,
      },
    ]);
    
    const result = parseJSON(input);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].kind).toBe('mcq-single');
    expect(result.cards[0].options).toEqual(['Red', 'Blue', 'Green']);
  });

  it('should default to text kind', () => {
    const input = JSON.stringify([
      { front: 'Question', back: 'Answer' },
    ]);
    
    const result = parseJSON(input);
    expect(result.cards[0].kind).toBe('text');
  });

  it('should error on non-array input', () => {
    const input = JSON.stringify({ front: 'Q', back: 'A' });
    
    const result = parseJSON(input);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('array');
  });

  it('should error on invalid JSON', () => {
    const result = parseJSON('not valid json');
    expect(result.errors).toHaveLength(1);
  });

  it('should error on cards missing front/back', () => {
    const input = JSON.stringify([
      { front: 'Question only' },
      { back: 'Answer only' },
    ]);
    
    const result = parseJSON(input);
    expect(result.cards).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
  });
});

