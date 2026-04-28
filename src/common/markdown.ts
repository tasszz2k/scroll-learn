/**
 * Markdown-lite parser for the optional `backExtra` reveal panel on cards.
 *
 * Supports a deliberately narrow subset, just enough to render the
 * vocabulary-style notes the prompt generator emits:
 *
 *   - Paragraphs separated by blank lines. Internal newlines inside a
 *     paragraph render as visible line breaks.
 *   - Bulleted lists: lines starting with `* ` or `- `. Indented continuation
 *     lines (e.g. translation lines like "    -> ...") attach to the previous
 *     bullet as secondary lines.
 *   - Inline bold via `**text**` (greedy, no nesting).
 *
 * The HTML renderer always escapes `<`, `>`, `&`, `"`, `'` before applying
 * markup, so user content cannot inject markup. The same shared model
 * (parseBackExtra) feeds the React renderer in the dashboard and the
 * innerHTML-based renderer in the content script so they stay visually
 * aligned.
 */

export interface InlineRun {
  text: string;
  bold: boolean;
}

/** A pronunciation entry like { region: 'us', ipa: '/ˈanəˌlīsis/' }. */
export interface IpaEntry {
  region: string;
  ipa: string;
}

/** A list item: index 0 is the bullet's main line, the rest are continuation lines. */
export type ListItem = InlineRun[][];

export type BackExtraBlock =
  | { type: 'paragraph'; lines: InlineRun[][] }
  | { type: 'list'; items: ListItem[] };

const BULLET_RE = /^[*-]\s+(.*)$/;
const BOLD_RE = /\*\*([^*]+?)\*\*/g;
const IPA_LINE_RE = /^\s*(?:(?:us|uk|gb|au)\s*\/[^/\s][^/]*\/\s*){1,4}$/i;
const IPA_TOKEN_RE = /(us|uk|gb|au)\s*(\/[^/\s][^/]*\/)/gi;

/**
 * If the given line text reads like a pronunciation entry (e.g.
 * "us /əˈnæl.ə.sɪs/   uk /əˈnæl.ə.sɪs/"), return the parsed entries.
 * Otherwise return null. The check is intentionally narrow — anything
 * with extra prose around the slashes falls through to inline rendering.
 */
export function parseIpaLine(text: string): IpaEntry[] | null {
  if (!IPA_LINE_RE.test(text.trim())) return null;
  const entries: IpaEntry[] = [];
  IPA_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IPA_TOKEN_RE.exec(text)) !== null) {
    entries.push({ region: m[1].toLowerCase(), ipa: m[2] });
  }
  return entries.length > 0 ? entries : null;
}

/** Concatenate run text — useful for re-checking a parsed line against pattern detectors. */
export function lineTextFromRuns(runs: InlineRun[]): string {
  return runs.map(r => r.text).join('');
}

function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let last = 0;
  BOLD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BOLD_RE.exec(text)) !== null) {
    if (m.index > last) {
      runs.push({ text: text.slice(last, m.index), bold: false });
    }
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last), bold: false });
  }
  if (runs.length === 0) {
    runs.push({ text: '', bold: false });
  }
  return runs;
}

export function parseBackExtra(text: string): BackExtraBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: BackExtraBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i >= lines.length) break;

    const blockLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      blockLines.push(lines[i]);
      i++;
    }

    const firstTrimmed = blockLines[0].trimStart();
    const isList = BULLET_RE.test(firstTrimmed);

    if (isList) {
      const items: ListItem[] = [];
      let current: ListItem | null = null;
      for (const ln of blockLines) {
        const trimmed = ln.trimStart();
        const bulletMatch = BULLET_RE.exec(trimmed);
        if (bulletMatch) {
          current = [parseInline(bulletMatch[1].trim())];
          items.push(current);
        } else if (current) {
          current.push(parseInline(trimmed));
        }
      }
      blocks.push({ type: 'list', items });
    } else {
      blocks.push({
        type: 'paragraph',
        lines: blockLines.map(ln => parseInline(ln.trim())),
      });
    }
  }

  return blocks;
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function renderInlineHTML(runs: InlineRun[]): string {
  return runs.map(r => {
    const escaped = escapeHTML(r.text);
    return r.bold ? `<strong>${escaped}</strong>` : escaped;
  }).join('');
}

function renderIpaHTML(entries: IpaEntry[]): string {
  const parts = entries.map(e =>
    `<span class="scrolllearn-quiz-ipa-entry">`
    + `<span class="scrolllearn-quiz-ipa-region">${escapeHTML(e.region)}</span>`
    + `<span class="scrolllearn-quiz-ipa-text">${escapeHTML(e.ipa)}</span>`
    + `</span>`
  ).join('');
  return `<div class="scrolllearn-quiz-ipa-line">${parts}</div>`;
}

/**
 * Render markdown-lite as HTML for the in-feed quiz content script.
 * Output is wrapped in a single container div so styling can be scoped.
 */
export function renderBackExtraHTML(text: string): string {
  const blocks = parseBackExtra(text);
  if (blocks.length === 0) return '';

  return blocks.map(block => {
    if (block.type === 'paragraph') {
      const inner = block.lines.map(runs => {
        const ipa = parseIpaLine(lineTextFromRuns(runs));
        if (ipa) return renderIpaHTML(ipa);
        return `<div class="scrolllearn-quiz-back-extra-line">${renderInlineHTML(runs)}</div>`;
      }).join('');
      return `<div class="scrolllearn-quiz-back-extra-p">${inner}</div>`;
    }
    const items = block.items.map(item => {
      const main = renderInlineHTML(item[0]);
      const conts = item.slice(1)
        .map(line => `<div class="scrolllearn-quiz-back-extra-cont">${renderInlineHTML(line)}</div>`)
        .join('');
      return `<li>${main}${conts}</li>`;
    }).join('');
    return `<ul class="scrolllearn-quiz-back-extra-ul">${items}</ul>`;
  }).join('');
}
