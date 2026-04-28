import { useEffect, useRef, useState } from 'react';
import AiAssistPanel from '../dashboard/components/aiAssist/AiAssistPanel';
import { buildFreeformAskPrompt } from '../dashboard/components/aiAssist/prompts';
import { useGeminiAssist } from '../dashboard/components/aiAssist/useGeminiAssist';

// Single conversation thread for the sidebar Chat tab. The shared assist store
// reuses the underlying Gemini window when contextKey is unchanged, so each
// follow-up question inherits the chat history server-side.
const CHAT_CONTEXT_KEY = 'chat:sidebar';

export default function ChatPanel() {
  const { state, busy, start, dismiss } = useGeminiAssist();
  const [question, setQuestion] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The store can be busy with another contextKey (e.g. a card explain in
  // another tab/window). Disable send so we don't clobber that job.
  const isMine = state.kind !== 'idle' && state.contextKey === CHAT_CONTEXT_KEY;
  const otherBusy = busy && !isMine;

  // For prompt framing -- only the first turn in the Gemini window needs the
  // tutor system framing. Subsequent turns ride on the chat history.
  const completedTurns =
    state.kind === 'idle'
      ? 0
      : state.history.length + (state.kind === 'success' ? 1 : 0);
  const isFirstTurn = completedTurns === 0;

  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy]);

  async function handleSend() {
    if (busy) return;
    const q = question.trim();
    if (!q) return;
    await start({
      prompt: buildFreeformAskPrompt(q, isFirstTurn),
      contextKey: CHAT_CONTEXT_KEY,
      userTurn: q,
    });
    setQuestion('');
  }

  function handleReset() {
    if (state.kind === 'idle') return;
    if (busy) return;
    // dismiss() closes the Gemini window so the next question starts a fresh
    // conversation without inherited history.
    dismiss(CHAT_CONTEXT_KEY);
  }

  return (
    <div className="chat-panel">
      <div className="chat-history">
        {!isMine && (
          <div className="chat-empty">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Chat with the tutor</div>
            <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.5 }}>
              Ask a follow-up question while you study. The tutor remembers
              earlier turns until you reset the chat or close the panel.
            </p>
            {otherBusy && (
              <p
                className="mono"
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  color: 'var(--ink-3)',
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                }}
              >
                AI busy with another request
              </p>
            )}
          </div>
        )}

        {isMine && (
          <AiAssistPanel
            state={state}
            onDismiss={() => dismiss(CHAT_CONTEXT_KEY)}
          />
        )}
      </div>

      <form
        className="chat-composer"
        onSubmit={e => {
          e.preventDefault();
          void handleSend();
        }}
      >
        <textarea
          ref={textareaRef}
          className="input-editorial chat-input"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder={otherBusy
            ? 'AI busy elsewhere -- try again in a moment'
            : isMine
              ? 'Ask another follow-up...'
              : 'Ask anything about your studies...'}
          rows={3}
          disabled={busy}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <div className="chat-composer-row">
          <span className="mono chat-composer-hint">
            Cmd/Ctrl + Enter to send
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {isMine && !busy && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={handleReset}
                title="Clear chat history and close the Gemini window"
              >
                Reset
              </button>
            )}
            <button
              type="submit"
              className="btn btn-clay"
              style={{ padding: '8px 16px', fontSize: 13 }}
              disabled={busy || !question.trim()}
            >
              {busy && isMine ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
