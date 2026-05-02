// Single entry point for every AI surface (Generate quiz, Ask, Explain, Shadow
// script, Pronunciation check, sidebar Chat). Picks between two transports:
//
//   - API (preferred when the user has supplied an AI Studio key): direct REST
//     + SSE call to generativelanguage.googleapis.com via api.ts. No browser
//     window opens; usage is bookkept per-model in quota.ts.
//   - Web fallback (always available): writes a job to chrome.storage.local,
//     opens gemini.google.com, lets src/content/gemini.ts paste/submit/scrape.
//
// Hooks call this module exactly the same way regardless of which path runs;
// the router emits stage + chunk callbacks that match the existing
// GeminiJobStage / gemini_stream_chunk contract so GeminiProgressBanner needs
// no refactor.
//
// Personal-context handling: settings.geminiPersonalContext is sent as
// systemInstruction on the API path (clean separation from the prompt itself)
// and prepended to the FIRST-TURN prompt on the web path. On follow-up turns
// we don't re-prepend -- the open Gemini window already has the framing in
// its chat history.

import { getSettings } from '../storage';
import type { GeminiJob, GeminiJobAudio, GeminiJobStage, GeminiJobMode } from '../types';
import {
  closeGeminiWindow,
  isGeminiWindowAlive,
  openGeminiWindow,
  type GeminiWindowHandle,
} from '../../dashboard/utils/geminiTab';
import {
  runGeminiApi,
  type ApiAudio,
  type ApiHistoryTurn,
} from './api';
import { markRateLimited, pickModel, recordSuccess } from './quota';
import type { GeminiApiModelId } from '../types';

export interface JobAudio {
  base64: string;
  mimeType: string;
  filename: string;
}

export interface ConversationTurn {
  role: 'user' | 'model';
  text: string;
}

export interface JobSpec {
  prompt: string;
  mode: GeminiJobMode;
  // Multi-turn surfaces pass prior turns so the API path can include them in
  // contents. Web path uses an open window for chat continuity instead.
  history?: ConversationTurn[];
  audio?: JobAudio;
  // Identifies the assistant subject (e.g. a card / note id). Only used by
  // the web path to decide whether to reuse an existing Gemini window. For
  // single-shot surfaces (Generate quiz, Shadow script, Pronunciation check)
  // pass undefined -- those always open + close their own window.
  contextKey?: string;
}

export interface JobCallbacks {
  onStage?: (stage: GeminiJobStage, detail?: string) => void;
  onChunk?: (snapshot: string) => void;
  // Fired once, as soon as the router commits to a path. Lets the progress
  // banner show an "API" / "Browser" pill (and the active model name on api).
  onSource?: (source: 'api' | 'web', model?: GeminiApiModelId) => void;
}

export interface RunOk {
  ok: true;
  source: 'api' | 'web';
  // Final raw response text. Always set, regardless of mode.
  text: string;
  // 'cards' mode only: CSV extracted from `text`.
  csv?: string;
  raw?: string;
  // Set when source === 'api'. Lets the banner annotate which model answered.
  model?: GeminiApiModelId;
}

export interface RunErr {
  ok: false;
  source: 'api' | 'web';
  error: string;
}

export type RunResult = RunOk | RunErr;

// Match the legacy timeout in src/content/gemini.ts -- we hand off to the
// content script and rely on it to time out, so the router only needs a
// safety net around the chrome.runtime listener registration.
const WEB_HARD_TIMEOUT_MS = 5 * 60 * 1000;

// ---------- web window handles, keyed by contextKey ----------
// The assist hook reuses the same Gemini chat window for follow-ups about
// the same subject so the model has the prior turns in its context. Single-
// shot surfaces pass contextKey === undefined and use a transient handle
// stored under the sentinel below.
const TRANSIENT_KEY = '__transient__';
const handles = new Map<string, GeminiWindowHandle>();

function key(contextKey: string | undefined): string {
  return contextKey ?? TRANSIENT_KEY;
}

export async function closeGeminiContext(contextKey?: string): Promise<void> {
  const k = key(contextKey);
  const h = handles.get(k);
  handles.delete(k);
  if (h) await closeGeminiWindow(h);
}

// Best-effort cleanup if the dashboard closes mid-conversation. The legacy
// useGeminiAssist installed the same handler -- keeping it here means there
// is exactly one place that owns Gemini-window lifecycles.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const [, h] of handles) void closeGeminiWindow(h);
    handles.clear();
  });
}

// ---------- helpers ----------

function generateJobId(): string {
  return `gemini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Lifted from src/content/gemini.ts -- extracts the CSV body from a response
// that may or may not be wrapped in fenced code blocks. Used by the API path
// for 'cards' mode so callers see the same { csv, raw } shape they used to
// receive via gemini_result on the web path.
export function extractCsv(raw: string): string {
  const fenceRe = /```[a-zA-Z]*\n([\s\S]*?)```/g;
  let bestBlock = '';
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw)) !== null) {
    if (m[1].length > bestBlock.length) bestBlock = m[1];
  }
  let body = bestBlock || raw;
  const headerIdx = body.search(/^deck,kind,front,back/m);
  if (headerIdx > 0) body = body.slice(headerIdx);
  return body.trim();
}

function buildPersonalContextPreamble(personalContext: string): string {
  return `PERSONAL CONTEXT (apply to your answer)\n---\n${personalContext}\n---\n\n`;
}

// ---------- web fallback ----------

interface WebRunArgs {
  jobId: string;
  prompt: string;
  mode: GeminiJobMode;
  audio?: GeminiJobAudio;
  contextKey?: string;
  callbacks: JobCallbacks;
}

async function runWeb(args: WebRunArgs): Promise<RunResult> {
  const { jobId, prompt, mode, audio, contextKey, callbacks } = args;
  callbacks.onSource?.('web');
  callbacks.onStage?.('opening');

  // Decide reuse before we write the job. If the cached handle for this
  // contextKey is still alive, the content script in that tab will pick up
  // the new job via storage.onChanged. Otherwise open a fresh window.
  const k = key(contextKey);
  const cached = handles.get(k) ?? null;
  const reuse = contextKey != null
    && cached != null
    && (await isGeminiWindowAlive(cached));

  if (!reuse && cached) {
    handles.delete(k);
    await closeGeminiWindow(cached);
  }

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function onMessage(message: unknown): undefined {
      if (settled) return;
      if (!message || typeof message !== 'object') return;
      const m = message as { type?: string; jobId?: string };
      if (!m.type || m.jobId !== jobId) return;

      if (m.type === 'gemini_job_status') {
        const status = message as { stage: GeminiJobStage; detail?: string };
        callbacks.onStage?.(status.stage, status.detail);
        return;
      }
      if (m.type === 'gemini_stream_chunk') {
        const chunk = message as { text?: string };
        if (typeof chunk.text === 'string') callbacks.onChunk?.(chunk.text);
        return;
      }
      if (m.type === 'gemini_result') {
        settled = true;
        chrome.runtime.onMessage.removeListener(onMessage);
        if (timeoutId !== null) clearTimeout(timeoutId);
        const result = message as {
          ok: boolean; csv?: string; raw?: string; text?: string; error?: string;
        };
        if (result.ok) {
          if (mode === 'cards') {
            const raw = result.raw ?? '';
            const csv = (result.csv ?? extractCsv(raw)).trim();
            resolve({ ok: true, source: 'web', text: raw, csv, raw });
          } else {
            const text = (result.text ?? '').trim();
            resolve({ ok: true, source: 'web', text });
          }
        } else {
          // Drop the cached handle -- the user may want to inspect the open
          // window; a follow-up call will open a fresh one.
          handles.delete(k);
          resolve({
            ok: false,
            source: 'web',
            error: result.error || 'Unknown Gemini error.',
          });
        }
      }
    }

    chrome.runtime.onMessage.addListener(onMessage);

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(onMessage);
      handles.delete(k);
      resolve({
        ok: false,
        source: 'web',
        error: 'Gemini did not respond within 5 minutes. Try again or copy the prompt manually.',
      });
    }, WEB_HARD_TIMEOUT_MS);

    void (async () => {
      try {
        const job: GeminiJob = { jobId, prompt, mode, createdAt: Date.now() };
        if (audio) job.audio = audio;
        await chrome.storage.local.set({ geminiJob: job });
        if (!reuse) {
          const handle = await openGeminiWindow();
          handles.set(k, handle);
        }
      } catch (err) {
        if (settled) return;
        settled = true;
        chrome.runtime.onMessage.removeListener(onMessage);
        if (timeoutId !== null) clearTimeout(timeoutId);
        handles.delete(k);
        resolve({
          ok: false,
          source: 'web',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

// ---------- entry point ----------

export async function runGeminiJob(
  spec: JobSpec,
  callbacks: JobCallbacks = {},
): Promise<RunResult> {
  const settings = await getSettings();
  const personalContext = (settings.geminiPersonalContext || '').trim();

  const apiKey = (settings.geminiApiKey || '').trim();
  const preferredModel = settings.geminiPreferredModel ?? 'auto';
  const strategy = settings.geminiAutoStrategy ?? 'volume';

  // Prepend personal context on the WEB first turn only. Subsequent turns
  // talk to the same chat window and inherit the framing from history.
  const isFirstTurn = !spec.history || spec.history.length === 0;
  const webPrompt = (personalContext && isFirstTurn)
    ? buildPersonalContextPreamble(personalContext) + spec.prompt
    : spec.prompt;

  const audio: GeminiJobAudio | undefined = spec.audio
    ? { base64: spec.audio.base64, mimeType: spec.audio.mimeType, filename: spec.audio.filename }
    : undefined;

  // ---- API path ----
  if (apiKey) {
    const apiHistory: ApiHistoryTurn[] = (spec.history ?? []).map(t => ({
      role: t.role, text: t.text,
    }));
    const apiAudio: ApiAudio | undefined = spec.audio
      ? { base64: spec.audio.base64, mimeType: spec.audio.mimeType }
      : undefined;

    // Loop across models until one succeeds, or every plausible model is in
    // cooldown / exhausted. Each rate_limit increment is recorded so the
    // next pickModel skips that model.
    let triedAnyModel = false;
    while (true) {
      const model = await pickModel(preferredModel, strategy);
      if (!model) {
        if (!triedAnyModel) {
          console.info('[gemini] No API model has remaining free-tier quota; using browser fallback.');
        }
        break;
      }
      triedAnyModel = true;

      callbacks.onSource?.('api', model);
      callbacks.onStage?.('submitting');

      const apiResult = await runGeminiApi(
        {
          apiKey,
          model,
          prompt: spec.prompt,
          history: apiHistory.length ? apiHistory : undefined,
          audio: apiAudio,
          systemInstruction: personalContext || undefined,
        },
        {
          onChunk: text => {
            callbacks.onStage?.('streaming');
            callbacks.onChunk?.(text);
          },
        },
      );

      if (apiResult.ok) {
        await recordSuccess(model);
        callbacks.onStage?.('extracting');
        if (spec.mode === 'cards') {
          const csv = extractCsv(apiResult.text);
          callbacks.onStage?.('done');
          return { ok: true, source: 'api', model, text: apiResult.text, csv, raw: apiResult.text };
        }
        callbacks.onStage?.('done');
        return { ok: true, source: 'api', model, text: apiResult.text };
      }

      if (apiResult.code === 'rate_limit') {
        console.warn(`[gemini] ${model} rate-limited; rotating. ${apiResult.error}`);
        await markRateLimited(model, apiResult.retryDelayMs);
        // Loop -- pickModel will skip this id now.
        continue;
      }

      // Auth, network, or other -- fall through to the web path. This is
      // the safety valve that keeps the extension working when the key is
      // bogus, the network drops, or the API returns something we can't
      // parse. Logged loud so the learner can see WHY in DevTools instead of
      // wondering why the browser window keeps popping up.
      console.warn(`[gemini] API path failed (${apiResult.code}); falling back to browser. ${apiResult.error}`);
      callbacks.onStage?.('fallback', `Gemini API: ${apiResult.error}`);
      break;
    }
  } else {
    console.info('[gemini] No API key configured; using browser fallback. Add one in Settings -> AI provider.');
  }

  // ---- Web fallback ----
  const jobId = generateJobId();
  return runWeb({
    jobId,
    prompt: webPrompt,
    mode: spec.mode,
    audio,
    contextKey: spec.contextKey,
    callbacks,
  });
}
