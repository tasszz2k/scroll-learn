// Pure helpers that take the current textarea (value + selection range) and
// return the next value + selection. Keeping them pure makes the toolbar
// buttons, keyboard shortcuts, and slash menu interchangeable -- and lets
// us unit-test them without React.

export interface EditorState {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type EditorCommand = (s: EditorState) => EditorState;

function getSelectedText(s: EditorState): string {
  return s.value.slice(s.selectionStart, s.selectionEnd);
}

function replaceSelection(s: EditorState, replacement: string, cursorOffset?: number): EditorState {
  const before = s.value.slice(0, s.selectionStart);
  const after = s.value.slice(s.selectionEnd);
  const value = before + replacement + after;
  const cursor = cursorOffset != null
    ? before.length + cursorOffset
    : before.length + replacement.length;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}

// --- Inline marks --------------------------------------------------------

function wrapInline(prefix: string, suffix: string, placeholder: string): EditorCommand {
  return (s) => {
    const sel = getSelectedText(s);
    if (sel) {
      const replacement = prefix + sel + suffix;
      return {
        value: s.value.slice(0, s.selectionStart) + replacement + s.value.slice(s.selectionEnd),
        selectionStart: s.selectionStart + prefix.length,
        selectionEnd: s.selectionEnd + prefix.length,
      };
    }
    const replacement = prefix + placeholder + suffix;
    const start = s.selectionStart + prefix.length;
    return {
      value: s.value.slice(0, s.selectionStart) + replacement + s.value.slice(s.selectionEnd),
      selectionStart: start,
      selectionEnd: start + placeholder.length,
    };
  };
}

export const cmdBold: EditorCommand = wrapInline('**', '**', 'bold');
export const cmdItalic: EditorCommand = wrapInline('*', '*', 'italic');
export const cmdInlineCode: EditorCommand = wrapInline('`', '`', 'code');

export function cmdLink(url?: string): EditorCommand {
  return (s) => {
    const sel = getSelectedText(s) || 'text';
    const href = (url ?? '').trim() || 'https://';
    const replacement = `[${sel}](${href})`;
    return replaceSelection(s, replacement);
  };
}

// --- Block-level helpers -------------------------------------------------

// Find the start of the current line (the first character after the
// previous newline, or 0 if we're on the first line).
function lineStart(value: string, pos: number): number {
  for (let i = pos - 1; i >= 0; i--) {
    if (value[i] === '\n') return i + 1;
  }
  return 0;
}

function lineEnd(value: string, pos: number): number {
  for (let i = pos; i < value.length; i++) {
    if (value[i] === '\n') return i;
  }
  return value.length;
}

// Return [start, end] inclusive of every line touched by [selStart, selEnd].
function selectedLineRange(value: string, selStart: number, selEnd: number): [number, number] {
  return [lineStart(value, selStart), lineEnd(value, selEnd)];
}

function eachLine(value: string, selStart: number, selEnd: number, mapLine: (line: string, idx: number) => string): EditorState {
  const [start, end] = selectedLineRange(value, selStart, selEnd);
  const block = value.slice(start, end);
  const lines = block.split('\n');
  const next = lines.map((l, i) => mapLine(l, i)).join('\n');
  const value2 = value.slice(0, start) + next + value.slice(end);
  return {
    value: value2,
    selectionStart: start,
    selectionEnd: start + next.length,
  };
}

export function cmdHeading(level: 1 | 2 | 3 | 4 | 5 | 6): EditorCommand {
  const prefix = '#'.repeat(level) + ' ';
  return (s) => eachLine(s.value, s.selectionStart, s.selectionEnd, (line) => {
    const cleaned = line.replace(/^#{1,6} /, '');
    return prefix + cleaned;
  });
}

export const cmdBulletList: EditorCommand = (s) =>
  eachLine(s.value, s.selectionStart, s.selectionEnd, (line) => {
    if (/^[-*] /.test(line)) return line.replace(/^[-*] /, '');
    if (line.trim() === '') return '- ';
    return '- ' + line;
  });

export const cmdNumberedList: EditorCommand = (s) =>
  eachLine(s.value, s.selectionStart, s.selectionEnd, (line, i) => {
    if (/^\d+\. /.test(line)) return line.replace(/^\d+\. /, '');
    if (line.trim() === '') return `${i + 1}. `;
    return `${i + 1}. ${line}`;
  });

export const cmdChecklist: EditorCommand = (s) =>
  eachLine(s.value, s.selectionStart, s.selectionEnd, (line) => {
    if (/^- \[[ x]\] /.test(line)) return line.replace(/^- \[[ x]\] /, '');
    if (line.trim() === '') return '- [ ] ';
    return '- [ ] ' + line;
  });

export const cmdQuote: EditorCommand = (s) =>
  eachLine(s.value, s.selectionStart, s.selectionEnd, (line) => {
    if (/^> /.test(line)) return line.replace(/^> /, '');
    return '> ' + line;
  });

// Insert a block at the start of the next line. If we're already on a blank
// line at the cursor, replace it; otherwise prepend a newline + the block.
function insertBlock(s: EditorState, block: string): EditorState {
  const ls = lineStart(s.value, s.selectionStart);
  const isBlankLine = s.value.slice(ls, s.selectionStart).trim() === '' && (s.value[s.selectionStart] === '\n' || s.selectionStart === s.value.length);
  if (isBlankLine) {
    const before = s.value.slice(0, ls);
    const after = s.value.slice(ls);
    const value = before + block + after;
    const cursor = (before + block).length;
    return { value, selectionStart: cursor, selectionEnd: cursor };
  }
  const before = s.value.slice(0, s.selectionStart);
  const after = s.value.slice(s.selectionStart);
  const prefix = before.endsWith('\n') ? '' : '\n';
  const block2 = prefix + block;
  const value = before + block2 + after;
  const cursor = (before + block2).length;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}

export const cmdCodeBlock: EditorCommand = (s) => insertBlock(s, '\n```\n\n```\n');

export const cmdTable: EditorCommand = (s) => insertBlock(
  s,
  '\n| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| cell | cell | cell |\n',
);

export const cmdHorizontalRule: EditorCommand = (s) => insertBlock(s, '\n---\n');

export const cmdImage: EditorCommand = (s) => replaceSelection(s, '![alt text](https://)');

// --- Indent / outdent inside lists --------------------------------------

export const cmdIndent: EditorCommand = (s) =>
  eachLine(s.value, s.selectionStart, s.selectionEnd, (line) => '  ' + line);

export const cmdOutdent: EditorCommand = (s) =>
  eachLine(s.value, s.selectionStart, s.selectionEnd, (line) => line.replace(/^ {2}/, ''));

// --- Slash menu insertion -----------------------------------------------

// Replace a leading "/" trigger token with the inserted block. The slash
// menu calls this with the start of the trigger so the "/" itself is
// removed.
export function applySlashCommand(
  s: EditorState,
  triggerStart: number,
  triggerEnd: number,
  insert: string,
): EditorState {
  const before = s.value.slice(0, triggerStart);
  const after = s.value.slice(triggerEnd);
  const value = before + insert + after;
  const cursor = (before + insert).length;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}
