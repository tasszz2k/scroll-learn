import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRequestBody,
  extractTextFromEvent,
  parseRetryDelayMs,
  runGeminiApi,
} from '../src/common/gemini/api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildRequestBody', () => {
  it('puts the prompt as the only user content when no history is given', () => {
    const body = buildRequestBody({
      apiKey: 'k',
      model: 'gemini-3-flash-preview',
      prompt: 'Hello',
    });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
    ]);
    expect(body.generationConfig?.temperature).toBe(0.7);
  });

  it('threads history into contents preserving role order', () => {
    const body = buildRequestBody({
      apiKey: 'k',
      model: 'gemini-3-flash-preview',
      prompt: 'follow-up',
      history: [
        { role: 'user', text: 'first turn' },
        { role: 'model', text: 'first reply' },
      ],
    });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'first turn' }] },
      { role: 'model', parts: [{ text: 'first reply' }] },
      { role: 'user', parts: [{ text: 'follow-up' }] },
    ]);
  });

  it('adds inlineData for audio attachments alongside the text part', () => {
    const body = buildRequestBody({
      apiKey: 'k',
      model: 'gemini-3-flash-preview',
      prompt: 'grade this',
      audio: { base64: 'AAAA', mimeType: 'audio/wav' },
    });
    const last = body.contents[body.contents.length - 1];
    expect(last.role).toBe('user');
    expect(last.parts.length).toBe(2);
    expect(last.parts[0]).toEqual({ text: 'grade this' });
    expect(last.parts[1]).toEqual({
      inlineData: { mimeType: 'audio/wav', data: 'AAAA' },
    });
  });

  it('wires systemInstruction when non-empty and skips it otherwise', () => {
    const withCtx = buildRequestBody({
      apiKey: 'k',
      model: 'gemini-3-flash-preview',
      prompt: 'hi',
      systemInstruction: 'You are tutoring an A2 learner.',
    });
    expect(withCtx.systemInstruction).toEqual({
      parts: [{ text: 'You are tutoring an A2 learner.' }],
    });

    const withoutCtx = buildRequestBody({
      apiKey: 'k',
      model: 'gemini-3-flash-preview',
      prompt: 'hi',
      systemInstruction: '   ',
    });
    expect(withoutCtx.systemInstruction).toBeUndefined();
  });
});

describe('extractTextFromEvent', () => {
  it('concatenates all text parts on the first candidate', () => {
    const text = extractTextFromEvent({
      candidates: [
        { content: { parts: [{ text: 'foo ' }, { text: 'bar' }] } },
      ],
    });
    expect(text).toBe('foo bar');
  });

  it('returns empty string for malformed payloads', () => {
    expect(extractTextFromEvent(null)).toBe('');
    expect(extractTextFromEvent({})).toBe('');
    expect(extractTextFromEvent({ candidates: [] })).toBe('');
    expect(extractTextFromEvent({ candidates: [{}] })).toBe('');
  });
});

describe('parseRetryDelayMs', () => {
  it('parses a "Ns" RetryInfo into milliseconds', () => {
    const ms = parseRetryDelayMs({
      error: {
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
      },
    });
    expect(ms).toBe(12_000);
  });

  it('parses a "Nms" RetryInfo into milliseconds', () => {
    const ms = parseRetryDelayMs({
      error: {
        details: [{ '@type': 'google.rpc.RetryInfo', retryDelay: '500ms' }],
      },
    });
    expect(ms).toBe(500);
  });

  it('returns undefined when RetryInfo is missing', () => {
    expect(parseRetryDelayMs({ error: { details: [] } })).toBeUndefined();
    expect(parseRetryDelayMs(null)).toBeUndefined();
  });
});

// Minimal SSE stream factory for the runGeminiApi tests below. Each frame is
// emitted as a separate `Uint8Array` so the parser is forced to deal with
// chunked input the same way it would in a real network response.
function streamFromFrames(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= frames.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(frames[i++]));
    },
  });
}

describe('runGeminiApi', () => {
  it('streams accumulated snapshots through onChunk and resolves with the final text', async () => {
    const frames = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n\n',
    ];
    const fetchMock = vi.fn(async () => new Response(streamFromFrames(frames), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const snapshots: string[] = [];
    const result = await runGeminiApi(
      { apiKey: 'k', model: 'gemini-3-flash-preview', prompt: 'hi' },
      { onChunk: s => snapshots.push(s) },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('Hello world');
    expect(snapshots).toEqual(['Hello', 'Hello world']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('models/gemini-3-flash-preview:streamGenerateContent');
    expect(url).toContain('alt=sse');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });

  it('handles CRLF SSE framing (Gemini sends \\r\\n\\r\\n in real responses)', async () => {
    // Real bytes captured from generativelanguage.googleapis.com — the server
    // terminates events with \r\n\r\n. The original parser split on \n\n and
    // returned "response was empty" on every API call.
    const frames = [
      'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\r\n\r\n',
      'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\r\n\r\n',
    ];
    const fetchMock = vi.fn(async () => new Response(streamFromFrames(frames), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGeminiApi({ apiKey: 'k', model: 'gemini-2.5-flash', prompt: 'hi' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('hello world');
  });

  it('surfaces a finishReason: SAFETY block as a useful error', async () => {
    const frames = [
      'data: {"candidates":[{"finishReason":"SAFETY","content":{"parts":[]}}]}\r\n\r\n',
    ];
    const fetchMock = vi.fn(async () => new Response(streamFromFrames(frames), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGeminiApi({ apiKey: 'k', model: 'gemini-2.5-flash', prompt: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('other');
      expect(result.error).toContain('SAFETY');
    }
  });

  it('handles a frame split across multiple chunks', async () => {
    const frames = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel',
      'lo"}]}}]}\n\n',
    ];
    const fetchMock = vi.fn(async () => new Response(streamFromFrames(frames), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGeminiApi({ apiKey: 'k', model: 'gemini-3-flash-preview', prompt: 'hi' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('Hello');
  });

  it('maps HTTP 401 to code "auth"', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'API key not valid' } }),
      { status: 401 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGeminiApi({ apiKey: 'bad', model: 'gemini-3-flash-preview', prompt: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('auth');
      expect(result.error).toContain('API key not valid');
    }
  });

  it('maps HTTP 429 to code "rate_limit" and surfaces retryDelayMs', async () => {
    const body = {
      error: {
        message: 'Quota exceeded',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '7s' }],
      },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGeminiApi({ apiKey: 'k', model: 'gemini-3-flash-preview', prompt: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('rate_limit');
      expect(result.retryDelayMs).toBe(7000);
    }
  });

  it('maps a thrown fetch into code "network"', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('NetworkError when attempting to fetch'); });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGeminiApi({ apiKey: 'k', model: 'gemini-3-flash-preview', prompt: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('network');
  });

  it('returns code "other" with the empty-body message when no chunks arrive', async () => {
    const fetchMock = vi.fn(async () => new Response(streamFromFrames([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runGeminiApi({ apiKey: 'k', model: 'gemini-3-flash-preview', prompt: 'hi' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('other');
  });
});
