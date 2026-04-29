import { useMemo, useState } from 'react';
import type { Card, Note } from '../../../common/types';
import AiAssistPanel from './AiAssistPanel';
import {
  buildCardAskPrompt,
  buildCardExplainPrompt,
  buildNoteAskPrompt,
  buildNoteExplainPrompt,
} from './prompts';
import { useGeminiAssist } from './useGeminiAssist';

type Subject =
  | { kind: 'card'; card: Card }
  | { kind: 'note'; note: Note };

interface AiAssistTriggerProps {
  subject: Subject;
  // Visual variant. 'inline' fits on a row beside other small actions; 'card'
  // takes a full-width slot under the answer feedback.
  variant?: 'inline' | 'card';
}

function contextKeyFor(subject: Subject): string {
  return subject.kind === 'card' ? `card:${subject.card.id}` : `note:${subject.note.id}`;
}

function buildExplainPrompt(subject: Subject): string {
  return subject.kind === 'card'
    ? buildCardExplainPrompt(subject.card)
    : buildNoteExplainPrompt(subject.note);
}

function buildAskPrompt(subject: Subject, question: string): string {
  return subject.kind === 'card'
    ? buildCardAskPrompt(subject.card, question)
    : buildNoteAskPrompt(subject.note, question);
}

export default function AiAssistTrigger({ subject, variant = 'card' }: AiAssistTriggerProps) {
  const { state, busy, start, dismiss } = useGeminiAssist();
  // The pre-conversation Ask toggle. Once a conversation starts, the
  // textarea is always visible alongside the panel and this flag is unused.
  const [askMode, setAskMode] = useState(false);
  const [question, setQuestion] = useState('');

  const contextKey = useMemo(() => contextKeyFor(subject), [subject]);
  const isMine = state.kind !== 'idle' && state.contextKey === contextKey;
  const otherBusy = busy && !isMine;
  // A conversation is live for this subject -- panel is mounted and the
  // composer should always be visible (Send disabled while running).
  const inConversation = isMine;
  // A follow-up reuses the existing Gemini window, so the model already has
  // the full card/note framing in chat history. Only kind === 'success' is
  // safe: on 'error', useGeminiAssist drops activeHandle and the next start()
  // opens a fresh window with no context. 'running' is filtered by start()
  // itself (busy check).
  const isFollowUp = isMine && state.kind === 'success';

  async function handleExplain() {
    if (busy) return;
    setAskMode(false);
    await start({
      // Follow-up: bare nudge, since Gemini already has the card / note
      // framing in chat history.
      prompt: isFollowUp ? 'Explain again, going deeper this time.' : buildExplainPrompt(subject),
      contextKey,
      userTurn: 'Explain this',
    });
  }

  async function submitQuestion(): Promise<void> {
    if (busy) return;
    const q = question.trim();
    if (!q) return;
    await start({
      // Follow-up: send exactly what the user typed -- the prior turn already
      // installed the card / note context in Gemini's chat history. Re-sending
      // the wrapped prompt with CARD/NOTE blocks every turn is overwhelming
      // and noisy; the user explicitly asked for the bare input.
      prompt: isFollowUp ? q : buildAskPrompt(subject, q),
      contextKey,
      userTurn: q,
    });
    setQuestion('');
    setAskMode(false);
  }

  const buttonStyle =
    variant === 'inline'
      ? { padding: '4px 10px', fontSize: 12 }
      : { padding: '6px 12px', fontSize: 12 };

  // Soft clay-tinted ghost for the secondary "Ask" button -- highlighted
  // enough to feel actionable next to the primary clay-filled "Explain",
  // without competing with it.
  const askButtonStyle = {
    ...buttonStyle,
    color: 'var(--clay-deep)',
    borderColor: 'var(--clay-tint)',
    background: 'var(--clay-wash)',
  };

  const disabledTitle = otherBusy
    ? 'AI is busy with another request'
    : undefined;

  const composer = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <textarea
        className="input-editorial"
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder={
          inConversation
            ? 'Ask a follow-up question...'
            : 'Ask a question about this...'
        }
        style={{ minHeight: 60, fontFamily: 'inherit', resize: 'vertical', flex: 1 }}
        onKeyDown={e => {
          // Enter sends; Shift+Enter inserts a newline. Ignore IME composition
          // so accented input on macOS / CJK input methods isn't swallowed.
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submitQuestion();
          }
        }}
        autoFocus={!inConversation}
      />
      <button
        type="button"
        className="btn btn-clay"
        style={{ padding: '8px 14px', fontSize: 12, alignSelf: 'flex-start' }}
        onClick={submitQuestion}
        disabled={busy || !question.trim()}
        title={busy ? 'Waiting for the current response to finish...' : undefined}
      >
        Send
      </button>
    </div>
  );

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="btn btn-clay"
          style={buttonStyle}
          onClick={handleExplain}
          disabled={busy}
          title={disabledTitle}
        >
          {isMine && state.kind === 'running' ? 'Streaming...' : 'Explain'}
        </button>
        {/* The standalone "Ask" toggle only matters before a conversation
            starts -- once the panel is up, the composer below is always
            visible. */}
        {!inConversation && (
          <button
            type="button"
            className="btn btn-ghost"
            style={askButtonStyle}
            onClick={() => setAskMode(v => !v)}
            disabled={busy}
            title={disabledTitle}
          >
            {askMode ? 'Cancel ask' : 'Ask'}
          </button>
        )}
        {otherBusy && (
          <span
            className="mono"
            style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 4 }}
          >
            AI busy elsewhere
          </span>
        )}
      </div>

      {!inConversation && askMode && !busy && (
        <div style={{ marginTop: 10 }}>{composer}</div>
      )}

      {isMine && (
        <AiAssistPanel
          state={state}
          onDismiss={() => dismiss(contextKey)}
        />
      )}

      {inConversation && (
        <div style={{ marginTop: 10 }}>{composer}</div>
      )}
    </div>
  );
}
