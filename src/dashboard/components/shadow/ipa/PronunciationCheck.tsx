import { useCallback, useEffect, useRef, useState } from 'react';
import { combinedSimilarity } from '../../../../common/fuzzy';
import { speakWordWithIpa } from '../../../../common/speak';
import {
  cancelRecognition,
  isRecognitionSupported,
  recognizeOnce,
  type RecognizeError,
} from '../../../../common/speechRecognition';
import type { Phoneme } from './phonemes';

interface PronunciationCheckProps {
  phoneme: Phoneme;
  onProductionRecorded: (correct: boolean) => void;
}

type Verdict = 'pass' | 'close' | 'miss';

interface AttemptResult {
  transcript: string;
  similarity: number;
  verdict: Verdict;
}

const PASS_THRESHOLD = 0.85;
const CLOSE_THRESHOLD = 0.6;

function classify(sim: number): Verdict {
  if (sim >= PASS_THRESHOLD) return 'pass';
  if (sim >= CLOSE_THRESHOLD) return 'close';
  return 'miss';
}

function verdictColor(v: Verdict): { bg: string; border: string; ink: string } {
  switch (v) {
    case 'pass':
      return { bg: 'var(--ok-bg, #e8f5e9)', border: 'var(--ok, #2e7d32)', ink: 'var(--ok, #2e7d32)' };
    case 'close':
      return { bg: 'var(--warn-bg, #fff8e1)', border: 'var(--warn, #f9a825)', ink: 'var(--warn-deep, #b76d00)' };
    case 'miss':
      return { bg: 'var(--err-bg, #ffebee)', border: 'var(--err, #c62828)', ink: 'var(--err, #c62828)' };
  }
}

function verdictMessage(v: Verdict, transcript: string): string {
  switch (v) {
    case 'pass':
      return `Nice. Heard "${transcript}".`;
    case 'close':
      return `Close -- heard "${transcript}". Try again, focus on the target sound.`;
    case 'miss':
      return `Heard "${transcript || '...'}" -- try again. Listen to the model first.`;
  }
}

export default function PronunciationCheck({ phoneme, onProductionRecorded }: PronunciationCheckProps) {
  // Rotate through the phoneme's example words so the learner produces the
  // sound in different positions/contexts. Reset when the phoneme changes.
  const [wordIdx, setWordIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [partial, setPartial] = useState('');
  const [attempt, setAttempt] = useState<AttemptResult | null>(null);
  // Typed-input fallback when recognition is unsupported or denied.
  const [typed, setTyped] = useState('');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  // Whether the current target word has already had its first attempt
  // recorded; we only count the first attempt so retries don't spam stats.
  const firstAttemptDoneRef = useRef(false);

  const supported = isRecognitionSupported();
  const targetWord = phoneme.exampleWords[wordIdx % phoneme.exampleWords.length] ?? phoneme.exampleWords[0] ?? '';

  // Reset session state when the lab swaps to a different phoneme.
  useEffect(() => {
    setWordIdx(0);
    setAttempt(null);
    setPartial('');
    setTyped('');
    firstAttemptDoneRef.current = false;
    return () => {
      cancelRecognition();
    };
  }, [phoneme.symbol]);

  const playModel = useCallback(() => {
    if (!targetWord) return;
    speakWordWithIpa(targetWord);
  }, [targetWord]);

  const evaluate = useCallback(
    (heard: string) => {
      const a = heard.trim().toLowerCase();
      const b = targetWord.trim().toLowerCase();
      if (!a || !b) return;
      const sim = combinedSimilarity(a, b);
      const verdict = classify(sim);
      setAttempt({ transcript: heard.trim(), similarity: sim, verdict });
      if (!firstAttemptDoneRef.current) {
        firstAttemptDoneRef.current = true;
        onProductionRecorded(verdict === 'pass');
      }
    },
    [onProductionRecorded, targetWord],
  );

  const handleRecord = useCallback(async () => {
    if (recording) return;
    setAttempt(null);
    setPartial('');
    setPermissionError(null);
    setRecording(true);
    try {
      const result = await recognizeOnce({
        lang: 'en-US',
        onPartial: (t) => setPartial(t),
      });
      evaluate(result.transcript);
    } catch (err) {
      const recErr = err as RecognizeError;
      if (recErr.code === 'permission') {
        setPermissionError(
          'Mic permission denied. Allow microphone access in the browser site settings, or use the typed-input fallback below.',
        );
      } else if (recErr.code === 'no-speech') {
        setPermissionError("Didn't catch that. Try again and speak right after the indicator turns red.");
      } else if (recErr.code !== 'aborted') {
        setPermissionError(recErr.message || 'Recognition failed.');
      }
    } finally {
      setRecording(false);
      setPartial('');
    }
  }, [evaluate, recording]);

  const handleNextWord = useCallback(() => {
    setWordIdx((i) => (i + 1) % Math.max(1, phoneme.exampleWords.length));
    setAttempt(null);
    setPartial('');
    setTyped('');
    firstAttemptDoneRef.current = false;
  }, [phoneme.exampleWords.length]);

  const handleTypedSubmit = useCallback(
    (ev: React.FormEvent<HTMLFormElement>) => {
      ev.preventDefault();
      if (!typed.trim()) return;
      evaluate(typed);
    },
    [evaluate, typed],
  );

  const verdictStyle = attempt ? verdictColor(attempt.verdict) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Say this word</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1, color: 'var(--ink)' }}>
            {targetWord}
          </div>
          <div className="mono" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            /{phoneme.symbol}/
          </div>
          <button
            type="button"
            onClick={playModel}
            className="btn btn-ghost"
            style={{ padding: '4px 10px', fontSize: 12 }}
          >
            Listen
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
          {phoneme.mouthHint}
        </div>
      </div>

      {supported ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleRecord}
              disabled={recording}
              className={recording ? 'btn btn-ghost' : 'btn btn-clay'}
              style={{
                padding: '10px 18px',
                fontSize: 14,
                background: recording ? 'var(--err-bg, #ffebee)' : undefined,
                borderColor: recording ? 'var(--err, #c62828)' : undefined,
                color: recording ? 'var(--err, #c62828)' : undefined,
              }}
            >
              {recording ? 'Listening...' : 'Record'}
            </button>
            <button
              type="button"
              onClick={handleNextWord}
              className="btn btn-ghost"
              style={{ padding: '10px 14px', fontSize: 13 }}
            >
              Next word
            </button>
            {phoneme.exampleWords.length > 1 && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                {(wordIdx % phoneme.exampleWords.length) + 1} / {phoneme.exampleWords.length}
              </span>
            )}
          </div>
          {recording && partial && (
            <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              hearing: {partial}
            </div>
          )}
          {permissionError && (
            <div
              style={{
                padding: '8px 10px',
                background: 'var(--warn-bg, #fff8e1)',
                border: '1px solid var(--warn, #f9a825)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--ink-2)',
              }}
            >
              {permissionError}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            padding: '8px 10px',
            background: 'var(--warn-bg, #fff8e1)',
            border: '1px solid var(--warn, #f9a825)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--ink-2)',
          }}
        >
          Your browser doesn't expose SpeechRecognition. Use Chrome or Edge for live mic checking, or type
          what you'd say below to grade against the target.
        </div>
      )}

      {/* Typed-input fallback. Always rendered when recognition is unsupported,
          and also surfaced when permission is denied. */}
      {(!supported || permissionError) && (
        <form onSubmit={handleTypedSubmit} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={typed}
            onChange={(ev) => setTyped(ev.target.value)}
            placeholder="Type the word you'd say"
            className="input"
            style={{ flex: 1, fontSize: 14, padding: '8px 10px' }}
          />
          <button
            type="submit"
            className="btn btn-clay"
            style={{ padding: '8px 14px', fontSize: 13 }}
            disabled={!typed.trim()}
          >
            Check
          </button>
        </form>
      )}

      {attempt && verdictStyle && (
        <div
          style={{
            padding: '10px 12px',
            background: verdictStyle.bg,
            border: `1px solid ${verdictStyle.border}`,
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--ink)',
          }}
        >
          <div style={{ color: verdictStyle.ink, fontWeight: 600 }}>
            {verdictMessage(attempt.verdict, attempt.transcript)}
          </div>
          <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
            similarity {Math.round(attempt.similarity * 100)}%
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
        Only the first attempt on each word counts toward production stats. Retries are free practice.
      </div>
    </div>
  );
}
