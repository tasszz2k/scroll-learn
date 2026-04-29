// @vitest-environment jsdom
//
// Smoke tests for the rich-editor markdown round-trip. We don't mount the
// React component (that needs a full React tree); instead we instantiate
// the same TipTap Editor headlessly with the same extensions configured
// in `RichEditor.tsx` and assert that representative markdown blocks
// survive a parse -> serialize round-trip.
//
// "Round-trip clean" is intentionally loose: we normalise trailing
// whitespace and trim because tiptap-markdown's serializer emits a
// trailing newline for block content. The asserts focus on structural
// preservation, not byte-exact identity.

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';

function makeEditor(initial: string): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        html: false,
        breaks: true,
        linkify: true,
        tightLists: true,
      }),
    ],
    content: initial,
  });
}

function roundtrip(md: string): string {
  const editor = makeEditor(md);
  const storage = editor.storage as unknown as Record<string, unknown>;
  const helpers = storage.markdown as
    | { getMarkdown?: () => string }
    | undefined;
  const out = helpers?.getMarkdown?.() ?? '';
  editor.destroy();
  return out.trim();
}

describe('RichEditor markdown round-trip', () => {
  it('preserves bold marker', () => {
    expect(roundtrip('hello **world**')).toBe('hello **world**');
  });

  it('preserves italic marker', () => {
    expect(roundtrip('hello *world*')).toBe('hello *world*');
  });

  it('preserves inline code', () => {
    expect(roundtrip('press `Enter`')).toBe('press `Enter`');
  });

  it('preserves headings 1-3', () => {
    expect(roundtrip('# Heading 1')).toBe('# Heading 1');
    expect(roundtrip('## Heading 2')).toBe('## Heading 2');
    expect(roundtrip('### Heading 3')).toBe('### Heading 3');
  });

  it('preserves bullet list', () => {
    const out = roundtrip('- a\n- b');
    expect(out).toContain('- a');
    expect(out).toContain('- b');
  });

  it('preserves ordered list', () => {
    const out = roundtrip('1. a\n2. b');
    expect(out).toContain('1. a');
    expect(out).toContain('2. b');
  });

  it('preserves task list', () => {
    const out = roundtrip('- [ ] open\n- [x] done');
    expect(out).toMatch(/-\s\[ \]\s+open/);
    expect(out).toMatch(/-\s\[x\]\s+done/);
  });

  it('preserves blockquote', () => {
    const out = roundtrip('> a quote');
    expect(out.startsWith('>')).toBe(true);
    expect(out).toContain('a quote');
  });

  it('preserves link', () => {
    const out = roundtrip('[text](https://example.com)');
    expect(out).toBe('[text](https://example.com)');
  });

  it('preserves attachment image src', () => {
    const out = roundtrip('![alt](attachment://abc-123)');
    expect(out).toContain('attachment://abc-123');
    expect(out).toContain('alt');
  });

  it('preserves a 2x2 GFM table', () => {
    const md = '| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |';
    const out = roundtrip(md);
    expect(out).toContain('| h1');
    expect(out).toContain('| h2');
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
    expect(out).toContain('d');
  });

  it('preserves a fenced code block with language', () => {
    const md = '```ts\nconst x = 1;\n```';
    const out = roundtrip(md);
    expect(out).toMatch(/^```/m);
    expect(out).toContain('const x = 1;');
  });

  it('round-trip is stable across two passes', () => {
    const md = '# Title\n\nSome **bold** text and a [link](https://x.test).\n\n- a\n- b\n';
    const once = roundtrip(md);
    const twice = roundtrip(once);
    expect(twice).toBe(once);
  });
});
