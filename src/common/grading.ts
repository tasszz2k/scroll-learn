import type { Card, Grade, FuzzyThresholds } from './types';
import { DEFAULT_SETTINGS } from './types';
import { similarity } from './fuzzy';
import { normalizeText } from './parser';

/**
 * Grade an answer based on the card type and user response
 * Returns a grade from 0-3:
 * - 0 = Again/Fail
 * - 1 = Hard
 * - 2 = Good
 * - 3 = Easy/Perfect
 */
export function gradeAnswer(
  card: Card,
  userAnswer: string | number | number[],
  settings: { eliminateChars: string; lowercaseNormalization: boolean; fuzzyThresholds: FuzzyThresholds } = DEFAULT_SETTINGS
): Grade {
  switch (card.kind) {
    case 'mcq-single':
      return gradeMcqSingle(card, userAnswer as number);
    
    case 'mcq-multi':
      return gradeMcqMulti(card, userAnswer as number[]);
    
    case 'text':
      return gradeText(card, userAnswer as string, settings);
    
    case 'cloze':
      return gradeCloze(card, (userAnswer as string).split('|'), settings);
    
    case 'audio':
      return gradeText(card, userAnswer as string, settings);
    
    default:
      return 0;
  }
}

/**
 * Grade MCQ single choice
 * Exact match = 3, wrong = 0
 */
function gradeMcqSingle(card: Card, selectedIndex: number): Grade {
  const correctIndex = card.correct as number;
  return selectedIndex === correctIndex ? 3 : 0;
}

/**
 * Grade MCQ multiple choice
 * Score based on fraction of correct selections:
 * >= 0.9 = 3, 0.6-0.9 = 2, 0.2-0.6 = 1, < 0.2 = 0
 */
function gradeMcqMulti(card: Card, selectedIndices: number[]): Grade {
  const correctIndices = card.correct as number[];
  if (!correctIndices || correctIndices.length === 0) return 0;
  
  const selectedSet = new Set(selectedIndices);
  const correctSet = new Set(correctIndices);
  
  // Count correct selections (true positives)
  let truePositives = 0;
  for (const idx of selectedIndices) {
    if (correctSet.has(idx)) {
      truePositives++;
    }
  }
  
  // Count missed correct options (false negatives)
  let falseNegatives = 0;
  for (const idx of correctIndices) {
    if (!selectedSet.has(idx)) {
      falseNegatives++;
    }
  }
  
  // Count wrong selections (false positives)
  let falsePositives = 0;
  for (const idx of selectedIndices) {
    if (!correctSet.has(idx)) {
      falsePositives++;
    }
  }
  
  // Calculate F1-like score
  const total = truePositives + falsePositives + falseNegatives;
  if (total === 0) return 3;
  
  const score = truePositives / (truePositives + 0.5 * (falsePositives + falseNegatives));
  
  if (score >= 0.9) return 3;
  if (score >= 0.6) return 2;
  if (score >= 0.2) return 1;
  return 0;
}

/**
 * Grade text answer with fuzzy matching
 */
function gradeText(
  card: Card,
  userAnswer: string,
  settings: { eliminateChars: string; lowercaseNormalization: boolean; fuzzyThresholds: FuzzyThresholds }
): Grade {
  const normalizedInput = normalizeText(
    userAnswer,
    settings.eliminateChars,
    settings.lowercaseNormalization
  );
  
  // Get canonical answers
  const canonicalAnswers = card.canonicalAnswers || [
    normalizeText(card.back, settings.eliminateChars, settings.lowercaseNormalization)
  ];
  
  // Check exact match first
  for (const answer of canonicalAnswers) {
    if (normalizedInput === answer) {
      return 3;
    }
  }
  
  // Check regex match if provided
  if (card.acceptedRegex) {
    try {
      const regex = new RegExp(card.acceptedRegex, 'i');
      if (regex.test(userAnswer) || regex.test(normalizedInput)) {
        return 3;
      }
    } catch {
      // Invalid regex, skip
    }
  }
  
  // Find best fuzzy match
  let bestScore = 0;
  for (const answer of canonicalAnswers) {
    const score = similarity(normalizedInput, answer);
    bestScore = Math.max(bestScore, score);
  }

  // Definition/term cards are strict: exact match only.
  if (isStrictDefinitionCard(card)) {
    return 0;
  }

  // Single-term vocabulary should be strict: typos are not graded as correct.
  const isSingleTermCard = canonicalAnswers.every(answer => isSingleTermAnswer(answer));
  if (isSingleTermCard) {
    if (bestScore >= settings.fuzzyThresholds.low) return 1;
    return 0;
  }
  
  // Map score to grade using thresholds
  const thresholds = settings.fuzzyThresholds;
  
  if (bestScore >= thresholds.high) return 3;
  if (bestScore >= thresholds.medium) return 2;
  if (bestScore >= thresholds.low) return 1;
  return 0;
}

function isSingleTermAnswer(answer: string): boolean {
  return answer.trim().length > 0 && !/\s/.test(answer.trim());
}

function isStrictDefinitionCard(card: Card): boolean {
  const isDefinitionPrompt = card.front.trim().toLowerCase().startsWith('definition:');
  const hasTermTag = (card.tags || []).some(tag => tag.toLowerCase() === 'term');
  return isDefinitionPrompt || hasTermTag;
}

/**
 * Grade cloze (fill-in-the-blank) answer
 * Average score across all blanks
 */
function gradeCloze(
  card: Card,
  userAnswers: string[],
  settings: { eliminateChars: string; lowercaseNormalization: boolean; fuzzyThresholds: FuzzyThresholds }
): Grade {
  const canonicalAnswers = card.canonicalAnswers || [];
  
  if (canonicalAnswers.length === 0 || userAnswers.length === 0) {
    return 0;
  }
  
  // Grade each blank
  const grades: number[] = [];
  
  for (let i = 0; i < Math.max(canonicalAnswers.length, userAnswers.length); i++) {
    const expected = canonicalAnswers[i] || '';
    const actual = userAnswers[i] || '';
    
    const normalizedActual = normalizeText(
      actual,
      settings.eliminateChars,
      settings.lowercaseNormalization
    );
    
    // Exact match
    if (normalizedActual === expected) {
      grades.push(3);
      continue;
    }
    
    // Fuzzy match
    const score = similarity(normalizedActual, expected);
    const thresholds = settings.fuzzyThresholds;
    
    if (score >= thresholds.high) grades.push(3);
    else if (score >= thresholds.medium) grades.push(2);
    else if (score >= thresholds.low) grades.push(1);
    else grades.push(0);
  }
  
  // Average grade
  const avgGrade = grades.reduce((a, b) => a + b, 0) / grades.length;
  
  // Round to nearest valid grade
  if (avgGrade >= 2.5) return 3;
  if (avgGrade >= 1.5) return 2;
  if (avgGrade >= 0.5) return 1;
  return 0;
}

/**
 * Get feedback message for a grade
 */
export function getGradeFeedback(grade: Grade): {
  type: 'success' | 'partial' | 'error';
  message: string;
} {
  switch (grade) {
    case 3:
      return { type: 'success', message: 'Perfect!' };
    case 2:
      return { type: 'success', message: 'Good job!' };
    case 1:
      return { type: 'partial', message: 'Almost there...' };
    case 0:
      return { type: 'error', message: 'Not quite right' };
    default:
      return { type: 'error', message: 'Try again' };
  }
}

/**
 * Get the correct answer(s) for display
 */
export function getCorrectAnswerDisplay(card: Card): string {
  switch (card.kind) {
    case 'mcq-single':
      if (card.options && typeof card.correct === 'number') {
        return card.options[card.correct];
      }
      return card.back;
    
    case 'mcq-multi':
      if (card.options && Array.isArray(card.correct)) {
        return card.correct.map(i => card.options![i]).join(', ');
      }
      return card.back;
    
    case 'text':
    case 'audio':
      return card.back;
    
    case 'cloze':
      if (card.canonicalAnswers) {
        return card.canonicalAnswers.join(', ');
      }
      return card.back;
    
    default:
      return card.back;
  }
}

/**
 * Calculate similarity percentage for UI display
 */
export function getSimilarityPercentage(
  userAnswer: string,
  correctAnswer: string,
  settings: { eliminateChars: string; lowercaseNormalization: boolean } = DEFAULT_SETTINGS
): number {
  const normalizedInput = normalizeText(
    userAnswer,
    settings.eliminateChars,
    settings.lowercaseNormalization
  );
  
  const normalizedCorrect = normalizeText(
    correctAnswer,
    settings.eliminateChars,
    settings.lowercaseNormalization
  );
  
  return Math.round(similarity(normalizedInput, normalizedCorrect) * 100);
}
