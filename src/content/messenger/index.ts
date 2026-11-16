// Messenger focus mode and themes for facebook.com/messages.
//
// Runs independently of the content blocker: the blocker is ignored on
// Messenger by default (blockerIgnoredUrls), while this module only ever runs
// there. Themes style the data-fmess-* hooks that marks.ts, rail.ts and
// avatars.ts set (Zalo is vendored verbatim from fMess), so the attribute
// names stay upstream's.

import type { MessengerThemeId, Settings } from '@/common/types';
import { isMessengerMediaRoute, isMessengerRoute } from '@/common/messengerRoute';
import focusCss from './focus.css?inline';
import fmessBaseCss from './themes/fmessBase.css?inline';
import { startMarks, stopMarks } from './marks';
import { startRail, stopRail } from './rail';
import { buildPaletteCss, type PaletteMode } from './palette';
import { removeBackLink, syncBackLink } from './backLink';
import chatListCss from './chatList.css?inline';
import { removeChatList, syncChatList } from './chatList';
import { startIconAvatars, stopIconAvatars } from './avatars';
import { startKeyboard, stopKeyboard } from './keyboard';

const CHATS = 'data-fmess-chats';
const MEDIA = 'data-fmess-media';
const THEME_ATTR = 'data-sl-msgr-theme';
const FOCUS_STYLE_ID = 'sl-msgr-focus';
const THEME_STYLE_ID = 'sl-msgr-theme';
const LIST_STYLE_ID = 'sl-msgr-list';

type ThemeId = Exclude<MessengerThemeId, 'default'>;

interface ThemeDef {
  // Loaded on demand so theme CSS (Zalo is ~215 KB) stays out of the content
  // bundle that every Facebook, YouTube and Instagram page loads.
  load: () => Promise<{ default: string }>;
  palette: PaletteMode; // Facebook's own colours are pinned to this mode
  rail: boolean; // draws clickable buttons via --fmess-buttons
  // People's pictures are tagged (data-fmess-avatar) and swapped for an
  // icon; a theme may then hide them altogether.
  iconAvatars: boolean;
  // Zalo folds the "Chats" header away and its rail avatar already leads
  // back to Facebook; CLI shows no Facebook branding at all.
  backLink: boolean;
  keyboard: boolean; // keyboard-only navigation (keyboard.ts)
}

const THEMES: Record<ThemeId, ThemeDef> = {
  zalo: {
    load: () => import('./themes/zalo.css?inline'),
    palette: 'light',
    rail: true,
    iconAvatars: false,
    backLink: false,
    keyboard: false,
  },
  cli: {
    load: () => import('./themes/cli.css?inline'),
    palette: 'dark',
    rail: false,
    iconAvatars: true,
    backLink: false,
    keyboard: true,
  },
};

interface MessengerConfig {
  focus: boolean;
  theme: MessengerThemeId;
  hideList: boolean;
}

let config: MessengerConfig | null = null;
let tickTimer: number | null = null;
const themeCss = new Map<ThemeId, string>();
const themeLoading = new Map<ThemeId, Promise<void>>();
let appliedTheme: ThemeId | null = null;
let paletteRefreshTimers: number[] = [];

function loadTheme(id: ThemeId): Promise<void> {
  let pending = themeLoading.get(id);
  if (!pending) {
    pending = THEMES[id]
      .load()
      .then(mod => {
        themeCss.set(id, mod.default);
      })
      .catch(error => {
        themeLoading.delete(id);
        console.warn(`[ScrollLearn] Could not load the ${id} Messenger theme`, error);
      });
    themeLoading.set(id, pending);
  }
  return pending;
}

// Styles go on <html>, after <head>, so they come after every stylesheet
// Facebook adds to the head later and win ties.
function setStyle(id: string, css: string | null) {
  let style = document.getElementById(id);
  if (css === null) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = id;
  }
  if (style.textContent !== css) style.textContent = css;
  if (style.parentElement !== document.documentElement) document.documentElement.append(style);
}

function onRoute(): boolean {
  return window.top === window && isMessengerRoute(location.hostname, location.pathname);
}

// Facebook does not always move to /messenger_media for the viewer: a chat's
// photos open in a layer at the same address, found by its close box (a
// dialog with the Facebook logo link) or its download link near the top.
function viewerOpen(): boolean {
  if (isMessengerMediaRoute(location.pathname)) return true;
  const closeBox = [...document.querySelectorAll('[role="dialog"] > div > a[href="/"]')]
    .map(logo => logo.parentElement)
    .find(el => el && el.getBoundingClientRect().width > 0);
  if (closeBox?.querySelector('[role="button"]')) return true;
  return [...document.querySelectorAll('a[download]')].some(a => {
    if (a.closest('[role="main"]')) return false;
    const box = a.getBoundingClientRect();
    return box.width > 0 && box.top < 120;
  });
}

function writeThemeStyle(id: ThemeId) {
  const css = themeCss.get(id);
  if (css) setStyle(THEME_STYLE_ID, buildPaletteCss(THEMES[id].palette) + fmessBaseCss + css);
}

function applyTheme(id: ThemeId) {
  if (appliedTheme === id) return;
  removeTheme();
  if (!themeCss.has(id)) return;
  appliedTheme = id;
  writeThemeStyle(id);
  startMarks();
  if (THEMES[id].rail) startRail({ toggleChatList });
  if (THEMES[id].iconAvatars) startIconAvatars();
  if (THEMES[id].keyboard) startKeyboard();
  schedulePaletteRefresh(id);
}

// Facebook's stylesheets (and so its palettes) keep arriving after the
// chats render, so the copy is rebuilt a few times after the theme starts.
function schedulePaletteRefresh(id: ThemeId) {
  clearPaletteRefresh();
  paletteRefreshTimers = [2000, 6000, 15000].map(ms =>
    window.setTimeout(() => {
      if (appliedTheme === id) writeThemeStyle(id);
    }, ms),
  );
}

function clearPaletteRefresh() {
  for (const t of paletteRefreshTimers) window.clearTimeout(t);
  paletteRefreshTimers = [];
}

function removeTheme() {
  clearPaletteRefresh();
  setStyle(THEME_STYLE_ID, null);
  if (appliedTheme === null) return;
  const def = THEMES[appliedTheme];
  appliedTheme = null;
  stopMarks();
  if (def.rail) stopRail();
  if (def.iconAvatars) stopIconAvatars();
  if (def.keyboard) stopKeyboard();
}

function sync() {
  const active = config !== null && onRoute();
  const focus = active && config!.focus;
  const theme: ThemeId | null = active && config!.theme !== 'default' ? config!.theme : null;
  const root = document.documentElement;

  root.toggleAttribute(CHATS, active);
  root.toggleAttribute(MEDIA, active && viewerOpen());
  if (theme) root.setAttribute(THEME_ATTR, theme);
  else root.removeAttribute(THEME_ATTR);

  setStyle(FOCUS_STYLE_ID, focus ? focusCss : null);
  if (focus && (!theme || THEMES[theme].backLink)) syncBackLink();
  else removeBackLink();

  if (theme) {
    if (appliedTheme !== theme) {
      if (appliedTheme) removeTheme();
      void loadTheme(theme).then(() => {
        if (config?.theme === theme && onRoute()) applyTheme(theme);
      });
    }
  } else {
    removeTheme();
  }

  // After removeTheme: stopping the marks clears the list mark this re-adds.
  setStyle(LIST_STYLE_ID, active ? chatListCss : null);
  if (active) syncChatList(config!.hideList, toggleChatList);
  else removeChatList();

  if (active) ensureTick();
}

// Applied locally first so the click feels instant; the saved setting then
// comes back through storage.onChanged and lands on the same state.
function toggleChatList() {
  if (!config) return;
  config = { ...config, hideList: !config.hideList };
  sync();
  try {
    chrome.runtime
      .sendMessage({ type: 'set_settings', settings: { messengerHideChatList: config.hideList } })
      .catch(() => {});
  } catch {
    /* extension context invalidated */
  }
}

// One cheap tick does route polling, viewer detection and back-link
// re-attachment. Facebook navigates with pushState in the page world, which
// the isolated content-script world cannot patch, so the route is polled; the
// Navigation API event makes the common case instant.
function ensureTick() {
  if (tickTimer === null) tickTimer = window.setInterval(sync, 1000);
}

let navListenerInstalled = false;

function installNavListener() {
  if (navListenerInstalled) return;
  navListenerInstalled = true;
  const nav = (window as Window & { navigation?: EventTarget }).navigation;
  nav?.addEventListener('currententrychange', () => {
    if (config) sync();
  });
  window.addEventListener('popstate', () => {
    if (config) sync();
  });
}

function configFrom(settings: Settings): MessengerConfig | null {
  const focus = Boolean(settings.messengerFocusMode);
  const saved = settings.messengerTheme;
  const theme: MessengerThemeId = saved && saved !== 'default' && saved in THEMES ? saved : 'default';
  const hideList = Boolean(settings.messengerHideChatList);
  return focus || hideList || theme !== 'default' ? { focus, theme, hideList } : null;
}

export function startMessengerTheme(settings: Settings) {
  updateMessengerTheme(settings);
}

export function updateMessengerTheme(settings: Settings) {
  config = configFrom(settings);
  if (!config) {
    stopMessengerTheme();
    return;
  }
  installNavListener();
  ensureTick();
  sync();
}

export function stopMessengerTheme() {
  config = null;
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
  sync();
}
