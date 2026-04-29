// Lower-case substring scan over notebook metadata + body. Cheap to run on
// the dashboard side because both stores live in IndexedDB / chrome.storage
// already; we only iterate in JS, no fancy index. Good enough for the
// "well under 1000 notebooks" target.

import type { Notebook } from './types';
import { getBody } from './notebookStore';

export interface NotebookSearchHit {
  notebookId: string;
  title: string;
  folderPath: string;
  tags: string[];
  // Numeric score; higher = more relevant.
  score: number;
  // Up to one excerpt of the body around the first match. Stripped of
  // newlines so the result picker can render it on a single row.
  snippet?: string;
  // Where the hit landed -- helps the UI label results.
  matchedIn: ('title' | 'tags' | 'body')[];
}

export interface NotebookSearchOptions {
  // 50 notebooks per batch is a sensible default; the dashboard tab can
  // ride this up when desktop hardware looks idle.
  batchSize?: number;
  // Cap on how many hits we return; null means "all".
  limit?: number;
  // 0 by default (a 0-len trim returns no hits).
  minQueryLength?: number;
}

const DEFAULT_OPTIONS: Required<NotebookSearchOptions> = {
  batchSize: 50,
  limit: 50,
  minQueryLength: 1,
};

// Title hits weigh the most (3x), then tags (2x), then body (1x). We score
// every match found, not just the first, so a body that mentions the term
// 5 times outranks one that mentions it once.
const TITLE_WEIGHT = 3;
const TAG_WEIGHT = 2;
const BODY_WEIGHT = 1;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while (true) {
    const idx = haystack.indexOf(needle, i);
    if (idx === -1) break;
    count++;
    i = idx + needle.length;
  }
  return count;
}

function buildSnippet(body: string, needle: string, padChars = 60): string | undefined {
  const idx = body.toLowerCase().indexOf(needle);
  if (idx === -1) return undefined;
  const start = Math.max(0, idx - padChars);
  const end = Math.min(body.length, idx + needle.length + padChars);
  let s = body.slice(start, end).replace(/\s+/g, ' ');
  if (start > 0) s = '...' + s;
  if (end < body.length) s = s + '...';
  return s;
}

// Lightweight quick-open scan: titles + tags only, no body fetch. Used by
// Cmd/Ctrl+P which expects ~instant results. Body-level matches require
// runFullTextSearch instead.
export function quickOpenSearch(
  notebooks: Notebook[],
  query: string,
  options: NotebookSearchOptions = {},
): NotebookSearchHit[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const q = query.trim().toLowerCase();
  if (q.length < opts.minQueryLength) return [];
  const hits: NotebookSearchHit[] = [];
  for (const nb of notebooks) {
    const titleHits = countOccurrences(nb.title.toLowerCase(), q);
    const tagHits = nb.tags.reduce((s, t) => s + countOccurrences(t.toLowerCase(), q), 0);
    const score = titleHits * TITLE_WEIGHT + tagHits * TAG_WEIGHT;
    if (score === 0) continue;
    const matchedIn: ('title' | 'tags')[] = [];
    if (titleHits > 0) matchedIn.push('title');
    if (tagHits > 0) matchedIn.push('tags');
    hits.push({
      notebookId: nb.id,
      title: nb.title,
      folderPath: nb.folderPath,
      tags: nb.tags,
      score,
      matchedIn,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, opts.limit ?? hits.length);
}

// Full-text scan that pulls bodies in batches. Slower than quickOpenSearch
// because it hits IndexedDB once per notebook, but still snappy under
// 1000 notebooks.
export async function runFullTextSearch(
  notebooks: Notebook[],
  query: string,
  options: NotebookSearchOptions = {},
): Promise<NotebookSearchHit[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const q = query.trim().toLowerCase();
  if (q.length < opts.minQueryLength) return [];
  const hits: NotebookSearchHit[] = [];

  for (let i = 0; i < notebooks.length; i += opts.batchSize) {
    const batch = notebooks.slice(i, i + opts.batchSize);
    const bodies = await Promise.all(batch.map(nb => getBody(nb.id)));
    batch.forEach((nb, idx) => {
      const body = bodies[idx] ?? '';
      const titleHits = countOccurrences(nb.title.toLowerCase(), q);
      const tagHits = nb.tags.reduce((s, t) => s + countOccurrences(t.toLowerCase(), q), 0);
      const bodyHits = countOccurrences(body.toLowerCase(), q);
      const score = titleHits * TITLE_WEIGHT + tagHits * TAG_WEIGHT + bodyHits * BODY_WEIGHT;
      if (score === 0) return;
      const matchedIn: ('title' | 'tags' | 'body')[] = [];
      if (titleHits > 0) matchedIn.push('title');
      if (tagHits > 0) matchedIn.push('tags');
      if (bodyHits > 0) matchedIn.push('body');
      hits.push({
        notebookId: nb.id,
        title: nb.title,
        folderPath: nb.folderPath,
        tags: nb.tags,
        score,
        snippet: bodyHits > 0 ? buildSnippet(body, q) : undefined,
        matchedIn,
      });
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, opts.limit ?? hits.length);
}

// Exported for tests; mirrors the same scoring logic against an in-memory
// (notebook, body) tuple list so we do not have to mock IndexedDB.
export function scoreNotebookHitsSync(
  records: Array<{ notebook: Notebook; body: string }>,
  query: string,
  options: NotebookSearchOptions = {},
): NotebookSearchHit[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const q = query.trim().toLowerCase();
  if (q.length < opts.minQueryLength) return [];
  const hits: NotebookSearchHit[] = [];
  for (const { notebook: nb, body } of records) {
    const titleHits = countOccurrences(nb.title.toLowerCase(), q);
    const tagHits = nb.tags.reduce((s, t) => s + countOccurrences(t.toLowerCase(), q), 0);
    const bodyHits = countOccurrences(body.toLowerCase(), q);
    const score = titleHits * TITLE_WEIGHT + tagHits * TAG_WEIGHT + bodyHits * BODY_WEIGHT;
    if (score === 0) continue;
    const matchedIn: ('title' | 'tags' | 'body')[] = [];
    if (titleHits > 0) matchedIn.push('title');
    if (tagHits > 0) matchedIn.push('tags');
    if (bodyHits > 0) matchedIn.push('body');
    hits.push({
      notebookId: nb.id,
      title: nb.title,
      folderPath: nb.folderPath,
      tags: nb.tags,
      score,
      snippet: bodyHits > 0 ? buildSnippet(body, q) : undefined,
      matchedIn,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, opts.limit ?? hits.length);
}
