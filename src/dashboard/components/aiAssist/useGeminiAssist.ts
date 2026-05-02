import { useSyncExternalStore } from 'react';
import { closeGeminiContext, runGeminiJob } from '../../../common/gemini/router';
import { playSuccessChime, primeChime } from '../../../common/successChime';
import type { GeminiApiModelId, GeminiJobStage } from '../../../common/types';

// A "context key" identifies the surface that started the current assist job
// (e.g. a specific flashcard or note). Multiple AiAssist components may be
// mounted at once; only the one whose contextKey matches the active job
// renders the streaming panel.
export type AiContextKey = string;

// One completed Q -> A exchange in the running conversation. We keep the
// learner-facing question label (what the user typed for "Ask", or a synthetic
// label like "Explain this card") next to the model response so the panel can
// render the full back-and-forth.
export interface ConversationTurn {
  question: string;
  response: string;
}

interface ActiveCommon {
  jobId: string;
  contextKey: AiContextKey;
  // Turns completed in this conversation, oldest first. Empty for the first
  // turn. Reset to [] whenever a new conversation (different contextKey) starts.
  history: ConversationTurn[];
  // Label for the in-flight turn -- shown above the streaming response.
  currentQuestion: string;
}

export type AiAssistState =
  | { kind: 'idle' }
  | (ActiveCommon & {
      kind: 'running';
      stage: GeminiJobStage;
      detail?: string;
      // Latest accumulated text snapshot from the router. Empty until the
      // first chunk lands.
      text: string;
      startedAt: number;
      source?: 'api' | 'web';
      model?: GeminiApiModelId;
    })
  | (ActiveCommon & {
      kind: 'success';
      // Final response text for the most recent turn.
      text: string;
      source: 'api' | 'web';
      model?: GeminiApiModelId;
    })
  | (ActiveCommon & {
      kind: 'error';
      message: string;
    });

// ---- module-level store -----------------------------------------------------
//
// Lifted out of any single React component so that two surfaces (QuizCard and
// NotesPanel) can subscribe to the same job. Only one job runs at a time.

let state: AiAssistState = { kind: 'idle' };
const subscribers = new Set<() => void>();

function snapshot(): AiAssistState {
  return state;
}

function emit(next: AiAssistState): void {
  state = next;
  subscribers.forEach(fn => fn());
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function generateJobId(): string {
  return `gemini-assist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface StartParams {
  prompt: string;
  contextKey: AiContextKey;
  // User-facing label for this turn -- shown above the response. For "Ask"
  // this is the question text; for "Explain" a synthetic label like "Explain".
  userTurn: string;
}

// Build the history array for a new run. If the previous state was a success
// in the same conversation, fold its final turn in so the panel keeps showing
// it. Anything else (idle / different subject / error) starts fresh.
function buildHistoryFor(contextKey: AiContextKey): ConversationTurn[] {
  if (state.kind === 'success' && state.contextKey === contextKey) {
    return [...state.history, { question: state.currentQuestion, response: state.text }];
  }
  if (
    (state.kind === 'error' || state.kind === 'running')
    && state.contextKey === contextKey
  ) {
    // Preserve any earlier completed turns even if the most recent attempt
    // errored or is mid-flight (the latter shouldn't actually happen because
    // start() bails when busy).
    return state.history;
  }
  return [];
}

async function start({ prompt, contextKey, userTurn }: StartParams): Promise<void> {
  if (state.kind === 'running') return;

  // Unlock the success chime's audio element while we're still inside the
  // user-click frame; without this Chrome's autoplay policy blocks the
  // later success play() (which fires from a callback, not a gesture).
  primeChime();

  const jobId = generateJobId();
  const history = buildHistoryFor(contextKey);
  emit({
    kind: 'running',
    jobId,
    contextKey,
    history,
    currentQuestion: userTurn,
    stage: 'opening',
    text: '',
    startedAt: Date.now(),
  });

  // Translate the conversation history into the router's role/text shape.
  // Each completed turn maps to a (user, model) pair.
  const apiHistory = history.flatMap(turn => [
    { role: 'user' as const, text: turn.question },
    { role: 'model' as const, text: turn.response },
  ]);

  const result = await runGeminiJob(
    {
      prompt,
      mode: 'explain',
      history: apiHistory,
      contextKey,
    },
    {
      onStage: (stage, detail) => {
        if (state.kind !== 'running' || state.jobId !== jobId) return;
        emit({ ...state, stage, detail });
      },
      onChunk: text => {
        if (state.kind !== 'running' || state.jobId !== jobId) return;
        if (text === state.text) return;
        emit({ ...state, text });
      },
      onSource: (source, model) => {
        if (state.kind !== 'running' || state.jobId !== jobId) return;
        emit({ ...state, source, model });
      },
    },
  );

  // Read the current state via the module-level snapshot; TS over-narrows
  // `state` across the await otherwise.
  const after = snapshot();
  if (after.kind !== 'running' || after.jobId !== jobId) return;

  if (result.ok) {
    const finalText = (result.text ?? after.text ?? '').trim();
    emit({
      kind: 'success',
      jobId,
      contextKey,
      history,
      currentQuestion: userTurn,
      text: finalText,
      source: result.source,
      model: result.model,
    });
    playSuccessChime();
    // The router keeps the Gemini window open (web path) so the next start()
    // for the same contextKey reuses the chat history.
  } else {
    emit({
      kind: 'error',
      jobId,
      contextKey,
      history,
      currentQuestion: userTurn,
      message: result.error,
    });
    // Drop any cached window for this conversation so a follow-up opens a
    // fresh one rather than colliding with a stale tab the user is reading.
    void closeGeminiContext(contextKey);
  }
}

function dismiss(contextKey: AiContextKey): void {
  if (state.kind === 'idle') return;
  if (state.contextKey !== contextKey) return;
  if (state.kind === 'running') return; // can't dismiss a live job
  emit({ kind: 'idle' });
  // The conversation is over; close the Gemini window so the next assist
  // request starts from a fresh chat.
  void closeGeminiContext(contextKey);
}

export interface UseGeminiAssistApi {
  state: AiAssistState;
  busy: boolean;
  start: (params: StartParams) => Promise<void>;
  dismiss: (contextKey: AiContextKey) => void;
}

/**
 * Subscribe a component to the shared assist store. All consumers across the
 * dashboard see the same state so only one Gemini job runs at a time, and the
 * surface that triggered the job (identified by contextKey) renders the live
 * panel.
 */
export function useGeminiAssist(): UseGeminiAssistApi {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    state: current,
    busy: current.kind === 'running',
    start,
    dismiss,
  };
}
