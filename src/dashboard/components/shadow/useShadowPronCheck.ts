import { useEffect, useRef, useState } from 'react';
import { blobToBase64, blobToWav16kMono } from '../../../common/audioWav';
import { runGeminiJob } from '../../../common/gemini/router';
import { appendPronCheckRun } from '../../../common/shadowPronHistory';
import { playSuccessChime, primeChime } from '../../../common/successChime';
import {
  generateId,
  type GeminiJobStage,
  type PronCheckRun,
  type ShadowScript,
} from '../../../common/types';
import { buildPronCheckPrompt, parsePronCheckJSON } from './pronCheckPrompts';

export type ShadowPronCheckState =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; stage: GeminiJobStage; detail?: string; startedAt: number }
  | { kind: 'success'; run: PronCheckRun; saved: boolean }
  | { kind: 'error'; message: string; raw?: string };

// Runs whose average score is below this threshold are shown to the learner
// (so they see what went wrong) but NOT persisted to history. Keeps the
// progress sparkline and practice plan from filling up with garbage takes
// like a 1-second recording that says "test".
export const LOW_SCORE_THRESHOLD = 40;

export function averageScore(run: PronCheckRun): number {
  const s = run.report.scores;
  return (s.pronunciation + s.naturalness + s.fluency) / 3;
}

interface UseShadowPronCheckOptions {
  onResult?: (run: PronCheckRun) => void;
}

export interface PronCheckSubmission {
  blob: Blob;              // raw recording from MediaRecorder (any decodable mime)
  durationSec: number;     // wall-clock length
  // Browser-side SpeechRecognition transcript captured while recording. Sent
  // to Gemini as authoritative ground truth so per-line "Heard:" content can't
  // be hallucinated from the script text.
  localTranscript: string;
}

function generateJobId(): string {
  return `pron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useShadowPronCheck({ onResult }: UseShadowPronCheckOptions = {}) {
  const [state, setState] = useState<ShadowPronCheckState>({ kind: 'idle' });
  const [elapsedMs, setElapsedMs] = useState(0);
  const jobIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const scriptIdRef = useRef<string | null>(null);
  const durationRef = useRef<number>(0);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  // Tick the elapsed clock while a job is running.
  useEffect(() => {
    if (state.kind !== 'running') return;
    const compute = () => (startedAtRef.current != null ? Date.now() - startedAtRef.current : 0);
    const id = window.setInterval(() => setElapsedMs(compute()), 500);
    return () => window.clearInterval(id);
  }, [state.kind]);

  async function start(script: ShadowScript, submission: PronCheckSubmission): Promise<void> {
    primeChime();
    const jobId = generateJobId();
    jobIdRef.current = jobId;
    scriptIdRef.current = script.id;
    durationRef.current = submission.durationSec;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setState({ kind: 'running', jobId, stage: 'opening', startedAt: startedAtRef.current });

    let wavBlob: Blob;
    let audioBase64: string;
    try {
      // Gemini's free chat UI rejects audio/webm but accepts WAV. Decode the
      // raw webm/opus take, downmix to mono, downsample to 16 kHz, and rewrap
      // as a 16-bit PCM WAV. ~32 KB/sec, comfortably under the 20 MB inline
      // file cap even for ~4 minute recordings.
      wavBlob = await blobToWav16kMono(submission.blob);
      audioBase64 = await blobToBase64(wavBlob);
    } catch (err) {
      jobIdRef.current = null;
      setState({
        kind: 'error',
        message: `Could not encode the recording: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const prompt = buildPronCheckPrompt({
      script,
      durationSec: submission.durationSec,
      localTranscript: submission.localTranscript,
    });

    const result = await runGeminiJob(
      {
        prompt,
        mode: 'explain',
        audio: { base64: audioBase64, mimeType: 'audio/wav', filename: 'pronunciation-take.wav' },
      },
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
    const parsed = parsePronCheckJSON(result.text || '');
    if (!parsed.ok) {
      setState({
        kind: 'error',
        message: `Could not parse the model's reply: ${parsed.error}`,
        raw: result.text,
      });
      return;
    }
    const scriptId = scriptIdRef.current;
    if (!scriptId) {
      setState({ kind: 'error', message: 'Internal error: missing script id.' });
      return;
    }
    const run: PronCheckRun = {
      id: generateId(),
      createdAt: Date.now(),
      durationSec: durationRef.current,
      report: parsed.report,
    };
    // Drop low-score runs (incomplete reads, mostly-skipped takes) so the
    // history sparkline and practice plan don't fill up with noise. The
    // result still surfaces in the UI for this session so the learner sees
    // what happened.
    const avg = averageScore(run);
    const saved = avg >= LOW_SCORE_THRESHOLD;
    if (saved) {
      void appendPronCheckRun(scriptId, run).catch(() => { /* tile shows the run anyway */ });
      // Roll into the daily Statistics tab counters. Fire-and-forget --
      // the report still renders if this fails.
      void chrome.runtime
        .sendMessage({ type: 'record_pron_check', averageScore: avg })
        .catch(() => { /* ignore */ });
    }
    setState({ kind: 'success', run, saved });
    playSuccessChime();
    onResultRef.current?.(run);
  }

  function reset(): void {
    setState({ kind: 'idle' });
  }

  return { state, elapsedMs, start, reset };
}
