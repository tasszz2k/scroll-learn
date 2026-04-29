import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getPronCheckHistory,
} from '../../../common/shadowPronHistory';
import {
  isRecognitionSupported,
  startContinuousRecognition,
  type ContinuousRecognizer,
} from '../../../common/speechRecognition';
import type { PronCheckRun, ShadowScript } from '../../../common/types';
import { useConfirm } from '../../hooks/useConfirm';
import PronCheckHistory from './PronCheckHistory';
import PronCheckPracticePlan from './PronCheckPracticePlan';
import PronCheckReportView from './PronCheckReport';
import { LOW_SCORE_THRESHOLD, useShadowPronCheck } from './useShadowPronCheck';

interface AiPronunciationCheckProps {
  script: ShadowScript;
  open: boolean;
  onClose: () => void;
  onDrillPhoneme?: (symbol: string) => void;
  // Notifies the parent (ShadowPlayer) about recording lifecycle so it can
  // run a karaoke teleprompter highlight that paces the learner word-by-word
  // through the script while they record.
  onRecordingChange?: (recording: boolean) => void;
  // Shared speed state with the player (the toolbar Rate slider also writes
  // here) so the karaoke teleprompter pace is controllable from either place.
  speed?: number;
  onSpeedChange?: (value: number) => void;
}

const SPEED_PRESETS: { label: string; value: number; hint: string }[] = [
  { label: 'Slow',  value: 0.7, hint: 'Slower karaoke pace -- good for the first attempt.' },
  { label: 'Normal', value: 1.0, hint: 'Native pace, matches the script\'s target duration.' },
  { label: 'Fast',  value: 1.3, hint: 'Faster karaoke pace -- a stretch challenge.' },
];

const MAX_RECORDING_MS = 4 * 60 * 1000;

type RecordState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'recording'; startedAt: number; level: number; transcript: string }
  | { kind: 'recorded'; blob: Blob; durationSec: number; transcript: string }
  | { kind: 'denied'; message: string };

function formatSeconds(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

export default function AiPronunciationCheck({
  script,
  open,
  onClose,
  onDrillPhoneme,
  onRecordingChange,
  speed,
  onSpeedChange,
}: AiPronunciationCheckProps) {
  const onRecordingChangeRef = useRef(onRecordingChange);
  useEffect(() => { onRecordingChangeRef.current = onRecordingChange; }, [onRecordingChange]);
  const speedValue = typeof speed === 'number' ? speed : 1;
  const confirm = useConfirm();
  const { state: jobState, elapsedMs, start, reset } = useShadowPronCheck();
  const [recState, setRecState] = useState<RecordState>({ kind: 'idle' });
  const [history, setHistory] = useState<PronCheckRun[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const recognizerRef = useRef<ContinuousRecognizer | null>(null);
  const recognizerSupported = isRecognitionSupported();

  // Refresh history when the script id changes or the panel opens, and after
  // any successful run lands.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const list = await getPronCheckHistory(script.id);
      if (!cancelled) setHistory(list);
    })();
    return () => { cancelled = true; };
  }, [open, script.id, jobState.kind]);

  // Stop the mic + analyser cleanly. Idempotent.
  const teardown = useCallback(() => {
    if (meterRafRef.current != null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (stopTimerRef.current != null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try {
      recorderRef.current?.stop();
    } catch { /* ignore */ }
    recorderRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { void audioCtxRef.current.close(); } catch { /* ignore */ }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (recognizerRef.current) {
      try { recognizerRef.current.abort(); } catch { /* ignore */ }
      recognizerRef.current = null;
    }
    onRecordingChangeRef.current?.(false);
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // Reset recorder state when the panel closes or the script swaps so the
  // next open is clean.
  useEffect(() => {
    if (!open) {
      teardown();
      setRecState({ kind: 'idle' });
      reset();
    }
  }, [open, teardown, reset]);

  useEffect(() => {
    teardown();
    setRecState({ kind: 'idle' });
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- script swap should reset, deps are intentionally narrow
  }, [script.id]);

  const startRecording = useCallback(async () => {
    if (recState.kind === 'recording' || recState.kind === 'requesting') return;
    setRecState({ kind: 'requesting' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      // Run a local SpeechRecognition session in parallel for the transcript
      // panel. This is purely for the user's own reference -- Gemini grades
      // from the audio itself, not from the recognizer's transcript.
      let resolveTranscript: ((t: string) => void) | null = null;
      const transcriptPromise = new Promise<string>((res) => { resolveTranscript = res; });
      if (recognizerSupported) {
        recognizerRef.current = startContinuousRecognition({
          lang: 'en-US',
          onPartial: (t) => {
            setRecState(prev => prev.kind === 'recording' ? { ...prev, transcript: t } : prev);
          },
        });
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const handle = recognizerRef.current;
        recognizerRef.current = null;
        if (handle) {
          void handle.stop().then(t => { if (resolveTranscript) resolveTranscript(t); });
        } else if (resolveTranscript) {
          resolveTranscript('');
        }
        void transcriptPromise.then(transcript => {
          setRecState({ kind: 'recorded', blob, durationSec, transcript });
        });
      };

      // Hook up an analyser for a quick visual level meter.
      try {
        const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (Ctx) {
          const ctx = new Ctx();
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          analyserRef.current = analyser;
          const buf = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteTimeDomainData(buf);
            let peak = 0;
            for (let i = 0; i < buf.length; i++) {
              const v = Math.abs(buf[i] - 128);
              if (v > peak) peak = v;
            }
            const level = Math.min(1, peak / 96);
            setRecState(prev => prev.kind === 'recording' ? { ...prev, level } : prev);
            meterRafRef.current = requestAnimationFrame(tick);
          };
          meterRafRef.current = requestAnimationFrame(tick);
        }
      } catch {
        /* analyser is cosmetic; ignore */
      }

      recorder.start();
      startedAtRef.current = Date.now();
      setRecState({ kind: 'recording', startedAt: startedAtRef.current, level: 0, transcript: '' });
      onRecordingChangeRef.current?.(true);
      stopTimerRef.current = window.setTimeout(() => {
        try { recorder.stop(); } catch { /* ignore */ }
      }, MAX_RECORDING_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const denied = /permission|denied|notallowed/i.test(msg) || (err as { name?: string })?.name === 'NotAllowedError';
      setRecState({
        kind: 'denied',
        message: denied
          ? 'Mic permission denied. Allow microphone access in your browser site settings, then try again.'
          : `Could not start recording: ${msg}`,
      });
      teardown();
    }
  }, [recState.kind, teardown, recognizerSupported]);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current != null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    try { recorderRef.current?.stop(); } catch { /* ignore */ }
    if (meterRafRef.current != null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try { track.stop(); } catch { /* ignore */ }
      }
      streamRef.current = null;
    }
    onRecordingChangeRef.current?.(false);
  }, []);

  const handleDiscard = useCallback(() => {
    setRecState({ kind: 'idle' });
    reset();
  }, [reset]);

  const handleSubmit = useCallback(async () => {
    if (recState.kind !== 'recorded') return;

    // Coverage guard: the chat UI's audio analysis is unreliable and tends to
    // hallucinate "Heard:" content from the script when the audio is sparse.
    // If the local recognizer caught much less than the script's word count,
    // warn the user before paying for the Gemini round-trip.
    const transcript = recState.transcript.trim();
    if (recognizerSupported) {
      const transcriptWords = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
      const scriptWords = script.lines.reduce(
        (sum, l) => sum + l.text.split(/\s+/).filter(Boolean).length,
        0,
      );
      const coverage = scriptWords > 0 ? transcriptWords / scriptWords : 0;
      if (coverage < 0.3) {
        const ok = await confirm({
          title: transcript ? 'Recording looks incomplete' : 'No speech detected',
          message: transcript
            ? `The local recognizer only caught ${transcriptWords} word${transcriptWords === 1 ? '' : 's'} out of roughly ${scriptWords} in the script (~${Math.round(coverage * 100)}% coverage). Gemini will likely score this very low. Send anyway, or re-record?`
            : `The local recognizer didn't catch any words. Gemini will score this near zero. Send anyway, or re-record?`,
          confirmLabel: 'Send anyway',
          cancelLabel: 'Re-record',
        });
        if (!ok) {
          setRecState({ kind: 'idle' });
          return;
        }
      }
    }

    await start(script, {
      blob: recState.blob,
      durationSec: recState.durationSec,
      localTranscript: transcript,
    });
  }, [recState, script, start, confirm, recognizerSupported]);

  const handleClose = useCallback(async () => {
    if (recState.kind === 'recording') {
      const ok = await confirm({
        title: 'Discard recording?',
        message: 'You\'re still recording. Close and throw it away?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep recording',
        variant: 'danger',
      });
      if (!ok) return;
      stopRecording();
    }
    onClose();
  }, [confirm, onClose, recState.kind, stopRecording]);

  const recordedBlob = recState.kind === 'recorded' ? recState.blob : null;
  const recordedUrl = useMemo(() => {
    if (!recordedBlob) return null;
    return URL.createObjectURL(recordedBlob);
  }, [recordedBlob]);
  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  if (!open) return null;

  const recording = recState.kind === 'recording';
  const recElapsed = recording ? Date.now() - recState.startedAt : 0;
  const level = recording ? recState.level : 0;
  const finalTranscript = recState.kind === 'recorded' ? recState.transcript : '';
  const jobRunning = jobState.kind === 'running';

  return (
    <section
      className="card-flat"
      style={{
        marginBottom: 18,
        padding: 18,
        background: 'var(--paper-2, #f0eada)',
        border: '1px solid var(--clay, #C96442)',
        borderRadius: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>AI pronunciation check</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5, maxWidth: 720 }}>
            Read the entire script aloud in one take. While you record, a karaoke highlight sweeps word-by-word through the script below to pace you -- use <strong>Karaoke speed</strong> to adjust. Your recording is converted to WAV and uploaded to Gemini for audio-based grading on pronunciation, naturalness, and fluency. All speakers can be voiced by you -- character matching isn't graded.
          </div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="btn btn-ghost"
          style={{ padding: '4px 10px', fontSize: 12, flexShrink: 0 }}
        >
          Close
        </button>
      </div>

      <PronCheckHistory runs={history} />

      {onSpeedChange && (
        <div
          style={{
            marginBottom: 14,
            padding: '12px 14px',
            background: 'var(--card)',
            border: '1px solid var(--rule)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="eyebrow" style={{ flex: '0 0 auto' }}>
              Karaoke speed
            </span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', flex: 1, minWidth: 200 }}>
              Sets the pace of the word-by-word highlight that guides you while recording.
            </span>
            <span
              className="mono"
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--clay, #C96442)',
                minWidth: 50,
                textAlign: 'right',
              }}
            >
              {speedValue.toFixed(2)}×
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {SPEED_PRESETS.map(p => {
              const active = Math.abs(speedValue - p.value) < 0.01;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onSpeedChange(p.value)}
                  className={active ? 'btn btn-clay' : 'btn btn-ghost'}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                  }}
                  title={p.hint}
                >
                  {p.label} · {p.value.toFixed(1)}×
                </button>
              );
            })}
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={speedValue}
              onChange={e => onSpeedChange(parseFloat(e.target.value))}
              style={{ flex: 1, minWidth: 160, accentColor: 'var(--clay, #C96442)' }}
              aria-label="Karaoke speed"
            />
          </div>
        </div>
      )}

      <div
        style={{
          padding: '14px 16px',
          background: 'var(--card)',
          border: '1px solid var(--rule)',
          borderRadius: 8,
          marginBottom: 14,
        }}
      >
        {recState.kind === 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={startRecording}
              className="btn btn-clay"
              style={{ padding: '10px 18px', fontSize: 14 }}
              disabled={jobRunning}
            >
              Record full take
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              Reads the whole script in one go. Up to 4 minutes.
            </span>
          </div>
        )}

        {recState.kind === 'requesting' && (
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Requesting microphone...</div>
        )}

        {recState.kind === 'recording' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={stopRecording}
              className="btn btn-dark"
              style={{ padding: '10px 18px', fontSize: 14 }}
            >
              Stop &amp; review
            </button>
            <div className="mono" style={{ fontSize: 14, color: 'var(--clay-deep, #b1502d)', fontWeight: 600 }}>
              {formatSeconds(recElapsed)}
            </div>
            <div
              style={{
                position: 'relative',
                flex: 1,
                minWidth: 120,
                height: 6,
                background: 'var(--rule)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
              aria-label="Microphone level"
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${Math.round(level * 100)}%`,
                  background: 'var(--clay, #C96442)',
                  transition: 'width 60ms linear',
                }}
              />
            </div>
            {/* The live recognizer transcript is intentionally NOT shown here
                -- exposing it during the take lets the learner read the screen
                instead of practising. The captured transcript is revealed on
                the review tile after Stop &amp; review. */}
          </div>
        )}

        {recState.kind === 'recorded' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                Recording captured · {recState.durationSec}s
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={handleDiscard}
                className="btn btn-ghost"
                style={{
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderColor: 'var(--clay, #C96442)',
                  color: 'var(--clay-deep, #b1502d)',
                }}
                disabled={jobRunning}
                title="Throw this take away and record a fresh one."
              >
                ↻ Retake
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="btn btn-clay"
                style={{ padding: '8px 16px', fontSize: 13 }}
                disabled={jobRunning}
              >
                {jobRunning ? 'Sending...' : 'Send to Gemini'}
              </button>
            </div>
            {recordedUrl && (
              <audio src={recordedUrl} controls style={{ width: '100%' }} />
            )}
            {recognizerSupported && (
              <div
                style={{
                  padding: '8px 10px',
                  background: 'var(--paper-2, #f0eada)',
                  border: '1px solid var(--rule)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--ink-2)',
                  lineHeight: 1.5,
                }}
              >
                <div className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.12em', marginBottom: 4 }}>
                  LOCAL TRANSCRIPT (browser recognizer · for your reference only)
                </div>
                {finalTranscript || (
                  <span style={{ color: 'var(--ink-4)' }}>
                    (empty -- the recognizer didn't catch any words)
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {recState.kind === 'denied' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                padding: '8px 10px',
                background: 'var(--warn-bg, #fff8e1)',
                border: '1px solid var(--warn, #f9a825)',
                borderRadius: 6,
                fontSize: 12.5,
                color: 'var(--ink-2)',
              }}
            >
              {recState.message}
            </div>
            <button
              type="button"
              onClick={() => setRecState({ kind: 'idle' })}
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: 12, alignSelf: 'flex-start' }}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {jobState.kind === 'running' && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: 'var(--card)',
            border: '1px solid var(--clay, #C96442)',
            borderRadius: 8,
            fontSize: 12.5,
            color: 'var(--clay-deep, #b1502d)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span className="mono" style={{ fontSize: 11, letterSpacing: '.08em' }}>
            GEMINI · {jobState.stage.toUpperCase()}
          </span>
          <span>{describeStage(jobState.stage)}</span>
          <span style={{ flex: 1 }} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {Math.floor(elapsedMs / 1000)}s
          </span>
        </div>
      )}

      {jobState.kind === 'error' && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: 'var(--err-bg, #ffebee)',
            border: '1px solid var(--err, #c62828)',
            borderRadius: 8,
            fontSize: 12.5,
            color: 'var(--err, #c62828)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{jobState.message}</div>
          {jobState.raw && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--ink-3)' }}>Show raw response</summary>
              <pre style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6, whiteSpace: 'pre-wrap' }}>{jobState.raw}</pre>
            </details>
          )}
        </div>
      )}

      {jobState.kind === 'success' && (
        <>
          {!jobState.saved && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: 'var(--warn-bg, #fff8e1)',
                border: '1px solid var(--warn, #f9a825)',
                borderRadius: 6,
                fontSize: 12.5,
                color: 'var(--ink-2)',
                lineHeight: 1.5,
              }}
            >
              <strong>Not saved to history.</strong> Average score is below {LOW_SCORE_THRESHOLD}, so this run won't show up in the progress sparkline or practice plan. Re-record a full take to log a real attempt.
            </div>
          )}
          <PronCheckReportView
            script={script}
            report={jobState.run.report}
            onDrillPhoneme={onDrillPhoneme}
          />
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleDiscard}
              className="btn btn-clay"
              style={{
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 700,
                boxShadow: '0 0 0 3px rgba(201, 100, 66, 0.20)',
              }}
              title="Clear this result and record a fresh take."
            >
              ↻ Retake
            </button>
          </div>
        </>
      )}

      <PronCheckPracticePlan runs={history} onDrillPhoneme={onDrillPhoneme} />
    </section>
  );
}

function describeStage(stage: string): string {
  switch (stage) {
    case 'opening':    return 'Opening Gemini...';
    case 'attaching':  return 'Uploading WAV...';
    case 'pasting':    return 'Pasting prompt...';
    case 'submitting': return 'Submitting...';
    case 'streaming':  return 'Gemini is grading the recording...';
    case 'extracting': return 'Reading the response...';
    case 'done':       return 'Done.';
    case 'error':      return 'Error.';
    default:           return stage;
  }
}
