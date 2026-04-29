// Shared helper for opening / closing the Gemini automation tab.
//
// IMPORTANT: do NOT use `chrome.tabs.create({ active: false })` here.
//
// A background tab in the dashboard's window has `document.visibilityState ===
// 'hidden'`. Chrome aggressively throttles timers on hidden tabs (often to
// 1 Hz, and after several minutes can apply "intensive throttling" or freeze
// the tab entirely). Worse, Gemini is an Angular SPA whose change-detection
// cycle effectively pauses on hidden tabs, so the DOM never updates the
// stop-button state until the tab becomes visible again. Both effects together
// cause spurious "Gemini response timed out after 4 minutes" errors even
// though the model finished the response on the server side.
//
// We open Gemini in its own window. We previously used `focused: false` to
// keep the user's dashboard in front, but on macOS (App Nap + window
// occlusion) an unfocused window that's drawn behind the dashboard reports
// `document.visibilityState === 'hidden'` and Chrome throttles it the same
// way as a background tab -- so the run silently stalls until the user
// clicks the Gemini window. Opening it focused costs a brief focus shift but
// guarantees the window stays visible and the job actually progresses.

const GEMINI_URL = 'https://gemini.google.com/app';

// Sized so the Gemini conversation pane fits comfortably while still being
// unobtrusive when it pops up over the dashboard.
const WINDOW_WIDTH = 720;
const WINDOW_HEIGHT = 900;

export interface GeminiWindowHandle {
  windowId: number | null;
  tabId: number | null;
}

export async function openGeminiWindow(): Promise<GeminiWindowHandle> {
  // focused: true keeps the window foregrounded so its tab stays "visible" to
  // Chrome's visibility API and Angular keeps running at full speed. On
  // macOS specifically, focused: false reliably caused App Nap / occlusion
  // throttling (the symptom: "the window opens but Gemini does nothing
  // until I click it"). The window auto-closes once the job completes, so
  // the focus interruption is brief.
  const win = await chrome.windows.create({
    url: GEMINI_URL,
    focused: true,
    type: 'normal',
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
  });
  return {
    windowId: win.id ?? null,
    tabId: win.tabs?.[0]?.id ?? null,
  };
}

export async function closeGeminiWindow(handle: GeminiWindowHandle | null): Promise<void> {
  if (!handle) return;
  if (handle.windowId != null) {
    try {
      await chrome.windows.remove(handle.windowId);
      return;
    } catch {
      /* fall through to tab removal if the window is already gone */
    }
  }
  if (handle.tabId != null) {
    try {
      await chrome.tabs.remove(handle.tabId);
    } catch {
      /* tab already closed */
    }
  }
}

// Verify the user hasn't closed the window/tab between assist runs. Used to
// decide whether to reuse the existing Gemini conversation for a follow-up
// or open a fresh window. Returns true when the tab still exists and is
// pointed at gemini.google.com.
export async function isGeminiWindowAlive(handle: GeminiWindowHandle | null): Promise<boolean> {
  if (!handle || handle.tabId == null) return false;
  try {
    const tab = await chrome.tabs.get(handle.tabId);
    return Boolean(tab.url && tab.url.startsWith('https://gemini.google.com/'));
  } catch {
    return false;
  }
}
