/* eslint-disable react-refresh/only-export-components -- popup.tsx is the entry point, not a Vite-HMR module */
import { createRoot } from 'react-dom/client';
import { useState, useEffect, useCallback } from 'react';
import type { Card, Deck, Stats, Settings } from '../common/types';
import type { BlockedCounts } from '../content/blocker';
import { isHostAllowed, parseRegexEntry } from '../common/allowlist';
import './popup.css';

interface PopupState {
  stats: Stats | null;
  settings: Settings | null;
  decks: Deck[];
  cardCounts: Record<string, number>;
  dueCounts: Record<string, number>;
  totalDue: number;
  currentSite: string;
  loading: boolean;
  blockedCount: number;
  blockedCounts: BlockedCounts | null;
}

function ArrowRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 9h12M10 4l5 5-5 5" />
    </svg>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="toggle-row">
      <span className="label-text">{label}</span>
      <button
        type="button"
        className={'switch' + (checked ? ' on' : '')}
        aria-pressed={checked}
        onClick={onChange}
      />
    </div>
  );
}

function Popup() {
  const [state, setState] = useState<PopupState>({
    stats: null,
    settings: null,
    decks: [],
    cardCounts: {},
    dueCounts: {},
    totalDue: 0,
    currentSite: '',
    loading: true,
    blockedCount: 0,
    blockedCounts: null,
  });

  const loadData = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ? new URL(tab.url) : null;
      const currentSite = url?.hostname?.replace(/^(www\.|m\.)/, '') || '';

      const [statsResponse, settingsResponse, decksResponse, cardsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'get_stats' }),
        chrome.runtime.sendMessage({ type: 'get_settings' }),
        chrome.runtime.sendMessage({ type: 'get_decks' }),
        chrome.runtime.sendMessage({ type: 'get_cards' }),
      ]);

      const cardCounts: Record<string, number> = {};
      const dueCounts: Record<string, number> = {};
      let totalDue = 0;
      const now = Date.now();
      if (cardsResponse?.ok && Array.isArray(cardsResponse.data)) {
        for (const card of cardsResponse.data as Card[]) {
          cardCounts[card.deckId] = (cardCounts[card.deckId] ?? 0) + 1;
          if (card.due <= now) {
            dueCounts[card.deckId] = (dueCounts[card.deckId] ?? 0) + 1;
            totalDue += 1;
          }
        }
      }

      let blockedCount = 0;
      let blockedCounts: BlockedCounts | null = null;
      if (tab?.id) {
        try {
          const countResponse = await chrome.tabs.sendMessage(tab.id, { type: 'get_blocked_count' });
          blockedCount = countResponse?.count || 0;
          blockedCounts = countResponse?.counts || null;
        } catch {
          // Content script may not be running on this tab
        }
      }

      setState({
        stats: statsResponse.ok ? statsResponse.data : null,
        settings: settingsResponse.ok ? settingsResponse.data : null,
        decks: decksResponse.ok ? decksResponse.data : [],
        cardCounts,
        dueCounts,
        totalDue,
        currentSite,
        loading: false,
        blockedCount,
        blockedCounts,
      });
    } catch (error) {
      console.error('Failed to load popup data:', error);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot async load via chrome.runtime; no Suspense bridge available
    void loadData();
  }, [loadData]);

  async function toggleSite() {
    if (!state.settings || !state.currentSite) return;
    const isEnabled = isSiteEnabled();
    const newSettings = {
      ...state.settings,
      domainSettings: {
        ...state.settings.domainSettings,
        [state.currentSite]: {
          ...state.settings.domainSettings[state.currentSite],
          enabled: !isEnabled,
        },
      },
    };
    await chrome.runtime.sendMessage({ type: 'set_settings', settings: newSettings });
    setState(prev => ({ ...prev, settings: newSettings }));
  }

  function isSiteEnabled(): boolean {
    if (!state.settings || !state.currentSite) return true;
    const domainSettings = state.settings.domainSettings[state.currentSite];
    return domainSettings?.enabled !== false;
  }

  function isNoteCaptureEnabled(): boolean {
    if (!state.settings || !state.currentSite) return false;
    return isHostAllowed(state.settings.noteCaptureAllowlist, state.currentSite);
  }

  // Whether the current site is allowlisted via a regex entry rather than a
  // plain hostname. The popup toggle only flips plain entries — toggling off a
  // regex match would silently remove a user's pattern, so we surface a hint
  // and disable the toggle in that case.
  function isAllowlistedByRegex(): boolean {
    if (!state.settings || !state.currentSite) return false;
    for (const entry of state.settings.noteCaptureAllowlist) {
      const re = parseRegexEntry(entry.trim());
      if (!re) continue;
      try {
        if (new RegExp(re.source, re.flags).test(state.currentSite)) return true;
      } catch {
        // ignore bad regex
      }
    }
    return false;
  }

  async function toggleNoteCapture() {
    if (!state.settings || !state.currentSite) return;
    if (isAllowlistedByRegex()) return;

    const host = state.currentSite;
    const current = state.settings.noteCaptureAllowlist;
    const enabled = current.some(e => e.trim().toLowerCase() === host);
    const next = enabled
      ? current.filter(e => e.trim().toLowerCase() !== host)
      : [...current, host];

    const response = await chrome.runtime.sendMessage({
      type: 'set_settings',
      settings: { noteCaptureAllowlist: next },
    });
    if (response?.ok) setState(prev => ({ ...prev, settings: response.data }));
  }

  function openDashboard() { chrome.runtime.openOptionsPage(); }
  function openStudy()     { chrome.tabs.create({ url: chrome.runtime.getURL('index.html#study') }); }

  async function toggleBlockingSetting(key: keyof Settings) {
    if (!state.settings) return;
    const newSettings = { ...state.settings, [key]: !state.settings[key] };
    const response = await chrome.runtime.sendMessage({
      type: 'set_settings',
      settings: { [key]: newSettings[key] },
    });
    if (response.ok) setState(prev => ({ ...prev, settings: response.data }));
  }

  async function setActiveDeck(deckId: string | null) {
    const response = await chrome.runtime.sendMessage({
      type: 'set_settings',
      settings: { activeDeckId: deckId },
    });
    if (response.ok) setState(prev => ({ ...prev, settings: response.data }));
  }

  if (state.loading) {
    return (
      <div className="popup-container">
        <div className="loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  const { stats, settings, currentSite, decks, cardCounts, dueCounts, totalDue, blockedCount, blockedCounts } = state;
  const siteEnabled = isSiteEnabled();
  const noteCaptureOn = isNoteCaptureEnabled();
  const noteCaptureLockedByRegex = isAllowlistedByRegex();
  const isFacebook = currentSite.includes('facebook');
  const isYouTube = currentSite.includes('youtube');
  const isInstagram = currentSite.includes('instagram');
  const isSocialSite = isFacebook || isYouTube || isInstagram;

  // Active deck lookup
  const activeDeck = decks.find(d => d.id === settings?.activeDeckId) || null;
  const activeDeckCount = activeDeck ? (cardCounts[activeDeck.id] ?? 0) : 0;
  const activeDeckDue = activeDeck ? (dueCounts[activeDeck.id] ?? 0) : 0;

  // Blocked breakdown ordered for grid (Reels, Shorts, Sponsored, Suggested, Strangers)
  const blockKeys: Array<{ key: keyof BlockedCounts; label: string }> = [
    { key: 'reels', label: 'Reels' },
    { key: 'shorts', label: 'Shorts' },
    { key: 'sponsored', label: 'Sponsored' },
    { key: 'suggested', label: 'Suggested' },
    { key: 'strangers', label: 'Strangers' },
  ];

  return (
    <div className="popup-container">
      {/* Header — block-S monogram + serif title + status dot */}
      <header className="popup-header">
        <div className="popup-mark" aria-label="Scroll Learn">
          <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
            <rect x="14" y="16" width="36" height="3" fill="#FBF8F2" />
            <rect x="14" y="26" width="28" height="3" fill="#FBF8F2" />
            <rect x="14" y="36" width="32" height="3" fill="#FBF8F2" />
            <path d="M 50 12 Q 60 32 50 52" fill="none" stroke="#C96442" strokeWidth="3" strokeLinecap="round" />
            <circle cx="50" cy="46" r="3" fill="#C96442" />
          </svg>
        </div>
        <div className="popup-title">
          <h1>Scroll Learn</h1>
          <p>Learn while you scroll</p>
        </div>
        <div className={'status-dot' + (!siteEnabled ? ' disabled' : '')} title={siteEnabled ? 'Active' : 'Paused on this site'} />
      </header>

      {/* Quick actions — moved to the top */}
      <div className="actions-grid actions-grid-top">
        <button className="btn btn-clay" type="button" onClick={openStudy}>Study now</button>
        <button className="btn btn-ghost" type="button" onClick={openDashboard}>
          Dashboard <ArrowRight />
        </button>
      </div>

      {/* Headline numbers — cards due / day streak */}
      <div className="numbers-row">
        <div className="number-cell">
          <div className={'num' + (totalDue === 0 ? ' muted' : '')}>{totalDue}</div>
          <div className="eyebrow label">Cards due</div>
        </div>
        <div className="number-cell">
          <div className={'num' + ((stats?.currentStreak ?? 0) === 0 ? ' muted' : '')}>{stats?.currentStreak ?? 0}</div>
          <div className="eyebrow label">Day streak</div>
        </div>
      </div>

      {/* Sub stats */}
      <div className="sub-stats">
        <div>
          <div className="eyebrow label">Reviews</div>
          <div className="value">{stats?.totalReviews ?? 0}</div>
        </div>
        <div>
          <div className="eyebrow label">Accuracy</div>
          <div className="value">
            {stats?.averageAccuracy ? Math.round(stats.averageAccuracy * 100) : 0}
            <span className="pct">%</span>
          </div>
        </div>
      </div>

      {/* This site — always rendered to match the design */}
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">This site</span>
          <span className="url">{currentSite || '—'}</span>
        </div>
        {isSocialSite ? (
          <div className="site-row">
            <div>
              <div className="head">{siteEnabled ? 'Quizzes enabled' : 'Quizzes paused'}</div>
              <div className="sub">
                Every {settings?.showAfterNPosts ?? 5} posts
                {settings?.pauseMinutesAfterQuiz ? ` · pause ${settings.pauseMinutesAfterQuiz} m` : ''}
              </div>
            </div>
            <button
              type="button"
              className={'switch' + (siteEnabled ? ' on' : '')}
              aria-pressed={siteEnabled}
              onClick={toggleSite}
            />
          </div>
        ) : (
          <div className="site-row">
            <div>
              <div className="head" style={{ color: 'var(--ink-3)' }}>Not a feed site</div>
              <div className="sub">Quizzes inject on Facebook, YouTube, and Instagram.</div>
            </div>
            <button type="button" className="switch" aria-pressed="false" disabled />
          </div>
        )}
        <div className="site-row">
          <div>
            <div className="head">{noteCaptureOn ? 'Capturing notes' : 'Note capture off'}</div>
            <div className="sub">
              {noteCaptureLockedByRegex
                ? 'Allowlisted by a regex pattern — manage in Settings.'
                : currentSite
                  ? <>Hold <span className="mono" style={{ fontSize: 11 }}>Ctrl/Cmd</span> and hover to pluck text.</>
                  : 'Open a tab to enable.'}
            </div>
          </div>
          <button
            type="button"
            className={'switch' + (noteCaptureOn ? ' on' : '')}
            aria-pressed={noteCaptureOn}
            onClick={toggleNoteCapture}
            disabled={!currentSite || noteCaptureLockedByRegex}
            title={noteCaptureLockedByRegex
              ? 'Manage regex allowlist in the dashboard Settings'
              : noteCaptureOn
                ? `Stop capturing notes on ${currentSite}`
                : `Capture notes on ${currentSite}`}
          />
        </div>
      </section>

      {/* Active deck */}
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Active deck</span>
        </div>
        {activeDeck ? (
          <button
            type="button"
            className="deck-card deck-card-button"
            onClick={() => setActiveDeck(null)}
            title="Clear active deck"
          >
            <div>
              <div className="name">{activeDeck.name}</div>
              <div className="meta">
                {activeDeckCount} {activeDeckCount === 1 ? 'card' : 'cards'}
                {activeDeckDue > 0 && ` · ${activeDeckDue} due`}
              </div>
            </div>
            {activeDeckDue > 0
              ? <span className="pill pill-clay">{activeDeckDue}</span>
              : <span className="pill">none due</span>}
          </button>
        ) : (
          <button
            type="button"
            className="deck-card deck-card-button"
            onClick={() => decks[0] && setActiveDeck(decks[0].id)}
            title={decks.length === 0 ? 'No decks yet' : 'Pick a deck'}
            disabled={decks.length === 0}
          >
            <div>
              <div className="name" style={{ color: 'var(--ink-3)' }}>Auto-select</div>
              <div className="meta">Most overdue deck is chosen for you</div>
            </div>
            {totalDue > 0 && <span className="pill pill-clay">{totalDue}</span>}
          </button>
        )}
      </section>

      {/* Hidden today / Content blocking — always rendered */}
      {settings && (
        <section className="section">
          <div className="block-head">
            <span className="eyebrow">Hidden today</span>
            <span className="block-total">
              {blockedCount}
              <span className="unit">blocked</span>
            </span>
          </div>

          <div className="block-grid">
            {blockKeys.map(({ key, label }) => {
              const n = (blockedCounts?.[key] as number | undefined) ?? 0;
              return (
                <div key={key} className={'block-cell' + (n > 0 ? ' on' : '')}>
                  <div className="k">{label}</div>
                  <div className="n">{n}</div>
                </div>
              );
            })}
          </div>

          {isFacebook && (
            <>
              <ToggleRow label="Reels"            checked={settings.hideFacebookReels}     onChange={() => toggleBlockingSetting('hideFacebookReels')} />
              <ToggleRow label="Sponsored"        checked={settings.hideFacebookSponsored} onChange={() => toggleBlockingSetting('hideFacebookSponsored')} />
              <ToggleRow label="Suggested"        checked={settings.hideFacebookSuggested} onChange={() => toggleBlockingSetting('hideFacebookSuggested')} />
              <ToggleRow label="Strangers' posts" checked={settings.hideFacebookStrangers} onChange={() => toggleBlockingSetting('hideFacebookStrangers')} />
            </>
          )}
          {isInstagram && (
            <>
              <ToggleRow label="Reels"            checked={settings.hideInstagramReels}     onChange={() => toggleBlockingSetting('hideInstagramReels')} />
              <ToggleRow label="Sponsored"        checked={settings.hideInstagramSponsored} onChange={() => toggleBlockingSetting('hideInstagramSponsored')} />
              <ToggleRow label="Suggested"        checked={settings.hideInstagramSuggested} onChange={() => toggleBlockingSetting('hideInstagramSuggested')} />
              <ToggleRow label="Strangers' posts" checked={settings.hideInstagramStrangers} onChange={() => toggleBlockingSetting('hideInstagramStrangers')} />
            </>
          )}
          {isYouTube && (
            <ToggleRow label="Shorts" checked={settings.hideYouTubeShorts} onChange={() => toggleBlockingSetting('hideYouTubeShorts')} />
          )}
          {!isSocialSite && (
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '.06em', marginTop: 4 }}>
              Per-site toggles appear when this popup is open on a feed site.
            </div>
          )}
        </section>
      )}

      {/* Quick actions — pair (the design's only bottom action) */}
    </div>
  );
}

const container = document.getElementById('popup-root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
