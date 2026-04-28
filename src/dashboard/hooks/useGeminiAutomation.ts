import { useEffect, useRef, useState } from 'react';
import { playSuccessChime, primeChime } from '../../common/successChime';
import type { GeminiJobStage } from '../../common/types';
import { closeGeminiWindow, openGeminiWindow, type GeminiWindowHandle } from '../utils/geminiTab';

export type AiState =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; stage: GeminiJobStage; detail?: string }
  | { kind: 'success'; count: number }
  | { kind: 'error'; message: string };

export interface GeminiResultPayload {
  csv: string;
  cardCount: number;
  deckName: string;
}

interface UseGeminiAutomationOptions {
  onResult?: (payload: GeminiResultPayload) => void;
}

function generateJobId(): string {
  return `gemini-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Returns the bare base name suggested by the CSV (no date suffix, no
// uniquing). The caller is expected to attach the date and de-duplicate
// against existing decks.
export function inferDeckNameFromCsv(csv: string, fallback = 'Gemini import'): string {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return fallback;
  const header = lines[0].toLowerCase();
  if (!header.startsWith('deck')) return fallback;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const firstCell = line.startsWith('"')
      ? line.slice(1, line.indexOf('"', 1))
      : line.split(',')[0];
    const trimmed = firstCell.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}

/**
 * Drives the Gemini automation flow: opens a background tab pointed at
 * gemini.google.com, hands off the prompt via chrome.storage, and listens for
 * status + result messages from the gemini content script. The caller plugs
 * its own `onResult` to do something with the returned CSV (e.g. seed the
 * Import panel or hand off to the dashboard).
 */
export function useGeminiAutomation({ onResult }: UseGeminiAutomationOptions = {}) {
  const [aiState, setAiState] = useState<AiState>({ kind: 'idle' });
  // Live elapsed-time counter so the progress bar visibly creeps forward and
  // the elapsed clock ticks even when we're stuck on a single stage (most
  // notably the long "streaming" phase).
  const [aiElapsedMs, setAiElapsedMs] = useState(0);
  // Latest accumulated text snapshot from the gemini content script while a
  // job is in flight. The progress banner shows the trailing slice so the
  // user can watch the response actually being generated. Reset to '' at the
  // start of every new job (see sendToGemini).
  const [liveText, setLiveText] = useState('');
  const aiJobIdRef = useRef<string | null>(null);
  const aiHandleRef = useRef<GeminiWindowHandle | null>(null);
  const aiTimeoutRef = useRef<number | null>(null);
  const aiStartedAtRef = useRef<number | null>(null);
  // Stash the latest onResult in a ref so the message listener doesn't need to
  // tear down and re-subscribe when the caller passes a fresh closure each
  // render -- which would otherwise drop in-flight messages.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  function clearAiTimeout() {
    if (aiTimeoutRef.current !== null) {
      window.clearTimeout(aiTimeoutRef.current);
      aiTimeoutRef.current = null;
    }
  }

  async function closeAiWindow(): Promise<void> {
    const handle = aiHandleRef.current;
    aiHandleRef.current = null;
    await closeGeminiWindow(handle);
  }

  // Listen for status + result messages from the Gemini content script.
  useEffect(() => {
    function onMessage(message: unknown): undefined {
      if (!message || typeof message !== 'object') return;
      const m = message as { type?: string; jobId?: string };
      if (!m.type || !m.jobId) return;
      if (aiJobIdRef.current !== m.jobId) return;

      if (m.type === 'gemini_job_status') {
        const status = message as { stage: GeminiJobStage; detail?: string };
        setAiState({ kind: 'running', jobId: m.jobId, stage: status.stage, detail: status.detail });
        return;
      }
      if (m.type === 'gemini_stream_chunk') {
        const chunk = message as { text: string };
        if (typeof chunk.text === 'string') {
          // The content script sends full snapshots, not deltas, so we just
          // overwrite. Re-renders are throttled by React batching plus the
          // 250ms poll interval on the content-script side.
          setLiveText(chunk.text);
        }
        return;
      }
      if (m.type === 'gemini_result') {
        const result = message as { ok: boolean; csv?: string; error?: string };
        clearAiTimeout();
        aiJobIdRef.current = null;
        if (result.ok && result.csv) {
          const csv = result.csv.trim();
          const cardCount = Math.max(0, csv.split(/\r?\n/).filter(l => l.trim()).length - 1);
          setAiState({ kind: 'success', count: cardCount });
          playSuccessChime();
          onResultRef.current?.({ csv, cardCount, deckName: inferDeckNameFromCsv(csv) });
          // Job ran in a side window -- close it now that we have the data.
          void closeAiWindow();
        } else {
          // Leave the Gemini window open on failure so the user can inspect
          // the page and copy the response manually if they want. Releasing
          // the ref keeps a future run from accidentally closing this window.
          setAiState({ kind: 'error', message: result.error || 'Unknown error' });
          aiHandleRef.current = null;
        }
      }
      return;
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  // Clean up any pending timeout on unmount.
  useEffect(() => {
    return () => clearAiTimeout();
  }, []);

  // Drive the live progress display while a job is running. We deliberately
  // don't reset the elapsed counter here -- the progress banner is only
  // rendered while running, so the stale value is never visible, and a fresh
  // run reseeds it at the action site (sendToGemini) before flipping to
  // running. This avoids the setState-in-effect anti-pattern.
  useEffect(() => {
    if (aiState.kind !== 'running') return;
    const compute = () => (aiStartedAtRef.current != null ? Date.now() - aiStartedAtRef.current : 0);
    const id = window.setInterval(() => setAiElapsedMs(compute()), 500);
    return () => window.clearInterval(id);
  }, [aiState.kind]);

  async function sendToGemini(prompt: string): Promise<void> {
    // Unlock the success chime's audio element while we're still inside the
    // user-click frame; the chime itself fires later from a runtime message
    // and would be silent under Chrome's autoplay policy otherwise.
    primeChime();
    const jobId = generateJobId();
    aiJobIdRef.current = jobId;
    aiStartedAtRef.current = Date.now();
    // Reset the visible elapsed counter and any leftover live text from a
    // previous run at the action site (rather than inside the progress
    // effect) so we don't flash the previous run's final values before the
    // first stream chunk paints over them, and so we don't trip the
    // "no setState in effect" lint.
    setAiElapsedMs(0);
    setLiveText('');
    setAiState({ kind: 'running', jobId, stage: 'opening' });

    try {
      await chrome.storage.local.set({
        geminiJob: { jobId, prompt, createdAt: Date.now() },
      });
      // Open Gemini as the active tab in a NEW unfocused window (instead of a
      // background tab in the dashboard window). See utils/geminiTab.ts for
      // why -- background tabs get throttled and Gemini's Angular cycle stops
      // updating the DOM, which caused spurious "response timed out" errors
      // even when the model finished generating.
      aiHandleRef.current = await openGeminiWindow();
    } catch (err) {
      aiJobIdRef.current = null;
      setAiState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Hard timeout in case the content script never reports back (e.g. user
    // never logs in, Gemini DOM has changed, tab closed early).
    clearAiTimeout();
    aiTimeoutRef.current = window.setTimeout(() => {
      if (aiJobIdRef.current === jobId) {
        aiJobIdRef.current = null;
        setAiState({
          kind: 'error',
          message: 'Gemini did not respond within 5 minutes. The prompt is still in the textarea -- copy it manually if you like.',
        });
      }
    }, 5 * 60 * 1000);
  }

  function dismissError(): void {
    setAiState(prev => (prev.kind === 'error' ? { kind: 'idle' } : prev));
  }

  return { aiState, aiElapsedMs, liveText, sendToGemini, dismissError };
}
