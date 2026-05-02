import { useEffect, useRef, useState } from 'react';
import { runGeminiJob } from '../../../common/gemini/router';
import { playSuccessChime, primeChime } from '../../../common/successChime';
import type {
  GeminiJobStage,
  ShadowLevel,
  ShadowScript,
} from '../../../common/types';
import { parseShadowJSON } from './prompts';

export interface ShadowGenMeta {
  title?: string;             // Optional override; otherwise the model's title is used
  level: ShadowLevel;
  speakerCount: number;
  durationSec: number;
  rate: number;
  targetWords: string[];
  context: string;
}

export type ShadowGenState =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; stage: GeminiJobStage; detail?: string; startedAt: number }
  | { kind: 'success'; script: ShadowScript }
  | { kind: 'error'; message: string; raw?: string };

interface UseShadowGenOptions {
  onResult?: (script: ShadowScript) => void;
}

function generateJobId(): string {
  return `shadow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateScriptId(): string {
  return `shscript-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useShadowGen({ onResult }: UseShadowGenOptions = {}) {
  const [state, setState] = useState<ShadowGenState>({ kind: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);
  const jobIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // Tick the elapsed clock while a job is running.
  useEffect(() => {
    if (state.kind !== 'running') return;
    const compute = () => (startedAtRef.current != null ? Date.now() - startedAtRef.current : 0);
    const id = window.setInterval(() => setElapsedMs(compute()), 500);
    return () => window.clearInterval(id);
  }, [state.kind]);

  async function generate(prompt: string, meta: ShadowGenMeta): Promise<void> {
    primeChime();
    const jobId = generateJobId();
    jobIdRef.current = jobId;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState({ kind: 'running', jobId, stage: 'opening', startedAt: startedAtRef.current });

    const result = await runGeminiJob(
      { prompt, mode: 'explain' },
      {
        onStage: (stage, detail) => {
          if (jobIdRef.current !== jobId) return;
          setState(prev => prev.kind === 'running'
            ? { ...prev, stage, detail }
            : prev);
        },
      },
    );

    if (jobIdRef.current !== jobId) return;
    jobIdRef.current = null;

    if (!result.ok) {
      setState({ kind: 'error', message: result.error });
      return;
    }
    const parsed = parseShadowJSON(result.text || '');
    if (!parsed.ok) {
      setState({
        kind: 'error',
        message: `Could not parse the model's reply: ${parsed.error}`,
        raw: result.text,
      });
      return;
    }
    const script: ShadowScript = {
      id: generateScriptId(),
      title: meta.title?.trim() || parsed.script.title,
      level: meta.level,
      speakerCount: meta.speakerCount,
      durationSec: meta.durationSec,
      rate: meta.rate,
      targetWords: meta.targetWords,
      context: meta.context,
      lines: parsed.script.lines,
      createdAt: Date.now(),
    };
    // Persist before notifying so the list refresh sees the new entry.
    void chrome.runtime
      .sendMessage({ type: 'save_shadow_script', script })
      .catch(() => { /* ignore -- storage.onChanged will reconcile */ });
    setState({ kind: 'success', script });
    playSuccessChime();
    onResultRef.current?.(script);
  }

  function reset(): void {
    setState({ kind: 'idle' });
  }

  return { state, elapsedMs, generate, reset };
}
