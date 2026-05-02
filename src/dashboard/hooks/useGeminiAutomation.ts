import { useEffect, useRef, useState } from 'react';
import { runGeminiJob } from '../../common/gemini/router';
import type { GeminiApiModelId } from '../../common/types';
import { playSuccessChime, primeChime } from '../../common/successChime';
import type { GeminiJobStage } from '../../common/types';

export type AiSource = 'api' | 'web';

export type AiState =
  | { kind: 'idle' }
  | {
      kind: 'running';
      jobId: string;
      stage: GeminiJobStage;
      detail?: string;
      // Set once the router commits to a path. Lets the progress banner
      // surface an "API" / "Browser" pill (and the active model on api).
      source?: AiSource;
      model?: GeminiApiModelId;
    }
  | { kind: 'success'; count: number; source: AiSource; model?: GeminiApiModelId }
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
 * Drives the AI generate-quiz flow via the unified router. The router picks
 * the API path when the user has supplied a Gemini key (with quota-aware
 * model rotation) and falls back to the existing browser-driven path
 * otherwise. The hook keeps the same `aiState` / `aiElapsedMs` / `liveText`
 * shape as before so consumers don't change.
 */
export function useGeminiAutomation({ onResult }: UseGeminiAutomationOptions = {}) {
  const [aiState, setAiState] = useState<AiState>({ kind: 'idle' });
  // Live elapsed-time counter so the progress bar visibly creeps forward and
  // the elapsed clock ticks even when we're stuck on a single stage (most
  // notably the long "streaming" phase).
  const [aiElapsedMs, setAiElapsedMs] = useState(0);
  // Latest accumulated text snapshot from the router while a job is in
  // flight. The progress banner shows the trailing slice so the user can
  // watch the response being generated.
  const [liveText, setLiveText] = useState('');
  const aiJobIdRef = useRef<string | null>(null);
  const aiStartedAtRef = useRef<number | null>(null);
  // Stash the latest onResult in a ref so callbacks don't churn the listener.
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // Tick the elapsed clock while a job is running.
  useEffect(() => {
    if (aiState.kind !== 'running') return;
    const compute = () => (aiStartedAtRef.current != null ? Date.now() - aiStartedAtRef.current : 0);
    const id = window.setInterval(() => setAiElapsedMs(compute()), 500);
    return () => window.clearInterval(id);
  }, [aiState.kind]);

  async function sendToGemini(prompt: string): Promise<void> {
    // Unlock the success chime's audio element while we're still inside the
    // user-click frame; the chime fires later from a callback.
    primeChime();
    const jobId = generateJobId();
    aiJobIdRef.current = jobId;
    aiStartedAtRef.current = Date.now();
    setAiElapsedMs(0);
    setLiveText('');
    setAiState({ kind: 'running', jobId, stage: 'opening' });

    const result = await runGeminiJob(
      { prompt, mode: 'cards' },
      {
        onStage: (stage, detail) => {
          if (aiJobIdRef.current !== jobId) return;
          setAiState(prev => prev.kind === 'running' && prev.jobId === jobId
            ? { ...prev, stage, detail }
            : prev);
        },
        onChunk: text => {
          if (aiJobIdRef.current !== jobId) return;
          setLiveText(text);
        },
        onSource: (source, model) => {
          if (aiJobIdRef.current !== jobId) return;
          setAiState(prev => prev.kind === 'running' && prev.jobId === jobId
            ? { ...prev, source, model }
            : prev);
        },
      },
    );

    if (aiJobIdRef.current !== jobId) return; // a newer job superseded us
    aiJobIdRef.current = null;

    if (result.ok) {
      const csv = (result.csv ?? '').trim();
      const cardCount = Math.max(0, csv.split(/\r?\n/).filter(l => l.trim()).length - 1);
      setAiState({
        kind: 'success',
        count: cardCount,
        source: result.source,
        model: result.model,
      });
      playSuccessChime();
      onResultRef.current?.({ csv, cardCount, deckName: inferDeckNameFromCsv(csv) });
    } else {
      setAiState({ kind: 'error', message: result.error });
    }
  }

  function dismissError(): void {
    setAiState(prev => (prev.kind === 'error' ? { kind: 'idle' } : prev));
  }

  return { aiState, aiElapsedMs, liveText, sendToGemini, dismissError };
}
