import { useState } from 'react';
import type { Notebook } from '../../../common/types';
import { useGeminiAssist } from '../aiAssist/useGeminiAssist';
import { useGeminiAutomation } from '../../hooks/useGeminiAutomation';
import RenderBackExtra from '../study/RenderBackExtra';
import {
  buildNotebookAskPrompt,
  buildNotebookQuizPrompt,
  buildNotebookSummarizePrompt,
} from './notebookPrompts';

interface NotebookAiPanelProps {
  notebook: Notebook;
  body: string;
  // Called when the panel produces a CSV that should populate the Import
  // tab. Mirrors NotesPanel's onPendingImport contract.
  onPendingImport?: (payload: { content: string; format: 'csv'; deckName: string }) => void;
  // Lets the editor inject the most-recent AI text back into the body at
  // the cursor (used by Summarize "Insert at cursor" affordance).
  onInsertText: (text: string) => void;
  onClose: () => void;
  // Sidebar-only: when the panel is rendered as a bottom sheet, expose a
  // maximize toggle so a long conversation has room to breathe. Both
  // props omitted => no toggle button. Dashboard mode (right column)
  // doesn't need this.
  maximized?: boolean;
  onToggleMaximize?: () => void;
}

export default function NotebookAiPanel({
  notebook,
  body,
  onPendingImport,
  onInsertText,
  onClose,
  maximized,
  onToggleMaximize,
}: NotebookAiPanelProps) {
  const contextKey = `notebook:${notebook.id}`;
  const assist = useGeminiAssist();
  const automation = useGeminiAutomation({
    onResult: ({ csv, deckName }) => {
      onPendingImport?.({ content: csv, format: 'csv', deckName });
    },
  });

  const [question, setQuestion] = useState('');

  // The shared assist store only renders the panel for our contextKey.
  const visibleAssist =
    assist.state.kind !== 'idle' && assist.state.contextKey === contextKey
      ? assist.state
      : null;

  function handleAsk() {
    const q = question.trim();
    if (!q) return;
    const isFirstTurn =
      visibleAssist === null
      || (visibleAssist.kind !== 'success' && visibleAssist.kind !== 'error');
    void assist.start({
      prompt: buildNotebookAskPrompt(notebook, body, q, isFirstTurn),
      contextKey,
      userTurn: q,
    });
    setQuestion('');
  }

  function handleSummarize() {
    void assist.start({
      prompt: buildNotebookSummarizePrompt(notebook, body),
      contextKey,
      userTurn: 'Summarise this notebook',
    });
  }

  function handleGenerateQuiz() {
    void automation.sendToGemini(buildNotebookQuizPrompt(notebook, body));
  }

  const finalText =
    visibleAssist !== null && (visibleAssist.kind === 'success' || visibleAssist.kind === 'running')
      ? visibleAssist.text
      : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '8px 12px',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <div className="eyebrow" style={{ fontSize: 10 }}>AI</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onToggleMaximize && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0 8px', fontSize: 13, lineHeight: 1 }}
              aria-label={maximized ? 'Restore AI panel' : 'Maximize AI panel'}
              title={maximized ? 'Restore (shrink AI panel)' : 'Maximize AI panel'}
              onClick={onToggleMaximize}
            >
              <span aria-hidden="true">{maximized ? '\u21F2\u21F1' : '\u21F1\u21F2'}</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ padding: '0 6px', fontSize: 14, lineHeight: 1 }}
            aria-label="Close AI panel"
            onClick={onClose}
          >
            x
          </button>
        </div>
      </div>

      <div
        style={{
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <button
          type="button"
          className="btn btn-clay"
          style={{ padding: '6px 10px', fontSize: 12 }}
          onClick={handleSummarize}
          disabled={assist.busy}
        >
          Summarize this notebook
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: 12 }}
          onClick={handleGenerateQuiz}
          disabled={automation.aiState.kind === 'running'}
        >
          {automation.aiState.kind === 'running'
            ? 'Generating quiz...'
            : 'Generate quiz from this notebook'}
        </button>
      </div>

      <div
        style={{
          padding: 10,
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          gap: 6,
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAsk();
            }
          }}
          placeholder="Ask about this notebook..."
          style={{
            flex: 1,
            border: '1px solid var(--rule)',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 12,
          }}
        />
        <button
          type="button"
          className="btn btn-clay"
          style={{ padding: '4px 10px', fontSize: 11 }}
          onClick={handleAsk}
          disabled={assist.busy || question.trim() === ''}
        >
          Ask
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {automation.aiState.kind === 'error' && (
          <div style={{ marginBottom: 10, fontSize: 12, color: '#b14a2c' }}>
            Quiz failed: {automation.aiState.message}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginLeft: 6, padding: '0 6px', fontSize: 11 }}
              onClick={() => automation.dismissError()}
            >
              Dismiss
            </button>
          </div>
        )}
        {automation.aiState.kind === 'success' && (
          <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--moss)' }}>
            Generated {automation.aiState.count} cards. Switching to the Import tab...
          </div>
        )}
        {visibleAssist === null && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
            Ask anything about your notebook, or click Summarize / Generate quiz above.
          </div>
        )}
        {visibleAssist !== null && (
          <AssistConversation
            state={visibleAssist}
            onInsertText={onInsertText}
            onDismiss={() => assist.dismiss(contextKey)}
            finalText={finalText}
          />
        )}
      </div>
    </div>
  );
}

interface AssistConversationProps {
  state: NonNullable<ReturnType<typeof useGeminiAssist>['state']>;
  onInsertText: (text: string) => void;
  onDismiss: () => void;
  finalText: string;
}

function AssistConversation({ state, onInsertText, onDismiss, finalText }: AssistConversationProps) {
  if (state.kind === 'idle') return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {state.history.map((turn, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="eyebrow" style={{ fontSize: 10 }}>You</div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{turn.question}</div>
          <div className="eyebrow" style={{ fontSize: 10, marginTop: 4 }}>AI</div>
          <div style={{ fontSize: 12 }}>
            <RenderBackExtra text={turn.response} />
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="eyebrow" style={{ fontSize: 10 }}>You</div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{state.currentQuestion}</div>
        <div className="eyebrow" style={{ fontSize: 10, marginTop: 4 }}>AI</div>
        {state.kind === 'running' && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 4 }}>
            {state.stage === 'streaming' ? 'Streaming...' : 'Working...'}
          </div>
        )}
        {state.kind === 'error' && (
          <div style={{ fontSize: 12, color: '#b14a2c' }}>
            {state.message}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginLeft: 6, padding: '0 6px', fontSize: 11 }}
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </div>
        )}
        {(state.kind === 'success' || state.kind === 'running') && finalText && (
          <div style={{ fontSize: 12 }}>
            <RenderBackExtra text={finalText} />
          </div>
        )}
        {state.kind === 'success' && finalText && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => onInsertText('\n' + finalText + '\n')}
            >
              Insert at cursor
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={onDismiss}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
