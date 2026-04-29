import { useEffect, useRef, useState } from 'react';
import { playSuccessChime, primeChime } from '../../../common/successChime';
import type {
  GeminiJobStage,
  ShadowLevel,
  ShadowScript,
} from '../../../common/types';
import {
  closeGeminiWindow,
  openGeminiWindow,
  type GeminiWindowHandle,
} from '../../utils/geminiTab';
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
  const handleRef = useRef<GeminiWindowHandle | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const metaRef = useRef<ShadowGenMeta | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  function clearTimer() {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  async function closeWindow() {
    const handle = handleRef.current;
    handleRef.current = null;
    await closeGeminiWindow(handle);
  }

  // Listen for status + result messages from the Gemini content script.
  useEffect(() => {
    function onMessage(message: unknown): undefined {
      if (!message || typeof message !== 'object') return;
      const m = message as { type?: string; jobId?: string };
      if (!m.type || !m.jobId) return;
      if (jobIdRef.current !== m.jobId) return;

      if (m.type === 'gemini_job_status') {
        const status = message as { stage: GeminiJobStage; detail?: string };
        setState(prev => prev.kind === 'running'
          ? { ...prev, stage: status.stage, detail: status.detail }
          : prev);
        return;
      }

      if (m.type === 'gemini_result') {
        const result = message as { ok: boolean; text?: string; error?: string };
        clearTimer();
        jobIdRef.current = null;
        if (!result.ok) {
          // Leave the Gemini window open for inspection; drop the handle so a
          // future run opens a fresh window.
          handleRef.current = null;
          setState({ kind: 'error', message: result.error || 'Unknown error' });
          return;
        }
        const meta = metaRef.current;
        const parsed = parseShadowJSON(result.text || '');
        if (!parsed.ok) {
          handleRef.current = null;
          setState({
            kind: 'error',
            message: `Could not parse the model's reply: ${parsed.error}`,
            raw: result.text,
          });
          return;
        }
        if (!meta) {
          // Shouldn't happen -- meta is set right before we send.
          setState({ kind: 'error', message: 'Internal error: missing form metadata.' });
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
        void closeWindow();
      }
      return;
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  // Tick the elapsed clock while a job is running.
  useEffect(() => {
    if (state.kind !== 'running') return;
    const compute = () => (startedAtRef.current != null ? Date.now() - startedAtRef.current : 0);
    const id = window.setInterval(() => setElapsedMs(compute()), 500);
    return () => window.clearInterval(id);
  }, [state.kind]);

  // Cleanup pending timer on unmount.
  useEffect(() => () => clearTimer(), []);

  async function generate(prompt: string, meta: ShadowGenMeta): Promise<void> {
    primeChime();
    const jobId = generateJobId();
    jobIdRef.current = jobId;
    metaRef.current = meta;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState({ kind: 'running', jobId, stage: 'opening', startedAt: startedAtRef.current });

    try {
      await chrome.storage.local.set({
        geminiJob: { jobId, prompt, mode: 'explain', createdAt: Date.now() },
      });
      handleRef.current = await openGeminiWindow();
    } catch (err) {
      jobIdRef.current = null;
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }

    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      if (jobIdRef.current === jobId) {
        jobIdRef.current = null;
        setState({
          kind: 'error',
          message: 'Gemini did not respond within 5 minutes. Try again or copy the prompt manually.',
        });
      }
    }, 5 * 60 * 1000);
  }

  function reset(): void {
    setState({ kind: 'idle' });
  }

  return { state, elapsedMs, generate, reset };
}
