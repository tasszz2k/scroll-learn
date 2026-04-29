import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { getAttachmentURL } from '../../../common/notebookStore';

interface NotebookPreviewProps {
  body: string;
}

// Wraps an attachment id into a resolvable blob URL that React can paint
// into <img>. We keep them in module-scope so multiple <img> tags pointing
// at the same id share a URL and we revoke them on cleanup.
const blobUrlCache = new Map<string, string>();

async function resolveAttachmentUrl(id: string): Promise<string | null> {
  const hit = blobUrlCache.get(id);
  if (hit) return hit;
  const url = await getAttachmentURL(id);
  if (url) blobUrlCache.set(id, url);
  return url;
}

// Revoke all cached blob URLs. Call on app teardown so we do not leak
// object URLs into the GC heap. Helper is colocated with the component
// that owns the cache; moving it out would fragment the module without
// functional benefit.
// eslint-disable-next-line react-refresh/only-export-components
export function revokeAllAttachmentUrls(): void {
  for (const url of blobUrlCache.values()) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  blobUrlCache.clear();
}

// One-time configuration. marked.use() is global; we register a sanitiser
// that DOMPurify runs after the parser produces HTML.
let configured = false;
function ensureMarkedConfigured() {
  if (configured) return;
  configured = true;
  marked.setOptions({
    gfm: true,
    breaks: true,
  });
}

// DOMPurify hook: when an <img> sources an `attachment://<id>` URL, swap
// in a sentinel data attribute the React effect can resolve to a blob URL
// asynchronously. Sanitisation happens before resolution so the inserted
// HTML stays inert during parsing.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof HTMLImageElement) {
    const src = node.getAttribute('src');
    if (src && src.startsWith('attachment://')) {
      const id = src.slice('attachment://'.length);
      node.setAttribute('data-attachment-id', id);
      // Strip the unrenderable scheme; the React effect will set the real
      // src once the blob URL resolves.
      node.removeAttribute('src');
      node.setAttribute('alt', node.getAttribute('alt') || 'attachment');
    }
  }
  // Open external links in a new tab; rel='noopener' guards against the
  // tabnabbing class of attacks. We only touch http(s) anchors.
  if (node instanceof HTMLAnchorElement) {
    const href = node.getAttribute('href');
    if (href && /^https?:/i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

// `marked.parse` returns Promise<string> when async extensions are
// registered; we call it sync here because none are.
function renderMarkdownToHTML(md: string): string {
  ensureMarkedConfigured();
  const raw = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|attachment|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ADD_ATTR: ['target', 'rel', 'data-attachment-id'],
  });
}

export default function NotebookPreview({ body }: NotebookPreviewProps) {
  const html = useMemo(() => renderMarkdownToHTML(body), [body]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track which attachment ids the current preview wants resolved so we
  // can revoke unused ones when the body changes.
  const [, setVersion] = useState(0);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-attachment-id]'));
    let cancelled = false;
    void Promise.all(imgs.map(async (img) => {
      const id = img.getAttribute('data-attachment-id');
      if (!id) return;
      const url = await resolveAttachmentUrl(id);
      if (cancelled) return;
      if (url) {
        img.src = url;
      } else {
        img.alt = `(missing attachment ${id})`;
      }
    })).then(() => {
      if (!cancelled) setVersion(v => v + 1);
    });
    return () => { cancelled = true; };
  }, [html]);

  return (
    <div
      ref={containerRef}
      className="notebook-preview"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 28px',
        fontFamily: "'Source Serif Pro', Georgia, serif",
        fontSize: 15,
        color: 'var(--ink)',
      }}
      // We sanitise via DOMPurify above; this is the only path where we
      // inject the rendered markup.
      dangerouslySetInnerHTML={{ __html: html || '<p style="color: var(--ink-3); font-style: italic;">Nothing to preview yet.</p>' }}
    />
  );
}
