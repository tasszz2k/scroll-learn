import { describe, expect, it } from 'vitest';
import {
  quickOpenSearch,
  scoreNotebookHitsSync,
} from '../src/common/notebookSearch';
import { createNotebook } from '../src/common/types';

function nb(title: string, opts: Partial<{ tags: string[]; folderPath: string }> = {}) {
  return createNotebook({
    title,
    folderPath: opts.folderPath ?? '',
    tags: opts.tags ?? [],
    properties: {},
  });
}

describe('quickOpenSearch (titles + tags)', () => {
  it('returns empty when query is empty', () => {
    const all = [nb('Helm chart')];
    expect(quickOpenSearch(all, '')).toEqual([]);
  });

  it('matches by title (case-insensitive)', () => {
    const a = nb('Helm chart playbook');
    const b = nb('Argo CD intro');
    const hits = quickOpenSearch([a, b], 'helm');
    expect(hits.map(h => h.notebookId)).toEqual([a.id]);
    expect(hits[0].matchedIn).toContain('title');
  });

  it('weights title above tags when both match', () => {
    const a = nb('Argo CD usage');                      // title hit only
    const b = nb('Daily log', { tags: ['argo', 'cd'] });// tag hits
    const hits = quickOpenSearch([a, b], 'argo');
    // Title weight 3 > tag weight 2, so a should outrank b.
    expect(hits.map(h => h.notebookId)).toEqual([a.id, b.id]);
  });

  it('does not return body matches in quick-open', () => {
    // Quick open never sees the body string, so even a "matching" body has
    // no effect on the score. We simulate by passing a notebook whose
    // tags/title do not match the query.
    const a = nb('A note', { tags: ['unrelated'] });
    const hits = quickOpenSearch([a], 'kubernetes');
    expect(hits).toEqual([]);
  });
});

describe('scoreNotebookHitsSync (full-text scoring)', () => {
  it('scores body matches and produces a snippet', () => {
    const a = nb('Notes on rollout strategies');
    const records = [
      {
        notebook: a,
        body: 'In ArgoCD we rollback by reverting the manifests in git.',
      },
    ];
    const hits = scoreNotebookHitsSync(records, 'rollback');
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedIn).toContain('body');
    expect(hits[0].snippet).toMatch(/rollback/i);
  });

  it('aggregates multiple body hits into a higher score', () => {
    const a = nb('A');
    const b = nb('B');
    const records = [
      { notebook: a, body: 'helm helm helm' },
      { notebook: b, body: 'helm chart' },
    ];
    const hits = scoreNotebookHitsSync(records, 'helm');
    expect(hits.map(h => h.notebookId)).toEqual([a.id, b.id]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('respects the limit option', () => {
    const records = Array.from({ length: 5 }, (_, i) => ({
      notebook: nb(`Note ${i}`, { tags: ['kube'] }),
      body: '',
    }));
    const hits = scoreNotebookHitsSync(records, 'kube', { limit: 2 });
    expect(hits).toHaveLength(2);
  });

  it('returns empty for whitespace-only queries', () => {
    const records = [{ notebook: nb('foo'), body: 'bar' }];
    expect(scoreNotebookHitsSync(records, '   ')).toEqual([]);
  });
});
