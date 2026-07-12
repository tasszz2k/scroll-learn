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
import { mountPluckMode } from '../common/pluckMode';
import { getOcrEngine, type OcrWord } from './ocr';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs');

const pagesEl = document.getElementById('ssv-pages') as HTMLElement;
const statusEl = document.getElementById('ssv-status') as HTMLElement;
const fileEl = document.getElementById('ssv-file') as HTMLElement;
const barEl = document.getElementById('ssv-bar') as HTMLElement;

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
  // canvas-pixel -> CSS-pixel scale for positioning the word overlay.
  invScale: number;
}
const ocrQueue: OcrTask[] = [];

// Pluck capture is active for the whole reading session. Selection over the
// text layer wins over element capture inside pluckMode, so highlighting words
// and releasing Alt saves exactly the selected run.
mountPluckMode();

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
  ocrQueue.push({ pageEl, canvas, badge, invScale: 1 / outputScale });
}

// Lay a transparent, selectable overlay of OCR'd words over the page image so
// window.getSelection() -- and therefore pluck -- returns real text. Word
// boxes come back in the canvas' pixel space, so scale them to CSS pixels.
// Each word is width-fitted with a scaleX transform (as PDF.js does) so the
// selection highlight tracks the printed glyphs.
function buildOcrLayer(pageEl: HTMLElement, words: OcrWord[], invScale: number): void {
  const layer = document.createElement('div');
  layer.className = 'ssv-ocr-layer';
  const fit: Array<{ span: HTMLSpanElement; targetW: number }> = [];

  for (const wd of words) {
    const w = (wd.x1 - wd.x0) * invScale;
    const h = (wd.y1 - wd.y0) * invScale;
    if (w <= 0 || h <= 0) continue;
    const span = document.createElement('span');
    span.textContent = wd.text;
    span.style.left = `${wd.x0 * invScale}px`;
    span.style.top = `${wd.y0 * invScale}px`;
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

async function runOcr(): Promise<void> {
  if (ocrQueue.length === 0) return;
  const total = ocrQueue.length;
  setOcrStatus(`Scanned document - reading text (0/${total})`);

  let engine;
  try {
    engine = await getOcrEngine();
  } catch (err) {
    console.error('[ScrollLearn:pdfviewer] OCR engine failed to load:', err);
    for (const task of ocrQueue) task.badge.textContent = 'OCR unavailable';
    setOcrStatus('OCR unavailable');
    setTimeout(() => setOcrStatus(null), 4000);
    return;
  }

  for (let i = 0; i < ocrQueue.length; i++) {
    const task = ocrQueue[i];
    task.badge.textContent = 'Reading text...';
    try {
      const words = await engine.recognize(task.canvas, (p) => {
        task.badge.textContent = `Reading text ${Math.round(p * 100)}%`;
      });
      buildOcrLayer(task.pageEl, words, task.invScale);
      task.badge.remove();
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
      await renderPage(page, fitWidth);
    }

    // OCR any scanned pages after the whole document has painted so the reader
    // isn't blocked on the (slow) recognition of image-only pages.
    await runOcr();
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

void main();
