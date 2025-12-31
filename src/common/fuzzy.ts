/**
 * Levenshtein distance and fuzzy matching utilities
 * No external dependencies - pure TypeScript implementation
 */

/**
 * Calculate the Levenshtein (edit) distance between two strings
 * Uses Wagner-Fischer algorithm with O(min(m,n)) space complexity
 */
export function levenshteinDistance(a: string, b: string): number {
  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) {
    [a, b] = [b, a];
  }
  
  const m = a.length;
  const n = b.length;
  
  // Early returns for edge cases
  if (m === 0) return n;
  if (n === 0) return m;
  
  // Use two rows instead of full matrix for space efficiency
  let prevRow = new Array<number>(m + 1);
  let currRow = new Array<number>(m + 1);
  
  // Initialize first row
  for (let i = 0; i <= m; i++) {
    prevRow[i] = i;
  }
  
  // Fill in the rest of the matrix
  for (let j = 1; j <= n; j++) {
    currRow[0] = j;
    
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      
      currRow[i] = Math.min(
        prevRow[i] + 1,      // Deletion
        currRow[i - 1] + 1,  // Insertion
        prevRow[i - 1] + cost // Substitution
      );
    }
    
    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }
  
  return prevRow[m];
}

/**
 * Calculate similarity score between two strings (0 to 1)
 * 1 = identical, 0 = completely different
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const distance = levenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  
  return 1 - distance / maxLength;
}

/**
 * Check if two strings are similar within a threshold
 */
export function isSimilar(a: string, b: string, threshold: number = 0.85): boolean {
  return similarity(a, b) >= threshold;
}

/**
 * Find the best match from a list of candidates
 */
export function findBestMatch(
  input: string,
  candidates: string[]
): { match: string | null; score: number; index: number } {
  if (candidates.length === 0) {
    return { match: null, score: 0, index: -1 };
  }
  
  let bestScore = 0;
  let bestMatch: string | null = null;
  let bestIndex = -1;
  
  for (let i = 0; i < candidates.length; i++) {
    const score = similarity(input, candidates[i]);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidates[i];
      bestIndex = i;
    }
  }
  
  return { match: bestMatch, score: bestScore, index: bestIndex };
}

/**
 * Find all matches above a threshold
 */
export function findAllMatches(
  input: string,
  candidates: string[],
  threshold: number = 0.7
): Array<{ match: string; score: number; index: number }> {
  const matches: Array<{ match: string; score: number; index: number }> = [];
  
  for (let i = 0; i < candidates.length; i++) {
    const score = similarity(input, candidates[i]);
    if (score >= threshold) {
      matches.push({ match: candidates[i], score, index: i });
    }
  }
  
  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);
  
  return matches;
}

/**
 * Damerau-Levenshtein distance (includes transpositions)
 * Useful for catching typos where adjacent characters are swapped
 */
export function damerauLevenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  
  if (m === 0) return n;
  if (n === 0) return m;
  
  // Create matrix
  const d: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));
  
  // Initialize first column and row
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  
  // Fill matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // Deletion
        d[i][j - 1] + 1,      // Insertion
        d[i - 1][j - 1] + cost // Substitution
      );
      
      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  
  return d[m][n];
}

/**
 * Similarity using Damerau-Levenshtein distance
 */
export function damerauSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const distance = damerauLevenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  
  return 1 - distance / maxLength;
}

/**
 * Jaro similarity (good for short strings like names)
 */
export function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  
  const matchDistance = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  
  let matches = 0;
  let transpositions = 0;
  
  // Find matches
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, b.length);
    
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  
  if (matches === 0) return 0;
  
  // Count transpositions
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  
  return (
    (matches / a.length +
      matches / b.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

/**
 * Jaro-Winkler similarity (emphasizes matching prefixes)
 */
export function jaroWinklerSimilarity(a: string, b: string, prefixScale: number = 0.1): number {
  const jaroSim = jaroSimilarity(a, b);
  
  // Find common prefix (up to 4 chars)
  let prefixLength = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) {
      prefixLength++;
    } else {
      break;
    }
  }
  
  return jaroSim + prefixLength * prefixScale * (1 - jaroSim);
}

/**
 * Combined similarity using multiple metrics
 * Weighted average of Levenshtein and Jaro-Winkler
 */
export function combinedSimilarity(a: string, b: string): number {
  const lev = similarity(a, b);
  const jw = jaroWinklerSimilarity(a, b);
  
  // Weight Levenshtein more for longer strings, Jaro-Winkler for shorter
  const avgLength = (a.length + b.length) / 2;
  const levWeight = Math.min(avgLength / 10, 0.7);
  const jwWeight = 1 - levWeight;
  
  return lev * levWeight + jw * jwWeight;
}

