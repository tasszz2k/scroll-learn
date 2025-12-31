import { createRoot } from 'react-dom/client';
import { useState, useEffect } from 'react';
import type { Stats, Settings } from '../common/types';
import './popup.css';

interface PopupState {
  stats: Stats | null;
  settings: Settings | null;
  currentSite: string;
  loading: boolean;
}

function Popup() {
  const [state, setState] = useState<PopupState>({
    stats: null,
    settings: null,
    currentSite: '',
    loading: true,
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      // Get current tab info
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ? new URL(tab.url) : null;
      const currentSite = url?.hostname?.replace(/^(www\.|m\.)/, '') || '';

      // Get stats and settings from background
      const [statsResponse, settingsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'get_stats' }),
        chrome.runtime.sendMessage({ type: 'get_settings' }),
      ]);

      setState({
        stats: statsResponse.ok ? statsResponse.data : null,
        settings: settingsResponse.ok ? settingsResponse.data : null,
        currentSite,
        loading: false,
      });
    } catch (error) {
      console.error('Failed to load popup data:', error);
      setState(prev => ({ ...prev, loading: false }));
    }
  }

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

    await chrome.runtime.sendMessage({
      type: 'set_settings',
      settings: newSettings,
    });

    setState(prev => ({ ...prev, settings: newSettings }));
  }

  function isSiteEnabled(): boolean {
    if (!state.settings || !state.currentSite) return true;
    const domainSettings = state.settings.domainSettings[state.currentSite];
    return domainSettings?.enabled !== false;
  }

  function openDashboard() {
    chrome.runtime.openOptionsPage();
  }

  function openImport() {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html#import') });
  }

  function openSettings() {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html#settings') });
  }

  if (state.loading) {
    return (
      <div className="popup-container">
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  const { stats, currentSite } = state;
  const siteEnabled = isSiteEnabled();
  const isSocialSite = currentSite.includes('facebook') || currentSite.includes('youtube');

  return (
    <div className="popup-container">
      {/* Header */}
      <div className="popup-header">
        <img src="/icons/icon48.png" alt="ScrollLearn" className="popup-logo-img" />
        <div className="popup-title">
          <h1>ScrollLearn</h1>
          <p>Learn while you scroll</p>
        </div>
        <div className={`status-dot ${!siteEnabled ? 'disabled' : ''}`}></div>
      </div>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats?.totalCards || 0}</div>
          <div className="stat-label">Total Cards</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats?.totalReviews || 0}</div>
          <div className="stat-label">Reviews</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats?.currentStreak || 0}</div>
          <div className="stat-label">Day Streak</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {stats?.averageAccuracy ? Math.round(stats.averageAccuracy * 100) : 0}%
          </div>
          <div className="stat-label">Accuracy</div>
        </div>
      </div>

      {/* Site Toggle */}
      {isSocialSite && (
        <div className="site-toggle">
          <div className="toggle-row">
            <div className="toggle-label">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
              </svg>
              <div>
                <div className="toggle-text">Enable on this site</div>
                <div className="toggle-site">{currentSite}</div>
              </div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={siteEnabled}
                onChange={toggleSite}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="section-title">Quick Actions</div>
      <div className="quick-actions">
        <button className="action-btn" onClick={openDashboard}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
          </svg>
          <span>Manage Decks</span>
          <svg className="arrow" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
          </svg>
        </button>

        <button className="action-btn" onClick={openImport}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
          </svg>
          <span>Import Cards</span>
          <svg className="arrow" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
          </svg>
        </button>

        <button className="action-btn" onClick={openSettings}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          <span>Settings</span>
          <svg className="arrow" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
          </svg>
        </button>
      </div>

      {/* Footer */}
      <div className="popup-footer">
        <a className="footer-link" onClick={openDashboard}>
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>
          </svg>
          Dashboard
        </a>
        <a className="footer-link" href="https://github.com/your-repo/scroll-learn" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          Help
        </a>
      </div>
    </div>
  );
}

// Mount the popup
const container = document.getElementById('popup-root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}

