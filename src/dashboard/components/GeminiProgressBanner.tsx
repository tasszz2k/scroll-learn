import type { GeminiJobStage } from '../../common/types';
import type { AiState } from '../hooks/useGeminiAutomation';

const STAGE_LABELS: Record<GeminiJobStage, string> = {
  opening: 'Opening Gemini in the background...',
  attaching: 'Uploading attachment...',
  pasting: 'Pasting your prompt...',
  submitting: 'Submitting to Gemini...',
  streaming: 'Gemini is generating cards (this can take a minute or two)...',
  extracting: 'Reading the response...',
  done: 'Done. Review the cards in Import.',
  error: 'Gemini automation failed.',
  fallback: 'Gemini automation fell back to manual mode.',
};

const STAGE_PERCENT: Record<GeminiJobStage, number> = {
  opening: 8,
  attaching: 14,
  pasting: 20,
  submitting: 32,
  streaming: 60,
  extracting: 88,
  done: 100,
  error: 100,
  fallback: 100,
};

// During the long "streaming" phase, creep the bar forward over time so the UI
// never looks frozen. Caps at 86% so we leave room for the "extracting" jump.
function currentPercent(stage: GeminiJobStage, elapsedMs: number): number {
  const base = STAGE_PERCENT[stage];
  if (stage !== 'streaming') return base;
  const elapsedSec = elapsedMs / 1000;
  // Skip the first 4s of waiting so the animation doesn't fire prematurely
  // before the model has started streaming, then add ~0.24%/s -- roughly 110s
  // to creep the remaining 26 percentage points to 86.
  const creep = Math.min(26, Math.max(0, elapsedSec - 4) * 0.24);
  return base + creep;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Show the trailing slice of the in-flight text so the panel doesn't grow
// without bound even when Gemini emits a 50KB CSV. Roughly 18 lines or 1.6KB
// of trailing text, whichever is smaller -- enough to confirm the model is
// generating useful content but short enough to fit in a card.
const LIVE_PREVIEW_MAX_CHARS = 1600;
const LIVE_PREVIEW_MAX_LINES = 18;

function tailFor(text: string): string {
  if (!text) return '';
  let body = text.length > LIVE_PREVIEW_MAX_CHARS
    ? text.slice(text.length - LIVE_PREVIEW_MAX_CHARS)
    : text;
  const lines = body.split('\n');
  if (lines.length > LIVE_PREVIEW_MAX_LINES) {
    body = lines.slice(lines.length - LIVE_PREVIEW_MAX_LINES).join('\n');
  }
  return body;
}

interface GeminiProgressBannerProps {
  aiState: AiState;
  aiElapsedMs: number;
  liveText?: string;
  onDismissError: () => void;
}

/**
 * Renders the running-progress and error-state banners for an in-flight
 * Gemini automation job. Returns null when there's nothing to show
 * (idle / success), so callers can drop it inline without guarding.
 */
// Tiny pill that surfaces which transport the router committed to. 'API'
// means a direct REST call; 'Browser' means the legacy gemini.google.com
// automation. The active model name is appended on the API path so the
// learner can correlate quota changes with the running call.
function SourcePill({ source, model }: { source: 'api' | 'web'; model?: string }) {
  const label = source === 'api'
    ? (model ? `API · ${model}` : 'API')
    : 'Browser';
  return (
    <span
      className="mono"
      style={{
        marginLeft: 10,
        padding: '1px 8px',
        borderRadius: 999,
        border: '1px solid rgba(184,146,58,.45)',
        background: 'rgba(184,146,58,.12)',
        fontSize: 10,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

export default function GeminiProgressBanner({ aiState, aiElapsedMs, liveText, onDismissError }: GeminiProgressBannerProps) {
  if (aiState.kind === 'running') {
    const preview = tailFor(liveText ?? '');
    const charCount = liveText ? liveText.length : 0;
    const source = aiState.source;
    return (
      <div
        className="card-flat"
        style={{
          padding: '16px 18px',
          marginTop: -20,
          marginBottom: 32,
          background: 'rgba(184,146,58,.08)',
          borderColor: 'rgba(184,146,58,.30)',
          color: '#6E5A20',
        }}
      >
        <div
          className="eyebrow"
          style={{
            color: '#6E5A20',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
          }}
        >
          <span>
            Generating with Gemini
            {source && <SourcePill source={source} model={aiState.model} />}
          </span>
          <span className="mono" style={{ fontSize: 11, opacity: 0.85 }}>
            {charCount > 0 && (
              <span style={{ marginRight: 12 }}>
                {charCount.toLocaleString()} ch
              </span>
            )}
            {formatElapsed(aiElapsedMs)} elapsed
          </span>
        </div>
        <div className="progress-bar-track" style={{ marginTop: 10 }}>
          <div
            className="progress-bar-fill"
            style={{ width: `${currentPercent(aiState.stage, aiElapsedMs)}%` }}
          />
        </div>
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.5 }}>
          {STAGE_LABELS[aiState.stage] || 'Working with Gemini...'}
          {aiState.detail && (
            <span style={{ opacity: 0.7 }}> ({aiState.detail})</span>
          )}
        </div>
        {preview && (
          <pre
            aria-live="polite"
            aria-label="Live Gemini output"
            style={{
              marginTop: 12,
              marginBottom: 0,
              padding: '10px 12px',
              background: 'rgba(0,0,0,.04)',
              border: '1px solid rgba(184,146,58,.25)',
              borderRadius: 6,
              fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
              fontSize: 11.5,
              lineHeight: 1.55,
              color: '#5C4A18',
              maxHeight: 220,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {preview}
          </pre>
        )}
        {source !== 'api' && (
          <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, opacity: 0.78 }}>
            A small Gemini window opens behind this one and closes itself when done. Don't minimize the Chrome window -- Chrome freezes minimized windows and the run will time out.
          </div>
        )}
      </div>
    );
  }

  if (aiState.kind === 'error') {
    return (
      <div
        className="card-flat"
        style={{
          padding: '14px 18px',
          marginTop: -20,
          marginBottom: 32,
          background: 'rgba(196,115,107,.08)',
          borderColor: 'rgba(196,115,107,.30)',
          color: '#8A4A42',
          fontSize: 13,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span>Gemini automation failed: {aiState.message}</span>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: '6px 12px', fontSize: 12 }}
          onClick={onDismissError}
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
