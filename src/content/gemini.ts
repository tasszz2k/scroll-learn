// Gemini automation content script.
// Picks up a pending job written to chrome.storage.local by the dashboard,
// pastes the prompt into Gemini's input, submits, waits for the response to
// finish streaming, extracts the CSV, and reports back via runtime messages.

import type { GeminiJob, GeminiJobStage } from '../common/types';
import { extractMarkdownLite } from './geminiMarkdown';

const JOB_KEY = 'geminiJob';
const JOB_TTL_MS = 5 * 60 * 1000;

const EDITOR_SELECTORS = [
  'rich-textarea div[contenteditable="true"]',
  '[role="textbox"][contenteditable="true"]',
  '[contenteditable="true"]',
];

const SEND_BUTTON_SELECTORS = [
  'button[aria-label*="Send message" i]',
  'button[aria-label*="Send" i]',
  'button.send-button',
];

const STOP_BUTTON_SELECTORS = [
  'button[aria-label*="Stop response" i]',
  'button[aria-label*="Stop streaming" i]',
  'button[aria-label*="Stop" i]',
  'button.stop',
  'button.send-button-stop',
];

const RESPONSE_SELECTORS = [
  // Gemini renders bot messages inside <model-response>. Most precise targets
  // come first; broader fallbacks last so we still pick something up after a
  // DOM tweak.
  'model-response message-content .markdown',
  'model-response message-content',
  'message-content .markdown',
  '.model-response-text',
  '.response-content .markdown',
  '.bard-response',
  '.response-container .markdown',
  'model-response',
];

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function postStatus(jobId: string, stage: GeminiJobStage, detail?: string): void {
  try {
    chrome.runtime.sendMessage({ type: 'gemini_job_status', jobId, stage, detail }).catch(() => {
      /* dashboard may have closed; ignore */
    });
  } catch {
    /* extension context invalidated */
  }
}

function postResult(
  payload:
    | { jobId: string; ok: true; csv: string; raw: string }
    | { jobId: string; ok: true; text: string }
    | { jobId: string; ok: false; error: string }
): void {
  try {
    chrome.runtime.sendMessage({ type: 'gemini_result', ...payload }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}

function postStreamChunk(jobId: string, text: string, done: boolean): void {
  try {
    chrome.runtime.sendMessage({ type: 'gemini_stream_chunk', jobId, text, done }).catch(() => {
      /* dashboard may have closed; ignore */
    });
  } catch {
    /* extension context invalidated */
  }
}

function querySome<T extends Element = HTMLElement>(selectors: string[], filter?: (el: Element) => boolean): T | null {
  for (const sel of selectors) {
    const list = document.querySelectorAll(sel);
    for (const el of Array.from(list)) {
      if (!filter || filter(el)) return el as unknown as T;
    }
  }
  return null;
}

function isVisible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el as HTMLElement);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function findEditor(): HTMLElement | null {
  return querySome<HTMLElement>(EDITOR_SELECTORS, isVisible);
}

function findSendButton(): HTMLButtonElement | null {
  return querySome<HTMLButtonElement>(SEND_BUTTON_SELECTORS, el => {
    const btn = el as HTMLButtonElement;
    return isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
  });
}

function findStopButton(): HTMLButtonElement | null {
  return querySome<HTMLButtonElement>(STOP_BUTTON_SELECTORS, isVisible);
}

// Snapshot the per-selector count of response elements present before we send
// a prompt. On follow-up turns the previous answer is still in the DOM, so a
// naive "querySelectorAll(...).length > 0" stream-loop would dump the prior
// answer as the first chunk before the new <model-response> even appears.
type ResponseBaseline = ReadonlyMap<string, number>;

function snapshotResponseBaseline(): ResponseBaseline {
  const m = new Map<string, number>();
  for (const sel of RESPONSE_SELECTORS) {
    m.set(sel, document.querySelectorAll(sel).length);
  }
  return m;
}

function findLatestResponse(baseline: ResponseBaseline): HTMLElement | null {
  // Return the latest response element ONLY if a fresh one has appeared since
  // baseline was captured. We try selectors in priority order; for each one,
  // we require list.length > baseline[sel] so we never read a stale prior turn.
  for (const sel of RESPONSE_SELECTORS) {
    const list = document.querySelectorAll(sel);
    const base = baseline.get(sel) ?? 0;
    if (list.length > base) return list[list.length - 1] as HTMLElement;
  }
  return null;
}

async function waitFor<T>(probe: () => T | null, timeoutMs: number, intervalMs = 250): Promise<T | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = probe();
    if (v) return v;
    await sleep(intervalMs);
  }
  return null;
}

async function pasteIntoEditor(editor: HTMLElement, text: string): Promise<void> {
  editor.focus();
  // Clear any placeholder / leftover draft content. On a follow-up Gemini
  // already cleared the editor after the previous Send, but we still
  // defensively clear in case it left a partial draft.
  try {
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand('delete', false);
  } catch {
    /* ignore */
  }

  // We deliberately use a SINGLE insertion strategy here.
  //
  // The previous implementation tried a synthetic ClipboardEvent first and
  // then fell back to execCommand('insertText') if a sync check showed no
  // text had landed. Gemini's paste handler is asynchronous AND calls
  // preventDefault() in its own handler, so the sync check always fired
  // before the text landed. The fallback then ran execCommand a moment
  // before Gemini's async paste handler also inserted -- producing a
  // perfectly doubled prompt. Polling for async-paste completion before
  // falling through is brittle (the handler can take >100ms on long
  // prompts, especially during Gemini's first-time editor warm-up).
  //
  // execCommand('insertText') alone is synchronous, fires beforeinput +
  // input events that Angular / Gemini's input model picks up, and never
  // double-inserts. It's the path that the legacy "cards" import has been
  // relying on in practice (the ClipboardEvent path was usually a no-op
  // for synthetic events).
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (inserted && (editor.innerText || '').trim().length > 0) return;

  // Last-ditch fallback for unusual contenteditable shells where
  // execCommand is unavailable (e.g. some browser quirks). Write directly
  // and fire an input event so frameworks notice the change.
  editor.textContent = text;
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
}

function extractCSV(raw: string): string {
  // Pull the largest fenced code block if present — strip the fence.
  const fenceRe = /```[a-zA-Z]*\n([\s\S]*?)```/g;
  let bestBlock = '';
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    if (m[1].length > bestBlock.length) bestBlock = m[1];
  }
  let body = bestBlock || raw;

  // If there is a CSV header somewhere, anchor on it.
  const headerIdx = body.search(/^deck,kind,front,back/m);
  if (headerIdx > 0) body = body.slice(headerIdx);

  return body.trim();
}

// Watch the latest response element and forward incremental snapshots until
// streaming stops. The Gemini DOM exposes the partial text as it grows, so a
// tight poll is enough to look like real streaming on the dashboard side.
//
// Termination logic (priority order):
//   1. Hard 4-minute timeout - throws so the dashboard can show a clear error.
//   2. Stop button observed once and now gone - streaming finished cleanly.
//   3. Quiescence: text has appeared and stopped changing for QUIESCENCE_MS -
//      take what we have. Covers the case where the stop button selector is
//      stale on a Gemini DOM update.
//   4. No-signal timeout: nothing in the response area for NO_SIGNAL_TIMEOUT_MS.
//      Gemini sometimes takes 15-25s before the first token lands, so the
//      window has to be generous; only after that should we give up.
async function streamResponse(jobId: string, baseline: ResponseBaseline): Promise<string> {
  let last = '';
  let stopSeen = false;
  let lastChangeAt = Date.now();
  const start = Date.now();
  // Once non-empty text has stopped changing this long, treat as done.
  const QUIESCENCE_MS = 3000;
  // Generous wait for the first token to appear. Long-form prompts routinely
  // sit in "thinking" for 15-25s before any text shows up.
  const NO_SIGNAL_TIMEOUT_MS = 60000;
  const HARD_LIMIT_MS = 4 * 60 * 1000;

  while (Date.now() - start < HARD_LIMIT_MS) {
    const el = findLatestResponse(baseline);
    // Walk the rendered DOM to recover markdown-lite (bold, bullets,
    // paragraphs). Falling back to innerText loses all formatting.
    const text = el ? extractMarkdownLite(el) : '';
    if (text && text !== last) {
      last = text;
      lastChangeAt = Date.now();
      postStreamChunk(jobId, text, false);
    }

    const stopVisible = findStopButton() !== null;
    if (stopVisible) {
      stopSeen = true;
    } else if (stopSeen && last) {
      // Stop button vanished after we saw it: streaming finished cleanly.
      break;
    } else if (last && Date.now() - lastChangeAt > QUIESCENCE_MS) {
      // Text has stabilized; the stop-button selector may be stale, but we
      // have a good final snapshot already.
      break;
    } else if (!last && Date.now() - start > NO_SIGNAL_TIMEOUT_MS) {
      throw new Error(
        'Gemini did not produce a response within 60s. The response selectors may be out of date, or the prompt was rejected. Check the open Gemini tab.',
      );
    }

    await sleep(250);
  }

  if (Date.now() - start >= HARD_LIMIT_MS) {
    throw new Error('Gemini response timed out after 4 minutes.');
  }

  // Settle so any final tokens land in the DOM, then send a final snapshot.
  // Prefer whichever read has more content; the post-settle read can briefly
  // see a transient empty state if Gemini swaps containers as it finalizes.
  await sleep(500);
  const settledEl = findLatestResponse(baseline);
  const settled = settledEl ? extractMarkdownLite(settledEl) : '';
  const finalText = settled.length >= last.length ? settled : last;
  postStreamChunk(jobId, finalText, true);
  return finalText;
}

async function processJob(job: GeminiJob): Promise<void> {
  const { jobId, prompt } = job;
  const mode = job.mode ?? 'cards';
  postStatus(jobId, 'opening');

  try {
    const editor = await waitFor(findEditor, 20000);
    if (!editor) {
      throw new Error('Could not find Gemini input. Make sure you are signed in to gemini.google.com.');
    }

    postStatus(jobId, 'pasting');
    await pasteIntoEditor(editor, prompt);
    await sleep(200);

    // Snapshot how many response elements exist BEFORE we send. On follow-up
    // turns the previous answer is still in the DOM; without this baseline the
    // streamer would re-publish the prior answer as the first "chunk" of the
    // new turn (the bug: previous answer dumped, then new response generated).
    const responseBaseline = snapshotResponseBaseline();

    postStatus(jobId, 'submitting');
    const sendBtn = await waitFor(findSendButton, 8000);
    if (!sendBtn) throw new Error('Send button never enabled. Gemini may have rejected the prompt.');
    sendBtn.click();

    postStatus(jobId, 'streaming');

    if (mode === 'explain') {
      // Live-stream the textual response straight to the dashboard. No CSV
      // extraction, no fence stripping — explain output is rendered as
      // markdown-lite in the UI.
      const finalText = await streamResponse(jobId, responseBaseline);
      if (!finalText) throw new Error('Gemini response was empty.');
      postResult({ jobId, ok: true, text: finalText });
      postStatus(jobId, 'done');
      return;
    }

    // 'cards' mode: stream the in-flight response so the dashboard can show
    // a live preview, then extract a CSV from the final text. Reuses the same
    // streamer as explain mode -- the only difference is what we do with the
    // completed text.
    const finalRaw = await streamResponse(jobId, responseBaseline);
    if (!finalRaw) throw new Error('Gemini response was empty.');

    postStatus(jobId, 'extracting');
    const csv = extractCSV(finalRaw);
    postResult({ jobId, ok: true, csv, raw: finalRaw });
    postStatus(jobId, 'done');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postResult({ jobId, ok: false, error: message });
    postStatus(jobId, 'error', message);
  }
}

// One job at a time per tab. Set whenever processJob is running so a
// late-arriving follow-up doesn't start a second concurrent paste/send.
let processing = false;
// Track the last job id we ran so we ignore duplicate storage events (the
// claim-and-remove dance fires onChanged with newValue=undefined; we already
// filter those, but this also guards against re-emit of the same value).
let lastProcessedJobId: string | null = null;

async function tryProcess(job: GeminiJob): Promise<void> {
  if (processing) return;
  if (!job.jobId || !job.prompt) return;
  if (Date.now() - (job.createdAt ?? 0) > JOB_TTL_MS) return;
  if (lastProcessedJobId === job.jobId) return;
  lastProcessedJobId = job.jobId;
  processing = true;
  try {
    await processJob(job);
  } finally {
    processing = false;
  }
}

async function bootstrap(): Promise<void> {
  let stored: { [k: string]: unknown };
  try {
    stored = await chrome.storage.local.get(JOB_KEY);
  } catch {
    return;
  }
  const job = stored[JOB_KEY] as GeminiJob | undefined;
  if (!job) return;
  if (Date.now() - (job.createdAt ?? 0) > JOB_TTL_MS) {
    await chrome.storage.local.remove(JOB_KEY);
    return;
  }
  // Claim the job so a reload doesn't double-process it.
  await chrome.storage.local.remove(JOB_KEY);
  await tryProcess(job);
}

// Pick up follow-up jobs the dashboard writes after the initial bootstrap.
// The dashboard reuses this tab for chat continuity, so we keep listening
// for new geminiJob entries throughout the tab's lifetime.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const change = changes[JOB_KEY];
  if (!change || !change.newValue) return;
  const job = change.newValue as GeminiJob;
  // Claim immediately so the bootstrap of any reloaded sibling doesn't
  // double-process the same follow-up.
  void chrome.storage.local.remove(JOB_KEY);
  void tryProcess(job);
});

void bootstrap();
