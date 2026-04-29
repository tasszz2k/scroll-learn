import { describe, expect, it } from 'vitest';
import {
  applySlashCommand,
  cmdBold,
  cmdBulletList,
  cmdChecklist,
  cmdHeading,
  cmdIndent,
  cmdInlineCode,
  cmdItalic,
  cmdLink,
  cmdNumberedList,
  cmdOutdent,
  cmdQuote,
  type EditorState,
} from '../src/dashboard/components/notebooks/editorCommands';

function mk(value: string, selStart: number, selEnd: number = selStart): EditorState {
  return { value, selectionStart: selStart, selectionEnd: selEnd };
}

describe('inline marks', () => {
  it('wraps selected text in **bold**', () => {
    const next = cmdBold(mk('hello world', 6, 11));
    expect(next.value).toBe('hello **world**');
    expect(next.selectionStart).toBe(8);
    expect(next.selectionEnd).toBe(13);
  });

  it('inserts a placeholder when nothing is selected for bold', () => {
    const next = cmdBold(mk('hello ', 6));
    expect(next.value).toBe('hello **bold**');
    expect(next.value.slice(next.selectionStart, next.selectionEnd)).toBe('bold');
  });

  it('wraps selection in *italic*', () => {
    const next = cmdItalic(mk('a quick fox', 2, 7));
    expect(next.value).toBe('a *quick* fox');
  });

  it('wraps selection in `code`', () => {
    const next = cmdInlineCode(mk('use kubectl now', 4, 11));
    expect(next.value).toBe('use `kubectl` now');
  });

  it('builds a markdown link from selection + URL prompt', () => {
    const next = cmdLink('https://example.com')(mk('hello link', 6, 10));
    expect(next.value).toBe('hello [link](https://example.com)');
  });
});

describe('block marks', () => {
  it('prefixes the current line with bullet "- "', () => {
    const next = cmdBulletList(mk('first\nsecond', 0, 5));
    expect(next.value).toBe('- first\nsecond');
  });

  it('toggles bullet off when prefix already present', () => {
    const next = cmdBulletList(mk('- already', 0, 9));
    expect(next.value).toBe('already');
  });

  it('numbers a multi-line selection from 1', () => {
    const next = cmdNumberedList(mk('alpha\nbeta\ngamma', 0, 16));
    expect(next.value).toBe('1. alpha\n2. beta\n3. gamma');
  });

  it('inserts a checklist marker', () => {
    const next = cmdChecklist(mk('do thing', 0, 8));
    expect(next.value).toBe('- [ ] do thing');
  });

  it('promotes the current line to H2', () => {
    const next = cmdHeading(2)(mk('Title here', 0, 10));
    expect(next.value).toBe('## Title here');
  });

  it('replaces an existing heading prefix with the new level', () => {
    const next = cmdHeading(3)(mk('# Title', 0, 7));
    expect(next.value).toBe('### Title');
  });

  it('quote-prefixes lines and toggles when re-applied', () => {
    const once = cmdQuote(mk('quote me', 0, 8));
    expect(once.value).toBe('> quote me');
    const twice = cmdQuote(once);
    expect(twice.value).toBe('quote me');
  });
});

describe('indent / outdent', () => {
  it('indents the current line by 2 spaces', () => {
    const next = cmdIndent(mk('item', 0, 4));
    expect(next.value).toBe('  item');
  });

  it('outdents 2 leading spaces if present, otherwise no-op', () => {
    expect(cmdOutdent(mk('  item', 0, 6)).value).toBe('item');
    expect(cmdOutdent(mk('item', 0, 4)).value).toBe('item');
  });
});

describe('applySlashCommand', () => {
  it('replaces the trigger range with the inserted block', () => {
    // user typed "/he" on a blank line (trigger at index 6, "h" + "e" filter)
    const before = 'Hello\n/heading';
    const next = applySlashCommand(
      mk(before, before.length),
      6,    // start of "/"
      14,   // end of "/heading" filter
      '\n## ',
    );
    expect(next.value).toBe('Hello\n\n## ');
    expect(next.selectionStart).toBe(next.value.length);
    expect(next.selectionEnd).toBe(next.value.length);
  });
});
