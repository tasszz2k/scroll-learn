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

  function handleNewChat() {
    if (!isMine) return;
    if (busy) return;
    // dismiss() closes the Gemini window so the next question starts a fresh
    // conversation without inherited history.
    dismiss(CHAT_CONTEXT_KEY);
    setQuestion('');
    textareaRef.current?.focus();
  }

  // Show the header whenever a conversation exists in this context, so a
  // "New chat" affordance is always reachable from the top of the panel.
  const showHeader = isMine;

  return (
    <div className="chat-panel">
      {showHeader && (
        <div className="chat-header">
          <span className="mono chat-header-label">Conversation</span>
          <button
            type="button"
            className="btn btn-ghost chat-new-btn"
            onClick={handleNewChat}
            disabled={busy}
            title="Clear chat history and start a fresh conversation"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              aria-hidden="true"
              style={{ marginRight: 6, verticalAlign: '-2px' }}
            >
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            New chat
          </button>
        </div>
      )}

      <div className="chat-history">
        {!isMine && (
          <div className="chat-empty">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Chat with the tutor</div>
            <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.5 }}>
              Ask a follow-up question while you study. The tutor remembers
              earlier turns until you start a new chat or close the panel.
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
            // Enter sends; Shift+Enter inserts a newline. Ignore IME composition
            // so accented input on macOS / CJK input methods isn't swallowed.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <div className="chat-composer-row">
          <span className="mono chat-composer-hint">
            Enter to send, Shift + Enter for newline
          </span>
          <button
            type="submit"
            className="btn btn-clay"
            style={{ padding: '8px 16px', fontSize: 13 }}
            disabled={busy || !question.trim()}
          >
            {busy && isMine ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}
