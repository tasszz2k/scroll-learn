import { useState } from 'react';
import type { Deck, Settings as SettingsType, Response } from '../../common/types';

interface SettingsProps {
  decks: Deck[];
  settings: SettingsType;
  onSave: (settings: Partial<SettingsType>) => Promise<Response<SettingsType>>;
}

export default function Settings({ decks, settings, onSave }: SettingsProps) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    
    try {
      await onSave(localSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function updateSetting<K extends keyof SettingsType>(key: K, value: SettingsType[K]) {
    setLocalSettings({ ...localSettings, [key]: value });
  }

  function updateDomainSetting(domain: string, enabled: boolean) {
    setLocalSettings({
      ...localSettings,
      domainSettings: {
        ...localSettings.domainSettings,
        [domain]: { ...localSettings.domainSettings[domain], enabled },
      },
    });
  }

  function updateFuzzyThreshold(key: keyof SettingsType['fuzzyThresholds'], value: number) {
    setLocalSettings({
      ...localSettings,
      fuzzyThresholds: { ...localSettings.fuzzyThresholds, [key]: value },
    });
  }

  const supportedDomains = ['facebook.com', 'youtube.com', 'instagram.com'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-50">Settings</h2>
          <p className="text-surface-500 mt-1">Configure how ScrollLearn works</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {/* Quiz Behavior */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-6">Quiz Behavior</h3>
        
        <div className="space-y-8">
          {/* Show After N Posts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                Show quiz after scrolling past
              </label>
              <span className="text-sm font-semibold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-3 py-1 rounded-full">
                {localSettings.showAfterNPosts} {localSettings.showAfterNPosts === 1 ? 'post' : 'posts'}
              </span>
            </div>
            <div className="relative">
              <input
                type="range"
                min="1"
                max="20"
                value={localSettings.showAfterNPosts}
                onChange={e => updateSetting('showAfterNPosts', parseInt(e.target.value))}
                className="w-full h-2 bg-gradient-to-r from-primary-200 to-primary-100 dark:from-primary-800 dark:to-primary-900 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-600 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
              />
            </div>
            <div className="flex justify-between text-xs text-surface-400 mt-2">
              <span>1 post</span>
              <span>10 posts</span>
              <span>20 posts</span>
            </div>
          </div>

          {/* Pause After Quiz */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-surface-700 dark:text-surface-300">
                Pause after completing quiz
              </label>
              <span className={`text-sm font-semibold px-3 py-1 rounded-full ${
                localSettings.pauseMinutesAfterQuiz === 0
                  ? 'text-surface-500 bg-surface-100 dark:bg-surface-800'
                  : 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30'
              }`}>
                {localSettings.pauseMinutesAfterQuiz === 0 
                  ? 'No pause' 
                  : `${localSettings.pauseMinutesAfterQuiz} minutes`}
              </span>
            </div>
            <div className="relative">
              <input
                type="range"
                min="0"
                max="60"
                step="5"
                value={localSettings.pauseMinutesAfterQuiz}
                onChange={e => updateSetting('pauseMinutesAfterQuiz', parseInt(e.target.value))}
                className="w-full h-2 bg-gradient-to-r from-surface-200 to-surface-100 dark:from-surface-700 dark:to-surface-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary-600 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
              />
            </div>
            <div className="flex justify-between text-xs text-surface-400 mt-2">
              <span>No pause</span>
              <span>30 min</span>
              <span>60 min</span>
            </div>
          </div>

          {/* Active Deck */}
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
              Active card deck
            </label>
            <select
              value={localSettings.activeDeckId || ''}
              onChange={e => updateSetting('activeDeckId', e.target.value || null)}
              className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100"
              disabled={decks.length === 0}
            >
              <option value="">Auto-select first due deck</option>
              {decks.map(deck => (
                <option key={deck.id} value={deck.id}>
                  {deck.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-surface-500 mt-2">
              Quizzes stay on this deck until it has no due cards, then switch to the next due deck.
            </p>
          </div>
        </div>
      </div>

      {/* Domain Settings */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Enabled Sites</h3>
        <p className="text-sm text-surface-500 mb-4">
          Choose which sites should display quiz cards
        </p>
        
        <div className="space-y-3">
          {supportedDomains.map(domain => {
            const domainSettings = localSettings.domainSettings[domain] || { enabled: true };
            const isEnabled = domainSettings.enabled;
            
            return (
              <div 
                key={domain}
                className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                  isEnabled 
                    ? 'border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-surface-200 dark:border-surface-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    domain.includes('facebook') 
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : domain.includes('instagram')
                        ? 'bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 text-pink-600 dark:text-pink-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                  }`}>
                    {domain.includes('facebook') ? (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    ) : domain.includes('instagram') ? (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-surface-900 dark:text-surface-50">
                      {domain.charAt(0).toUpperCase() + domain.slice(1)}
                    </div>
                    <div className="text-sm text-surface-500">
                      {isEnabled ? 'Quizzes enabled' : 'Quizzes disabled'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => updateDomainSetting(domain, !isEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isEnabled ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Answer Matching */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Answer Matching</h3>
        
        <div className="space-y-6">
          {/* Eliminate Characters */}
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Characters to ignore when matching</label>
            <input
              type="text"
              className="w-full rounded-lg border border-surface-300 bg-white px-4 py-2 text-sm placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 font-mono"
              value={localSettings.eliminateChars}
              onChange={e => updateSetting('eliminateChars', e.target.value)}
              placeholder={'.,!?()\'"'}
            />
            <p className="text-xs text-surface-500 mt-1">
              These characters will be removed before comparing answers
            </p>
          </div>

          {/* Lowercase */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-surface-900 dark:text-surface-50">Ignore case</div>
              <p className="text-sm text-surface-500">Treat uppercase and lowercase as equal</p>
            </div>
            <button
              onClick={() => updateSetting('lowercaseNormalization', !localSettings.lowercaseNormalization)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                localSettings.lowercaseNormalization ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  localSettings.lowercaseNormalization ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Fuzzy Thresholds */}
          <div>
            <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Fuzzy matching thresholds</label>
            <p className="text-sm text-surface-500 mb-3">
              How closely must answers match for each grade level
            </p>
            
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-surface-600 dark:text-surface-400">Perfect (Grade 3)</span>
                  <span className="text-sm font-medium">{Math.round(localSettings.fuzzyThresholds.high * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.8"
                  max="1"
                  step="0.01"
                  value={localSettings.fuzzyThresholds.high}
                  onChange={e => updateFuzzyThreshold('high', parseFloat(e.target.value))}
                  className="w-full h-2 bg-green-200 dark:bg-green-900 rounded-lg appearance-none cursor-pointer accent-green-600"
                />
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-surface-600 dark:text-surface-400">Good (Grade 2)</span>
                  <span className="text-sm font-medium">{Math.round(localSettings.fuzzyThresholds.medium * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="0.95"
                  step="0.01"
                  value={localSettings.fuzzyThresholds.medium}
                  onChange={e => updateFuzzyThreshold('medium', parseFloat(e.target.value))}
                  className="w-full h-2 bg-yellow-200 dark:bg-yellow-900 rounded-lg appearance-none cursor-pointer accent-yellow-600"
                />
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-surface-600 dark:text-surface-400">Partial (Grade 1)</span>
                  <span className="text-sm font-medium">{Math.round(localSettings.fuzzyThresholds.low * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.4"
                  max="0.85"
                  step="0.01"
                  value={localSettings.fuzzyThresholds.low}
                  onChange={e => updateFuzzyThreshold('low', parseFloat(e.target.value))}
                  className="w-full h-2 bg-orange-200 dark:bg-orange-900 rounded-lg appearance-none cursor-pointer accent-orange-600"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard & Accessibility */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Keyboard & Accessibility</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-surface-900 dark:text-surface-50">Keyboard shortcuts</div>
              <p className="text-sm text-surface-500">Use number keys (1-4) to select options, Enter to submit</p>
            </div>
            <button
              onClick={() => updateSetting('enableKeyboardShortcuts', !localSettings.enableKeyboardShortcuts)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                localSettings.enableKeyboardShortcuts ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  localSettings.enableKeyboardShortcuts ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-surface-900 dark:text-surface-50">Show keyboard hints</div>
              <p className="text-sm text-surface-500">Display keyboard shortcut hints in quiz cards</p>
            </div>
            <button
              onClick={() => updateSetting('showKeyboardHints', !localSettings.showKeyboardHints)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                localSettings.showKeyboardHints ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  localSettings.showKeyboardHints ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="rounded-xl border border-surface-200 bg-white p-6 shadow-sm dark:border-surface-800 dark:bg-surface-900 border-red-200 dark:border-red-800">
        <h3 className="font-semibold text-surface-900 dark:text-surface-50 mb-4">Data Management</h3>
        
        <div className="space-y-4">
          <button
            onClick={async () => {
              const response = await chrome.runtime.sendMessage({ type: 'get_cards' });
              if (response.ok) {
                const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'scrolllearn-export.json';
                a.click();
                URL.revokeObjectURL(url);
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-surface-200 text-surface-900 hover:bg-surface-300 focus:ring-surface-400 dark:bg-surface-700 dark:text-surface-100 dark:hover:bg-surface-600 w-full sm:w-auto"
          >
            Export All Data
          </button>
          
          <button
            onClick={() => {
              if (confirm('Are you sure you want to delete ALL data? This cannot be undone.')) {
                chrome.storage.local.clear();
                window.location.reload();
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 w-full sm:w-auto"
          >
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
}
