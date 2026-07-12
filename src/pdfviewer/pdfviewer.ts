// In-extension PDF viewer.
//
// Chrome's built-in PDF viewer renders a local PDF inside an out-of-process
// <embed>, so a content script on the outer file:// page sees only the embed
// and window.getSelection()/innerText are empty -- pluck mode cannot read the
// text. This page renders the PDF ourselves with PDF.js, laying a *selectable*
// text layer over each page canvas, and mounts the same pluck flow the
// dashboard uses. Because this is a chrome-extension:// page, isHostAllowed
// treats it as always-allowed, so Alt-pluck works with no allowlist changes.
//
// The PDF worker is shipped verbatim via public/pdfjs/ (mirroring the ONNX
// pattern in kokoroOffscreen.ts) because a relative Vite ?url asset path does
// not resolve correctly for a Worker created from an extension subpage;
// chrome.runtime.getURL gives a stable extension-origin URL the CSP allows.

import * as pdfjsLib from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdfviewer.css';
import {
  mountPluckMode,
  type CaptureInfo,
  type PluckHandle,
} from '../common/pluckMode';
import { getOcrEngine, type OcrWord } from './ocr';
import { getCachedOcr, putCachedOcr, ocrCacheKey } from './ocrCache';
import {
  getHighlightsForDoc,
  putHighlight,
  type StoredHighlight,
} from './highlightStore';
import type { DictionarySense } from '../common/types';
import {
  initAnnotationController,
  type AnnotationController,
  type AnnotationPageInfo,
  type AnnotationPluckControls,
} from './annotations/controller';
import { createPageLayers } from './annotations/layer';
import {
  mountAnnotationToolbar,
  type AnnotationToolbarController,
  type AnnotationToolbarHandle,
} from './annotations/toolbar';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs');

const pagesEl = document.getElementById('ssv-pages') as HTMLElement;
const statusEl = document.getElementById('ssv-status') as HTMLElement;
const fileEl = document.getElementById('ssv-file') as HTMLElement;
const barEl = document.getElementById('ssv-bar') as HTMLElement;

// Rendered-page geometry, indexed as we paint each page, so a capture's
// client-space rects can be mapped onto the right page and stored in
// scale-independent page points.
type PageInfo = AnnotationPageInfo;
const pageInfos: PageInfo[] = [];

// The current document's fingerprint (set in main); highlights and the OCR
// cache are both keyed by it.
let currentDocId = '';
let pluckHandle: PluckHandle | null = null;
let savedHighlightHoverEnabled = true;
let annotationController: AnnotationController | null = null;
let annotationToolbar: AnnotationToolbarHandle | null = null;
const immediateToolbarController: AnnotationToolbarController = {
  setTool: state => annotationController?.setTool(state),
  undo: () => annotationController?.undo(),
  redo: () => annotationController?.redo(),
};

function remountPluck(): void {
  if (pluckHandle) return;
  pluckHandle = mountPluckMode({ onCapture: handleCapture });
}

function unmountPluck(): void {
  pluckHandle?.unmount();
  pluckHandle = null;
}

const pluckControls: AnnotationPluckControls = {
  remount: remountPluck,
  unmount: unmountPluck,
  setHoverEnabled: enabled => {
    savedHighlightHoverEnabled = enabled;
    if (!enabled) hideHoverPopup();
  },
};

// Saved highlights grouped by page for fast hover hit-testing.
const highlightsByPage = new Map<number, StoredHighlight[]>();

// A page whose embedded text is shorter than this (after stripping whitespace)
// is treated as a scanned image and sent to OCR. Real text pages return far
// more; a stray ligature or page number on an otherwise-scanned page won't
// clear the bar.
const EMBEDDED_TEXT_MIN = 12;

// Pages that had no usable embedded text, queued for OCR after every page has
// painted so the reader sees the document immediately and text fills in after.
interface OcrTask {
  pageEl: HTMLElement;
  canvas: HTMLCanvasElement;
  badge: HTMLElement;
  // 1-based page number, part of the per-page cache key.
  pageIndex: number;
  // Fit scale used for this render (page points -> CSS px).
  scale: number;
  // Device pixel ratio applied to the canvas (CSS px -> canvas px).
  outputScale: number;
}
const ocrQueue: OcrTask[] = [];

// Pluck starts in Hand mode and the annotation controller remounts it whenever
// the reader returns from an editing tool.
remountPluck();

function fileNameFromSrc(src: string): string {
  try {
    const decoded = decodeURIComponent(src);
    const withoutQuery = decoded.split('?')[0].split('#')[0];
    const name = withoutQuery.split('/').pop();
    return name && name.trim() ? name : 'document.pdf';
  } catch {
    return 'document.pdf';
  }
}

function showStatus(html: string): void {
  pagesEl.hidden = true;
  statusEl.hidden = false;
  statusEl.innerHTML = html;
  const btn = statusEl.querySelector('#ssv-open-settings');
  if (btn instanceof HTMLButtonElement) {
    btn.addEventListener('click', () => {
      // Opening chrome://extensions/?id=<id> lands the user on this
      // extension's card where the "Allow access to file URLs" toggle lives.
      void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    });
  }
}

function showFileAccessHelp(): void {
  showStatus(`
    <h2>Can't read this PDF yet</h2>
    <p>To let ScrollLearn open local files, turn on
    <strong>"Allow access to file URLs"</strong> for this extension.</p>
    <ol>
      <li>Open <code>chrome://extensions</code></li>
      <li>Find <strong>ScrollLearn</strong> and click <strong>Details</strong></li>
      <li>Enable <strong>Allow access to file URLs</strong></li>
      <li>Reopen this PDF</li>
    </ol>
    <button type="button" id="ssv-open-settings">Open extension settings</button>
  `);
}

async function renderPage(
  page: pdfjsLib.PDFPageProxy,
  fitWidth: number,
  pageNum: number,
): Promise<void> {
  const unscaled = page.getViewport({ scale: 1 });
  // Fit the page to the reading column, clamped so tiny pages stay legible and
  // huge pages don't blow past a comfortable width.
  const fitScale = fitWidth / unscaled.width;
  const scale = Math.min(Math.max(fitScale, 0.75), 2);
  const viewport = page.getViewport({ scale });

  const pageEl = document.createElement('div');
  pageEl.className = 'ssv-page';
  pageEl.style.width = `${Math.floor(viewport.width)}px`;
  pageEl.style.height = `${Math.floor(viewport.height)}px`;
  // PDF.js text layer positions its spans using these CSS variables.
  pageEl.style.setProperty('--scale-factor', String(scale));
  pageEl.style.setProperty('--total-scale-factor', String(scale));
  pagesEl.appendChild(pageEl);
  const annotationLayers = createPageLayers(pageEl, unscaled.width, unscaled.height);
  pageInfos.push({ el: pageEl, scale, pageIndex: pageNum, annotationLayers });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  pageEl.appendChild(canvas);

  const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
  await page.render({ canvas, canvasContext: ctx, viewport, transform }).promise;

  // Decide between the fast embedded-text path and the OCR fallback. A scanned
  // / photocopied page yields little or no text content here.
  const textContent = await page.getTextContent();
  const embeddedLen = textContent.items
    .map((it) => ('str' in it ? it.str : ''))
    .join('')
    .replace(/\s+/g, '')
    .length;

  if (embeddedLen >= EMBEDDED_TEXT_MIN) {
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    pageEl.appendChild(textLayerDiv);

    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport,
    });
    await textLayer.render();
    return;
  }

  // Scanned page: defer OCR until all pages have painted.
  const badge = document.createElement('div');
  badge.className = 'ssv-ocr-badge';
  badge.textContent = 'Scanned page';
  pageEl.appendChild(badge);
  ocrQueue.push({ pageEl, canvas, badge, pageIndex: pageNum, scale, outputScale });
}

// Lay a transparent, selectable overlay of OCR'd words over the page image so
// window.getSelection() -- and therefore pluck -- returns real text. Words are
// in scale-independent page-point coords; multiplying by the current render
// scale gives CSS pixels. Each word is width-fitted with a scaleX transform
// (as PDF.js does) so the selection highlight tracks the printed glyphs.
function buildOcrLayer(pageEl: HTMLElement, words: OcrWord[], scale: number): void {
  const layer = document.createElement('div');
  layer.className = 'ssv-ocr-layer';
  const fit: Array<{ span: HTMLSpanElement; targetW: number }> = [];

  for (const wd of words) {
    const w = (wd.x1 - wd.x0) * scale;
    const h = (wd.y1 - wd.y0) * scale;
    if (w <= 0 || h <= 0) continue;
    const span = document.createElement('span');
    span.textContent = wd.text;
    span.style.left = `${wd.x0 * scale}px`;
    span.style.top = `${wd.y0 * scale}px`;
    span.style.height = `${h}px`;
    span.style.fontSize = `${Math.max(6, h * 0.82)}px`;
    layer.appendChild(span);
    // A space between words so a multi-word selection reads naturally.
    layer.appendChild(document.createTextNode(' '));
    fit.push({ span, targetW: w });
  }

  pageEl.appendChild(layer);

  // Batch all reads before any writes to force a single layout pass.
  const naturals = fit.map((f) => f.span.getBoundingClientRect().width);
  fit.forEach((f, i) => {
    const natural = naturals[i];
    if (natural > 0) f.span.style.transform = `scaleX(${f.targetW / natural})`;
  });
}

// Tesseract returns boxes in the canvas' pixel space (page points * scale *
// outputScale). Divide back out to page points so the cached result is
// independent of this render's zoom / device pixel ratio.
function toPagePoints(words: OcrWord[], divisor: number): OcrWord[] {
  if (divisor <= 0) return words;
  return words.map((w) => ({
    text: w.text,
    x0: w.x0 / divisor,
    y0: w.y0 / divisor,
    x1: w.x1 / divisor,
    y1: w.y1 / divisor,
  }));
}

// ----- Saved-text highlights -------------------------------------------------

function pageAtClientPoint(clientX: number, clientY: number): PageInfo | null {
  for (const p of pageInfos) {
    const r = p.el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return p;
    }
  }
  return null;
}

function ensureHighlightLayer(pageEl: HTMLElement): HTMLElement {
  let layer = pageEl.querySelector<HTMLElement>('.ssv-hl-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'ssv-hl-layer';
    pageEl.appendChild(layer);
  }
  return layer;
}

// Paint one highlight's boxes onto its page. Boxes are pointer-events:none so
// they never interfere with pluck selection; hover is handled by a global
// mousemove hit-test instead.
function drawHighlight(page: PageInfo, hl: StoredHighlight): void {
  const layer = ensureHighlightLayer(page.el);
  for (const r of hl.rects) {
    const box = document.createElement('div');
    box.className = 'ssv-hl-box';
    box.style.left = `${r.x * page.scale}px`;
    box.style.top = `${r.y * page.scale}px`;
    box.style.width = `${r.w * page.scale}px`;
    box.style.height = `${r.h * page.scale}px`;
    layer.appendChild(box);
  }
}

function indexHighlight(hl: StoredHighlight): void {
  const list = highlightsByPage.get(hl.pageIndex);
  if (list) list.push(hl);
  else highlightsByPage.set(hl.pageIndex, [hl]);
}

// Called by pluckMode after a successful save. Maps the client-space capture
// rects onto the page they landed on, stores them in page points, paints the
// highlight, and persists it for next time.
function handleCapture(info: CaptureInfo): void {
  const first = info.rects[0];
  if (!first) return;
  const page = pageAtClientPoint(first.left + first.width / 2, first.top + first.height / 2);
  if (!page) return;

  const pr = page.el.getBoundingClientRect();
  const rects = info.rects
    .map((r) => ({
      x: (r.left - pr.left) / page.scale,
      y: (r.top - pr.top) / page.scale,
      w: r.width / page.scale,
      h: r.height / page.scale,
    }))
    .filter((r) => r.w > 0 && r.h > 0);
  if (rects.length === 0) return;

  const hl: StoredHighlight = {
    id: crypto.randomUUID(),
    docId: currentDocId,
    pageIndex: page.pageIndex,
    text: info.text,
    rects,
    createdAt: Date.now(),
    translation: info.translation,
    senses: info.senses,
    derivedForms: info.derivedForms,
  };
  indexHighlight(hl);
  drawHighlight(page, hl);
  void putHighlight(hl);
}

async function loadHighlights(docId: string): Promise<void> {
  const hls = await getHighlightsForDoc(docId);
  for (const hl of hls) {
    indexHighlight(hl);
    const page = pageInfos.find((p) => p.pageIndex === hl.pageIndex);
    if (page) drawHighlight(page, hl);
  }
}

// ----- Hover popup -----------------------------------------------------------

function posLabel(pos: DictionarySense['pos']): string {
  switch (pos) {
    case 'noun': return 'noun';
    case 'verb': return 'verb';
    case 'adjective': return 'adj';
    case 'adverb': return 'adv';
    case 'pronoun': return 'pron';
    case 'preposition': return 'prep';
    case 'conjunction': return 'conj';
    case 'interjection': return 'interj';
    default: return '';
  }
}

let hoverPopupEl: HTMLElement | null = null;
let hoverPopupForId: string | null = null;

function ensureHoverPopup(): HTMLElement {
  if (hoverPopupEl) return hoverPopupEl;
  const el = document.createElement('div');
  el.id = 'ssv-hl-popup';
  el.hidden = true;
  document.body.appendChild(el);
  hoverPopupEl = el;
  return el;
}

function renderPopupContent(el: HTMLElement, hl: StoredHighlight): void {
  el.replaceChildren();

  const title = document.createElement('div');
  title.className = 'ssv-hl-pop-title';
  title.textContent = hl.text;
  el.appendChild(title);

  if (hl.translation && hl.translation.trim()) {
    const tr = document.createElement('div');
    tr.className = 'ssv-hl-pop-translation';
    tr.textContent = hl.translation.trim();
    el.appendChild(tr);
  }

  for (const sense of hl.senses ?? []) {
    const display = sense.terms.join(', ');
    if (!display) continue;
    const label = posLabel(sense.pos);
    const row = document.createElement('div');
    row.className = 'ssv-hl-pop-sense';
    row.textContent = label ? `(${label}) ${display}` : display;
    el.appendChild(row);
  }

  const forms = hl.derivedForms ?? [];
  if (forms.length > 0) {
    const parts = forms
      .map((f) => {
        const label = posLabel(f.pos);
        return label ? `${f.word} (${label})` : f.word;
      })
      .filter(Boolean);
    if (parts.length > 0) {
      const family = document.createElement('div');
      family.className = 'ssv-hl-pop-family';
      family.textContent = `family: ${parts.join(' . ')}`;
      el.appendChild(family);
    }
  }
}

function hideHoverPopup(): void {
  if (hoverPopupEl && !hoverPopupEl.hidden) {
    hoverPopupEl.hidden = true;
  }
  hoverPopupForId = null;
}

function showHoverPopup(hl: StoredHighlight, clientX: number, clientY: number): void {
  const el = ensureHoverPopup();
  if (hoverPopupForId !== hl.id) {
    renderPopupContent(el, hl);
    hoverPopupForId = hl.id;
  }
  el.hidden = false;

  // Position below-right of the cursor, clamped into the viewport; flip above
  // when near the bottom edge.
  const margin = 12;
  const rect = el.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY + 16;
  if (left + rect.width + margin > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - rect.width - margin);
  }
  if (top + rect.height + margin > window.innerHeight) {
    top = clientY - rect.height - 12;
  }
  if (top < margin) top = margin;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function onHoverMove(e: MouseEvent): void {
  if (!savedHighlightHoverEnabled) {
    hideHoverPopup();
    return;
  }
  // Suppress while pluck is armed (Alt held) so the popup doesn't fight the
  // selection the user is making.
  if (e.altKey) {
    hideHoverPopup();
    return;
  }
  if (highlightsByPage.size === 0) return;
  const page = pageAtClientPoint(e.clientX, e.clientY);
  if (!page) {
    hideHoverPopup();
    return;
  }
  const list = highlightsByPage.get(page.pageIndex);
  if (!list || list.length === 0) {
    hideHoverPopup();
    return;
  }
  const pr = page.el.getBoundingClientRect();
  const px = (e.clientX - pr.left) / page.scale;
  const py = (e.clientY - pr.top) / page.scale;
  const hit = list.find((hl) =>
    hl.rects.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h),
  );
  if (hit) showHoverPopup(hit, e.clientX, e.clientY);
  else hideHoverPopup();
}

document.addEventListener('mousemove', onHoverMove);

// A small status pill in the top bar reporting OCR progress across the doc.
let ocrStatusEl: HTMLElement | null = null;
function setOcrStatus(text: string | null): void {
  if (text === null) {
    ocrStatusEl?.remove();
    ocrStatusEl = null;
    return;
  }
  if (!ocrStatusEl) {
    ocrStatusEl = document.createElement('div');
    ocrStatusEl.id = 'ssv-ocr-status';
    barEl.appendChild(ocrStatusEl);
  }
  ocrStatusEl.textContent = text;
}

async function runOcr(docId: string): Promise<void> {
  if (ocrQueue.length === 0) return;

  // Cache-first: fill pages we've OCR'd before (instant) and collect the rest.
  const misses: OcrTask[] = [];
  for (const task of ocrQueue) {
    let cached: OcrWord[] | null = null;
    try {
      cached = await getCachedOcr(ocrCacheKey(docId, task.pageIndex));
    } catch {
      cached = null;
    }
    if (cached) {
      buildOcrLayer(task.pageEl, cached, task.scale);
      task.badge.remove();
    } else {
      misses.push(task);
    }
  }

  // Every scanned page was cached: nothing to recognize, so never spin up the
  // (slow) OCR engine.
  if (misses.length === 0) return;

  const total = misses.length;
  setOcrStatus(`Scanned document - reading text (0/${total})`);

  let engine;
  try {
    engine = await getOcrEngine();
  } catch (err) {
    console.error('[ScrollLearn:pdfviewer] OCR engine failed to load:', err);
    for (const task of misses) task.badge.textContent = 'OCR unavailable';
    setOcrStatus('OCR unavailable');
    setTimeout(() => setOcrStatus(null), 4000);
    return;
  }

  for (let i = 0; i < misses.length; i++) {
    const task = misses[i];
    task.badge.textContent = 'Reading text...';
    try {
      const raw = await engine.recognize(task.canvas, (p) => {
        task.badge.textContent = `Reading text ${Math.round(p * 100)}%`;
      });
      const words = toPagePoints(raw, task.scale * task.outputScale);
      buildOcrLayer(task.pageEl, words, task.scale);
      task.badge.remove();
      // Persist so the next open of this document is instant.
      void putCachedOcr(ocrCacheKey(docId, task.pageIndex), words);
    } catch (err) {
      console.error('[ScrollLearn:pdfviewer] OCR failed on page:', err);
      task.badge.textContent = 'OCR failed';
    }
    setOcrStatus(`Scanned document - reading text (${i + 1}/${total})`);
  }

  try {
    await engine.terminate();
  } catch {
    // best-effort teardown
  }
  setOcrStatus('Text ready - hold Option/Alt to capture');
  setTimeout(() => setOcrStatus(null), 4000);
}

async function main(): Promise<void> {
  const src = new URLSearchParams(location.search).get('src');
  if (!src) {
    showStatus(`
      <h2>No PDF specified</h2>
      <p>Open a local PDF from the ScrollLearn popup, or add
      <code>?src=&lt;file url&gt;</code> to this page's address.</p>
    `);
    return;
  }

  const fileName = fileNameFromSrc(src);
  document.title = fileName;
  fileEl.textContent = fileName;
  fileEl.title = (() => {
    try {
      return decodeURIComponent(src);
    } catch {
      return src;
    }
  })();
  annotationToolbar = mountAnnotationToolbar(immediateToolbarController);

  try {
    const loadingTask = pdfjsLib.getDocument({
      url: src,
      // file:// does not support HTTP range/streaming; fetch the whole file.
      disableStream: true,
      disableRange: true,
    });
    const pdf = await loadingTask.promise;

    const fitWidth = Math.max(320, pagesEl.clientWidth - 24);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      await renderPage(page, fitWidth, i);
    }

    // Key the OCR cache + highlights by the PDF's content fingerprint (stable
    // across moves/renames), falling back to the source URL if unavailable.
    const docId = pdf.fingerprints?.[0] ?? src;
    currentDocId = docId;

    // Restore previously saved highlights before OCR so they appear as soon as
    // the pages are visible.
    await loadHighlights(docId);

    annotationController = await initAnnotationController(docId, pageInfos, pluckControls);
    annotationController.setTool(annotationToolbar.getState());
    annotationController.setHistoryStateListener((canUndo, canRedo) => {
      annotationToolbar?.setHistoryState(canUndo, canRedo);
    });

    // OCR any scanned pages after the whole document has painted so the reader
    // isn't blocked on the (slow) recognition of image-only pages. Cached pages
    // fill in instantly; only never-seen pages hit Tesseract.
    await runOcr(docId);
  } catch (err) {
    console.error('[ScrollLearn:pdfviewer] failed to load PDF:', err);
    // The overwhelmingly common failure for a file:// src is the missing
    // file-access permission, so lead with that fix.
    if (src.startsWith('file:')) {
      showFileAccessHelp();
    } else {
      showStatus(`
        <h2>Couldn't open this PDF</h2>
        <p>${String(err instanceof Error ? err.message : err)}</p>
      `);
    }
  }
}

window.addEventListener('pagehide', () => {
  annotationToolbar?.destroy();
  annotationToolbar = null;
  annotationController?.destroy();
  annotationController = null;
  unmountPluck();
  document.removeEventListener('mousemove', onHoverMove);
  hideHoverPopup();
}, { once: true });

void main();
