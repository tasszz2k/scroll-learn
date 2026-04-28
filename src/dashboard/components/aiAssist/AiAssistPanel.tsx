import { useEffect, useState } from 'react';
import RenderBackExtra from '../study/RenderBackExtra';
import type { AiAssistState, ConversationTurn } from './useGeminiAssist';

interface AiAssistPanelProps {
  // Pre-filtered: caller has already verified state belongs to its contextKey.
  state: Extract<AiAssistState, { kind: 'running' } | { kind: 'success' } | { kind: 'error' }>;
  onDismiss: () => void;
}

const STAGE_HINT: Record<string, string> = {
  opening: 'Opening Gemini in the background...',
  pasting: 'Pasting your prompt...',
  submitting: 'Submitting to Gemini...',
  streaming: 'Gemini is responding...',
  extracting: 'Reading the response...',
  done: 'Done.',
  error: 'Failed.',
  fallback: 'Falling back...',
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const BUBBLE_BASE: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--rule)',
  padding: '10px 14px',
  maxWidth: '85%',
  fontSize: 14,
  lineHeight: 1.55,
};

function UserBubble({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          ...BUBBLE_BASE,
          background: 'var(--paper-2)',
          borderColor: 'var(--rule-2)',
          color: 'var(--ink)',
          fontFamily: 'inherit',
          whiteSpace: 'pre-wrap',
          maxWidth: '75%',
        }}
      >
        <div
          className="eyebrow"
          style={{
            color: 'var(--ink-3)',
            fontSize: 10,
            marginBottom: 4,
            letterSpacing: '.08em',
          }}
        >
          You
        </div>
        <div className="serif" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
          {text}
        </div>
      </div>
    </div>
  );
}

interface AiBubbleProps {
  text: string;
  status?: string;
  streaming?: boolean;
}

function AiBubble({ text, status, streaming }: AiBubbleProps) {
  const showResponse = text.trim().length > 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div
        style={{
          ...BUBBLE_BASE,
          background: streaming ? 'rgba(184,146,58,.06)' : 'var(--paper)',
          borderColor: streaming ? 'rgba(184,146,58,.30)' : 'var(--rule)',
        }}
      >
        <div
          className="eyebrow"
          style={{
            color: streaming ? '#6E5A20' : 'var(--ink-3)',
            fontSize: 10,
            marginBottom: 6,
            letterSpacing: '.08em',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>AI assist{streaming ? ' · streaming' : ''}</span>
          {status && (
            <span className="mono" style={{ fontSize: 10, opacity: 0.85, fontWeight: 400 }}>
              {status}
            </span>
          )}
        </div>
        {showResponse ? (
          <RenderBackExtra text={text} />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {status || 'Working...'}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryTurn({ turn }: { turn: ConversationTurn }) {
  return (
    <>
      <UserBubble text={turn.question} />
      <AiBubble text={turn.response} />
    </>
  );
}

export default function AiAssistPanel({ state, onDismiss }: AiAssistPanelProps) {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copied, setCopied] = useState(false);

  const startedAt = state.kind === 'running' ? state.startedAt : null;

  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 500);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const isRunning = state.kind === 'running';
  const isError = state.kind === 'error';

  const stageHint = isRunning
    ? STAGE_HINT[state.stage] || 'Working with Gemini...'
    : isError
      ? 'Failed.'
      : 'Done.';

  const status = isRunning
    ? `${formatElapsed(elapsedMs)} · ${stageHint}`
    : stageHint;

  const currentText = isRunning || state.kind === 'success' ? state.text : '';

  // Concatenate the entire conversation for the Copy action -- otherwise
  // hitting Copy after a follow-up would only grab the latest turn.
  const fullText = [
    ...state.history.map(t => `## ${t.question}\n\n${t.response}`),
    `## ${state.currentQuestion}\n\n${currentText}`,
  ].join('\n\n');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard rejected; ignore */
    }
  }

  return (
    <div
      className="card-flat"
      style={{
        padding: '14px',
        marginTop: 12,
        background: 'var(--paper)',
        borderColor: 'var(--rule)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {state.history.map((turn, i) => (
        <HistoryTurn key={`h-${i}`} turn={turn} />
      ))}

      <UserBubble text={state.currentQuestion} />

      {isError ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-start',
          }}
        >
          <div
            style={{
              ...BUBBLE_BASE,
              background: 'rgba(196,115,107,.08)',
              borderColor: 'rgba(196,115,107,.30)',
              color: '#8A4A42',
              fontSize: 13,
            }}
          >
            <div
              className="eyebrow"
              style={{
                fontSize: 10,
                marginBottom: 6,
                letterSpacing: '.08em',
                color: '#8A4A42',
              }}
            >
              AI assist · failed
            </div>
            <div>{state.message}</div>
          </div>
        </div>
      ) : (
        <AiBubble
          text={currentText}
          status={status}
          streaming={isRunning}
        />
      )}

      {!isRunning && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 4,
          }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={onDismiss}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
