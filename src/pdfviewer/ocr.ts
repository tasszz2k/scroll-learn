// OCR engine for the in-extension PDF viewer.
//
// Scanned / photocopied PDFs carry only a page *image*, so PDF.js
// getTextContent() returns nothing and there is no text to select. Chrome's
// native viewer papers over this by OCR-ing the image; we do the same with a
// bundled Tesseract.js so a selectable word overlay can be built and Alt-pluck
// keeps working.
//
// Everything Tesseract needs is shipped under public/tesseract/ so nothing is
// fetched from a CDN at runtime (the extension_pages CSP forbids remote
// script, and the user may well be offline reading a local file):
//   * worker.min.js               -- the worker entry (loaded same-origin)
//   * tesseract-core-simd-lstm.*  -- the LSTM SIMD core (glue + .wasm)
//   * eng.traineddata.gz          -- English language data
//
// We pass corePath as the explicit *.wasm.js file (not a directory) so
// getCore() skips its relaxed-SIMD probe -- that probe would otherwise try to
// importScripts a relaxedsimd core we deliberately do not bundle. The
// emscripten glue then resolves its sibling .wasm relative to worker.min.js,
// which lives in the same folder.

import { createWorker } from 'tesseract.js';

export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type TessWorker = Awaited<ReturnType<typeof createWorker>>;

export interface OcrEngine {
  // Recognize the whole canvas and return words in reading order with their
  // pixel bounding boxes (in the canvas' own pixel space).
  recognize(
    canvas: HTMLCanvasElement,
    onProgress?: (fraction: number) => void,
  ): Promise<OcrWord[]>;
  terminate(): Promise<void>;
}

// One worker is created lazily and reused for every scanned page in the
// document; spinning it up (core + traineddata) costs a few seconds, so we
// never do it unless a page actually needs OCR.
let enginePromise: Promise<OcrEngine> | null = null;

export function getOcrEngine(): Promise<OcrEngine> {
  if (!enginePromise) {
    enginePromise = createEngine().catch((err) => {
      // Reset so a later page can retry a fresh spin-up.
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

async function createEngine(): Promise<OcrEngine> {
  let progressCb: ((fraction: number) => void) | null = null;

  // OEM 1 = LSTM_ONLY, matching the *-lstm core we bundle.
  const worker: TessWorker = await createWorker('eng', 1, {
    workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('tesseract/tesseract-core-simd-lstm.wasm.js'),
    langPath: chrome.runtime.getURL('tesseract/'),
    // Load the worker straight from its extension-origin URL; a blob: worker
    // would trip the extension_pages CSP.
    workerBlobURL: false,
    legacyCore: false,
    legacyLang: false,
    logger: (m) => {
      if (m.status === 'recognizing text' && progressCb) progressCb(m.progress);
    },
  });

  return {
    async recognize(canvas, onProgress) {
      progressCb = onProgress ?? null;
      try {
        // blocks:true is required -- the default output omits word geometry.
        const { data } = await worker.recognize(canvas, {}, { blocks: true });
        const words: OcrWord[] = [];
        for (const block of data.blocks ?? []) {
          for (const para of block.paragraphs) {
            for (const line of para.lines) {
              for (const w of line.words) {
                const text = (w.text || '').trim();
                if (!text) continue;
                words.push({
                  text,
                  x0: w.bbox.x0,
                  y0: w.bbox.y0,
                  x1: w.bbox.x1,
                  y1: w.bbox.y1,
                });
              }
            }
          }
        }
        return words;
      } finally {
        progressCb = null;
      }
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
