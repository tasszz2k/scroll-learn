/**
 * Convert a rendered DOM subtree (Gemini's markdown output) back to the
 * markdown-lite format the dashboard renderer understands.
 *
 * Gemini parses its model output as markdown and renders HTML. Reading
 * `innerText` collapses that structure to a flat string -- bold, lists, and
 * paragraph breaks all disappear. This walker preserves the small subset our
 * markdown-lite parser supports: paragraphs, bullet lists, and **bold**.
 *
 * The walker only inspects fields shared across DOM nodes (`nodeType`,
 * `tagName`, `childNodes`, `textContent`) so it can be exercised by a tiny
 * test shim without pulling in a full DOM.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

interface MdNode {
  nodeType: number;
  textContent?: string | null;
  tagName?: string;
  childNodes?: ArrayLike<MdNode>;
}

function children(node: MdNode): MdNode[] {
  const list = node.childNodes;
  if (!list) return [];
  const out: MdNode[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i]);
  return out;
}

function nodeToMarkdown(node: MdNode): string {
  if (node.nodeType === TEXT_NODE) {
    return node.textContent ?? '';
  }
  if (node.nodeType !== ELEMENT_NODE) return '';

  const tag = (node.tagName || '').toLowerCase();
  const inner = children(node).map(nodeToMarkdown).join('');

  switch (tag) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b': {
      const trimmed = inner.trim();
      if (!trimmed) return '';
      // Preserve any leading/trailing whitespace from the original run so the
      // bold marker doesn't swallow a needed space.
      const leading = inner.slice(0, inner.length - inner.trimStart().length);
      const trailing = inner.slice(inner.trimEnd().length);
      return `${leading}**${trimmed}**${trailing}`;
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const trimmed = inner.trim();
      return trimmed ? `\n\n**${trimmed}**\n\n` : '';
    }
    case 'p':
      return `\n\n${inner}\n\n`;
    case 'li': {
      const trimmed = inner.replace(/\n+$/, '').trim();
      return trimmed ? `* ${trimmed}\n` : '';
    }
    case 'ul':
    case 'ol':
      return `\n\n${inner}\n\n`;
    case 'blockquote':
      return `\n\n${inner}\n\n`;
    // Inline / passthrough containers: emit children only.
    case 'em':
    case 'i':
    case 'code':
    case 'span':
    case 'a':
    case 'div':
    case 'section':
    case 'article':
    default:
      return inner;
  }
}

/**
 * Convert a Gemini response container (`<message-content>` or `.markdown`) to
 * markdown-lite text. Returns a trimmed string with at most one blank line
 * between paragraphs.
 */
export function extractMarkdownLite(root: MdNode): string {
  const raw = nodeToMarkdown(root);
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
