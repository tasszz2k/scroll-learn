import { useSyncExternalStore } from 'react';
import type { GeminiJobStage } from '../../../common/types';
import {
  closeGeminiWindow,
  isGeminiWindowAlive,
  openGeminiWindow,
  type GeminiWindowHandle,
} from '../../utils/geminiTab';

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
      // Latest accumulated text snapshot from the content script. Empty until
      // the streamer starts forwarding chunks.
      text: string;
      startedAt: number;
    })
  | (ActiveCommon & {
      kind: 'success';
      // Final response text for the most recent turn.
      text: string;
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

let activeHandle: GeminiWindowHandle | null = null;
// The contextKey of the conversation currently loaded in activeHandle. Used
// to decide whether a new start() can reuse the window (same subject = chat
// follow-up) or must open a fresh one (different subject = clean context).
let activeContextKey: AiContextKey | null = null;
let activeTimeoutId: number | null = null;
let listenerInstalled = false;

function snapshot(): AiAssistState {
  return state;
}

function emit(next: AiAssistState): void {
  state = next;
  subscribers.forEach(fn => fn());
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn);
  installRuntimeListener();
  return () => subscribers.delete(fn);
}

function clearActiveTimeout(): void {
  if (activeTimeoutId !== null) {
    window.clearTimeout(activeTimeoutId);
    activeTimeoutId = null;
  }
}

async function closeActiveWindow(): Promise<void> {
  const handle = activeHandle;
  activeHandle = null;
  activeContextKey = null;
  await closeGeminiWindow(handle);
}

function installRuntimeListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object') return;
    const m = message as { type?: string; jobId?: string };
    if (!m.type || !m.jobId) return;
    if (state.kind !== 'running' || state.jobId !== m.jobId) return;

    if (m.type === 'gemini_job_status') {
      const status = message as { stage: GeminiJobStage; detail?: string };
      emit({ ...state, stage: status.stage, detail: status.detail });
      return;
    }

    if (m.type === 'gemini_stream_chunk') {
      const chunk = message as { text: string; done: boolean };
      if (typeof chunk.text === 'string' && chunk.text !== state.text) {
        emit({ ...state, text: chunk.text });
      }
      return;
    }

    if (m.type === 'gemini_result') {
      const result = message as { ok: boolean; text?: string; error?: string };
      clearActiveTimeout();
      if (result.ok) {
        const finalText = (result.text ?? state.text ?? '').trim();
        emit({
          kind: 'success',
          jobId: state.jobId,
          contextKey: state.contextKey,
          history: state.history,
          currentQuestion: state.currentQuestion,
          text: finalText,
        });
        // Keep the Gemini window open so the next Ask click can reuse the
        // same conversation and inherit the chat history. The window is
        // closed on dismiss(), on dashboard unload, or when the user closes
        // it manually.
      } else {
        // Leave the Gemini window open on failure so the user can inspect it.
        // Drop our handle so a follow-up opens a fresh window instead of
        // colliding with the stale one the user is reading.
        activeHandle = null;
        activeContextKey = null;
        emit({
          kind: 'error',
          jobId: state.jobId,
          contextKey: state.contextKey,
          history: state.history,
          currentQuestion: state.currentQuestion,
          message: result.error || 'Unknown error',
        });
      }
    }
  });
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

  installRuntimeListener();

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

  try {
    // Reuse the existing Gemini window only when this start() targets the
    // SAME subject as the previous run (e.g. a follow-up about the same
    // card/note). For a different subject we close the old window first so
    // the prior chat context doesn't bleed into the new conversation.
    const sameSubject = activeContextKey === contextKey;
    const reuse = sameSubject
      && activeHandle !== null
      && (await isGeminiWindowAlive(activeHandle));

    if (!reuse) {
      // Close any leftover window from a different subject before opening a
      // fresh one. closeActiveWindow clears activeContextKey too.
      if (activeHandle) await closeActiveWindow();
    }

    await chrome.storage.local.set({
      geminiJob: { jobId, prompt, mode: 'explain', createdAt: Date.now() },
    });

    if (!reuse) {
      // Open Gemini as the active tab in a new unfocused window. See
      // utils/geminiTab.ts for why -- background tabs in the dashboard window
      // get throttled and Angular stops updating, which kills automation.
      activeHandle = await openGeminiWindow();
      activeContextKey = contextKey;
    }
  } catch (err) {
    emit({
      kind: 'error',
      jobId,
      contextKey,
      history,
      currentQuestion: userTurn,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  clearActiveTimeout();
  activeTimeoutId = window.setTimeout(() => {
    if (state.kind === 'running' && state.jobId === jobId) {
      emit({
        kind: 'error',
        jobId,
        contextKey,
        history,
        currentQuestion: userTurn,
        message: 'Gemini did not respond within 5 minutes. Try again or run the prompt manually.',
      });
      void closeActiveWindow();
    }
  }, 5 * 60 * 1000);
}

function dismiss(contextKey: AiContextKey): void {
  if (state.kind === 'idle') return;
  if (state.contextKey !== contextKey) return;
  if (state.kind === 'running') return; // can't dismiss a live job
  emit({ kind: 'idle' });
  // The conversation is over; close the Gemini window so the next assist
  // request starts from a fresh chat.
  void closeActiveWindow();
}

// Best-effort cleanup if the user closes / navigates away from the dashboard
// while a Gemini conversation window is still open in the background.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (activeHandle) void closeActiveWindow();
  });
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
