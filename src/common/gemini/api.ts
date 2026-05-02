// Pure REST client for Google's Generative Language API. Streams a single
// turn over Server-Sent Events and concatenates the candidate text snapshots.
//
// The transport contract here is intentionally tiny: a request body, a key,
// an onChunk callback that receives the *full accumulated text snapshot* (not
// a delta), and a typed result. The rest of the world -- model selection,
// rate-limit bookkeeping, web fallback -- lives in router.ts and quota.ts so
// this module can be unit-tested with nothing but a fake fetch.

import type { GeminiApiModelId } from '../types';

export interface ApiHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface ApiAudio {
  // Raw base64 (no data: prefix).
  base64: string;
  mimeType: string;
}

export interface ApiSpec {
  apiKey: string;
  model: GeminiApiModelId;
  prompt: string;
  history?: ApiHistoryTurn[];
  audio?: ApiAudio;
  // Free-form learner profile injected as systemInstruction. Optional.
  systemInstruction?: string;
  // Forwarded onto generationConfig. Default 0.7 covers the existing prompts.
  temperature?: number;
}

export interface ApiCallbacks {
  onChunk?: (snapshot: string) => void;
}

export type ApiErrorCode = 'auth' | 'rate_limit' | 'network' | 'other';

export interface ApiOk {
  ok: true;
  text: string;
}

export interface ApiErr {
  ok: false;
  code: ApiErrorCode;
  error: string;
  // RetryInfo.retryDelay parsed off a 429 body, in ms. Lets the router set a
  // tighter cooldown than the default 65s when the server tells us to wait
  // longer (e.g. RPD bounce).
  retryDelayMs?: number;
}

export type ApiResult = ApiOk | ApiErr;

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Match the existing web automation hard-cap so a model that gets stuck in
// "thinking" mode aborts cleanly instead of dragging out forever.
const HARD_TIMEOUT_MS = 4 * 60 * 1000;

interface ContentPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface ContentEntry {
  role: 'user' | 'model';
  parts: ContentPart[];
}

interface RequestBody {
  contents: ContentEntry[];
  systemInstruction?: { parts: { text: string }[] };
  generationConfig?: { temperature: number };
}

// Build the request body. Exported so the unit test can assert exactly what
// goes on the wire without mocking fetch's internals.
export function buildRequestBody(spec: ApiSpec): RequestBody {
  const contents: ContentEntry[] = [];
  for (const turn of spec.history ?? []) {
    contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  }
  // Current user turn -- text + optional audio attachment in a single entry.
  // Order matches Gemini's reference docs: text part first, then inlineData.
  const userParts: ContentPart[] = [{ text: spec.prompt }];
  if (spec.audio) {
    userParts.push({
      inlineData: { mimeType: spec.audio.mimeType, data: spec.audio.base64 },
    });
  }
  contents.push({ role: 'user', parts: userParts });

  const body: RequestBody = {
    contents,
    generationConfig: { temperature: spec.temperature ?? 0.7 },
  };
  if (spec.systemInstruction && spec.systemInstruction.trim()) {
    body.systemInstruction = { parts: [{ text: spec.systemInstruction }] };
  }
  return body;
}

// SSE chunks arrive as `data: { ... }\n\n`. The streamed payload is JSON of
// the same shape as the non-streaming endpoint -- candidates[0].content.parts
// carries the latest delta. Concatenating .text across parts gives a snapshot.
//
// Exported for tests so they can pin the parser without spinning up a fake
// ReadableStream.
export function extractTextFromEvent(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const candidates = (json as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return '';
  const first = candidates[0] as { content?: { parts?: ContentPart[] } } | undefined;
  const parts = first?.content?.parts ?? [];
  let out = '';
  for (const p of parts) {
    if (typeof p.text === 'string') out += p.text;
  }
  return out;
}

// Detect a safety-block payload so we can surface a useful error instead of
// "response was empty". Two shapes can carry this:
//   - top-level promptFeedback.blockReason (the prompt itself was blocked)
//   - candidates[0].finishReason of SAFETY / RECITATION / OTHER (the model
//     started, then was cut off)
export function extractBlockReason(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const obj = json as {
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ finishReason?: string; content?: { parts?: ContentPart[] } }>;
  };
  if (obj.promptFeedback?.blockReason) {
    return `promptFeedback: ${obj.promptFeedback.blockReason}`;
  }
  const finish = obj.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    // Only flag non-success finish reasons. STOP / MAX_TOKENS mean the model
    // produced text and ran to natural end (or hit the token cap).
    const text = obj.candidates?.[0]?.content?.parts?.some(p => typeof p.text === 'string' && p.text);
    if (!text) return `finishReason: ${finish}`;
  }
  return undefined;
}

// Pull RetryInfo.retryDelay out of a 429 response body. Google encodes it as
// a string like "12s" inside details[].retryDelay. Returns ms, or undefined
// when the field is absent / malformed.
export function parseRetryDelayMs(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return undefined;
  const details = (error as { details?: unknown }).details;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    if (!d || typeof d !== 'object') continue;
    const t = (d as { '@type'?: string })['@type'];
    if (typeof t !== 'string' || !t.endsWith('RetryInfo')) continue;
    const raw = (d as { retryDelay?: unknown }).retryDelay;
    if (typeof raw !== 'string') continue;
    // Format is e.g. "12s" or "0.5s"; sometimes "12000ms".
    const m = raw.match(/^([\d.]+)(ms|s)$/);
    if (!m) continue;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    return m[2] === 'ms' ? n : n * 1000;
  }
  return undefined;
}

function classifyHttpStatus(status: number): ApiErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'other';
}

export async function runGeminiApi(
  spec: ApiSpec,
  callbacks: ApiCallbacks = {},
): Promise<ApiResult> {
  const url = `${BASE}/models/${encodeURIComponent(spec.model)}:streamGenerateContent?alt=sse`;
  const body = buildRequestBody(spec);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': spec.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      code: 'network',
      error: isAbort
        ? `Request aborted after ${Math.floor(HARD_TIMEOUT_MS / 1000)}s.`
        : (err instanceof Error ? err.message : String(err)),
    };
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    let raw = '';
    try { raw = await response.text(); } catch { /* ignore */ }
    let parsed: unknown = undefined;
    try { parsed = raw ? JSON.parse(raw) : undefined; } catch { /* not JSON */ }
    const code = classifyHttpStatus(response.status);
    const message = (parsed as { error?: { message?: string } } | undefined)?.error?.message
      || raw
      || `HTTP ${response.status}`;
    const retryDelayMs = code === 'rate_limit' ? parseRetryDelayMs(parsed) : undefined;
    return { ok: false, code, error: message, retryDelayMs };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timeoutId);
    return { ok: false, code: 'other', error: 'Empty response body.' };
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';

  let blockReason: string | undefined;

  // Pull `data:` payloads out of an event block. The block may be a single
  // event or — when the server uses LF-only and forgets the trailing blank
  // line, or sends NDJSON without SSE framing at all — multiple JSON objects
  // glued together. We try to recover whatever JSON we can find.
  function consumeEventBlock(block: string): void {
    if (!block.trim()) return;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      } else if (line.trim().startsWith('{')) {
        // NDJSON-style frame: no SSE prefix, just a bare JSON object per line.
        dataLines.push(line.trim());
      }
    }
    for (const payload of dataLines) {
      if (!payload || payload === '[DONE]') continue;
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = extractTextFromEvent(json);
      if (delta) {
        accumulated += delta;
        callbacks.onChunk?.(accumulated);
      }
      // Capture the most recent block-reason; a stream may emit one or more
      // text deltas, then a final candidate with finishReason: SAFETY.
      const reason = extractBlockReason(json);
      if (reason) blockReason = reason;
    }
  }

  try {
    // SSE framing: events are separated by a blank line. Servers may use LF
    // (`\n\n`) or CRLF (`\r\n\r\n`); normalising CRLF -> LF up front lets the
    // single split below handle both. Each event is one or more lines starting
    // with `data: ` (we ignore `event:` / `id:` lines because Gemini only emits
    // `data:` frames).
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        consumeEventBlock(event);
      }
    }
    // Flush any trailing partial buffer (Gemini sometimes omits the trailing
    // blank line on the final frame).
    consumeEventBlock(buffer);
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      code: 'network',
      error: isAbort
        ? `Stream aborted after ${Math.floor(HARD_TIMEOUT_MS / 1000)}s.`
        : (err instanceof Error ? err.message : String(err)),
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!accumulated) {
    // Make this debuggable without a full devtools network capture: surface
    // the raw bytes so the next time it happens we can see whether it was
    // a safety-block, an empty candidates list, or unexpected framing.
    const snippet = buffer.slice(0, 400).replace(/\s+/g, ' ').trim();
    if (blockReason) {
      console.warn('[gemini-api] 200 OK but blocked:', blockReason);
      return { ok: false, code: 'other', error: `Gemini blocked the response (${blockReason}).` };
    }
    console.warn('[gemini-api] 200 OK but no chunks parsed. Trailing buffer:', snippet);
    return {
      ok: false,
      code: 'other',
      error: snippet
        ? `Gemini response was empty. Raw: ${snippet.slice(0, 200)}`
        : 'Gemini response was empty.',
    };
  }
  return { ok: true, text: accumulated };
}
