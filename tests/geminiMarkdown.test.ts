import { describe, it, expect } from 'vitest';
import { extractMarkdownLite } from '../src/content/geminiMarkdown';

// Minimal node shim sufficient for the walker's structural needs.
// We never construct a real DOM here -- vitest runs in node env.
interface ShimNode {
  nodeType: number;
  textContent?: string | null;
  tagName?: string;
  childNodes?: ShimNode[];
}

function el(tag: string, ...kids: Array<ShimNode | string>): ShimNode {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: kids.map(k =>
      typeof k === 'string' ? text(k) : k,
    ),
  };
}

function text(s: string): ShimNode {
  return { nodeType: 3, textContent: s };
}

describe('extractMarkdownLite', () => {
  it('preserves <strong> as **bold**', () => {
    const root = el('div', el('p', 'hello ', el('strong', 'world'), '!'));
    expect(extractMarkdownLite(root)).toBe('hello **world**!');
  });

  it('renders <p> blocks separated by a blank line', () => {
    const root = el('div', el('p', 'first paragraph'), el('p', 'second paragraph'));
    expect(extractMarkdownLite(root)).toBe('first paragraph\n\nsecond paragraph');
  });

  it('converts <ul>/<li> to bullet list lines', () => {
    const root = el(
      'div',
      el('ul',
        el('li', el('strong', 'Disputable'), ' the referee was wrong'),
        el('li', el('strong', 'Contentious'), ' the new policy'),
      ),
    );
    const md = extractMarkdownLite(root);
    expect(md).toBe(
      '* **Disputable** the referee was wrong\n'
      + '* **Contentious** the new policy',
    );
  });

  it('treats headings as their own bold paragraph', () => {
    const root = el('div',
      el('h3', 'Framework'),
      el('p', 'The legal framework is a paradigm.'),
    );
    expect(extractMarkdownLite(root)).toBe(
      '**Framework**\n\nThe legal framework is a paradigm.',
    );
  });

  it('passes <em>/<i> through as plain text (no italic in markdown-lite)', () => {
    const root = el('p', 'a ', el('em', 'subtle'), ' point');
    expect(extractMarkdownLite(root)).toBe('a subtle point');
  });

  it('converts <br> to a single newline within a paragraph', () => {
    const root = el('p', 'line one', el('br'), 'line two');
    expect(extractMarkdownLite(root)).toBe('line one\nline two');
  });

  it('flattens through wrapper <span>/<div> containers', () => {
    const root = el('div',
      el('span', 'plain '),
      el('div', el('strong', 'bold')),
    );
    expect(extractMarkdownLite(root)).toBe('plain **bold**');
  });

  it('reproduces a multi-section synonym response with bold headers', () => {
    const root = el('div',
      el('p',
        'Since ', el('strong', 'controversial'),
        ' describes something that causes public disagreement, here are several synonyms:',
      ),
      el('ul',
        el('li',
          el('strong', 'Disputable'), el('br'),
          'The referee\'s decision was highly disputable.', el('br'),
          'Quyết định trọng tài rất đáng tranh cãi.',
        ),
        el('li',
          el('strong', 'Contentious'), el('br'),
          'The new policy remains a contentious issue.',
        ),
      ),
    );
    const md = extractMarkdownLite(root);
    expect(md).toContain('Since **controversial**');
    expect(md).toContain('* **Disputable**');
    expect(md).toContain('* **Contentious**');
  });
});
