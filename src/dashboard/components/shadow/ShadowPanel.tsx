import { useCallback, useEffect, useState } from 'react';
import type { Note, ShadowScript } from '../../../common/types';
import { STORAGE_KEYS } from '../../../common/types';
import { clearCache, listCached } from '../../../common/tts/audioCache';
import IpaDrill from './ipa/IpaDrill';
import IpaExplorer from './ipa/IpaExplorer';
import IpaProgressHeader from './ipa/IpaProgressHeader';
import { useIpaProgress } from './ipa/useIpaProgress';
import ShadowComposer from './ShadowComposer';
import ShadowGuide from './ShadowGuide';
import ShadowPlayer from './ShadowPlayer';
import ShadowPracticePlanSection from './ShadowPracticePlanSection';
import ShadowScriptList from './ShadowScriptList';
import { useConfirm } from '../../hooks/useConfirm';

interface CacheStats {
  entries: number;
  bytes: number;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface ShadowPanelProps {
  notes: Note[];
}

type Section = 'foundation' | 'practice' | 'plan';

const SECTION_HASHES: Record<Section, string> = {
  foundation: '#shadow:foundation',
  practice: '#shadow:practice',
  plan: '#shadow:plan',
};

function readSectionFromHash(): Section | null {
  const h = window.location.hash;
  if (h === SECTION_HASHES.foundation) return 'foundation';
  if (h === SECTION_HASHES.practice) return 'practice';
  if (h === SECTION_HASHES.plan) return 'plan';
  if (h === '#shadow') return null;            // Defer: caller will pick
  return null;
}

function setSectionInHash(section: Section): void {
  if (window.location.hash !== SECTION_HASHES[section]) {
    window.location.hash = SECTION_HASHES[section];
  }
}

export default function ShadowPanel({ notes }: ShadowPanelProps) {
  const confirm = useConfirm();
  const [scripts, setScripts] = useState<ShadowScript[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Initial section: derive from the URL hash if present; otherwise default
  // to 'foundation'. The visit-based switch to 'practice' (after enough drill
  // answers + at least one script) happens in a deferred effect once data
  // loads, but only if the hash hasn't already pinned the user's choice.
  const [section, setSection] = useState<Section>(() => readSectionFromHash() ?? 'foundation');
  const [focusPhoneme, setFocusPhoneme] = useState<string | null>(null);
  const [autoSwitched, setAutoSwitched] = useState(false);
  // useIpaProgress is consumed mostly for its persisted total to drive the
  // first-time-visitor heuristic; we don't need to render off it here.
  const { totalAnswers } = useIpaProgress();
  // TTS audio cache stats for the practice-section footer. Refreshed when
  // the player generates new audio (signal arrives via the shared
  // chrome.storage `tts_cache_stats_dirty` flag) or on a periodic 5s tick
  // while the practice section is mounted.
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  // Shared cacheBump signal lifted from ShadowPlayer so the saved-scripts
  // table can re-scan its readiness column whenever the player generates a
  // new line. The player calls onCacheBump() in its onEnd handler; both the
  // player's own readiness scan and the list read this counter as a dep.
  const [cacheBump, setCacheBump] = useState(0);
  const bumpCache = useCallback(() => setCacheBump(c => c + 1), []);

  const refreshCacheStats = useCallback(async () => {
    const entries = await listCached();
    const bytes = entries.reduce((sum, e) => sum + (e.byteLength || 0), 0);
    setCacheStats({ entries: entries.length, bytes });
  }, []);

  // Listen for in-app hash changes (deep-links from Guide, sub-route nav).
  useEffect(() => {
    function onHash() {
      const next = readSectionFromHash();
      if (next) setSection(next);
    }
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadScripts = useCallback(async (): Promise<ShadowScript[]> => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'get_shadow_scripts' });
      const list: ShadowScript[] = res?.ok ? (res.data ?? []) : [];
      list.sort((a, b) => b.createdAt - a.createdAt);
      return list;
    } catch {
      return [];
    }
  }, []);

  // Initial fetch + live-sync on chrome.storage changes (mirrors App.tsx).
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const list = await loadScripts();
      if (cancelled) return;
      setScripts(list);
      setSelectedId(prev => prev ?? (list[0]?.id ?? null));
    }
    void refresh();
    function onChanged(
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) {
      if (area !== 'local') return;
      if (!(STORAGE_KEYS.SHADOW_SCRIPTS in changes)) return;
      void refresh();
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [loadScripts]);

  // First-time-visitor heuristic: once the learner has practiced enough AND
  // produced at least one script, default to Practice. We only run this once
  // per mount, and only if the hash hasn't already pinned the section.
  useEffect(() => {
    if (autoSwitched) return;
    if (readSectionFromHash()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mark so the heuristic stops re-running once the user has a hash
      setAutoSwitched(true);
      return;
    }
    if (totalAnswers > 30 && scripts.length > 0) {
      setSection('practice');
      setAutoSwitched(true);
    }
  }, [autoSwitched, scripts.length, totalAnswers]);

  function switchSection(next: Section) {
    setSection(next);
    setSectionInHash(next);
    if (next === 'practice') setFocusPhoneme(null);
  }

  async function handleDelete(id: string) {
    const res = await chrome.runtime.sendMessage({ type: 'delete_shadow_script', scriptId: id });
    if (res?.ok) {
      // Local optimistic update; storage.onChanged will reconcile.
      setScripts(prev => prev.filter(s => s.id !== id));
      setSelectedId(prev => (prev === id ? null : prev));
    }
  }

  async function handleRename(id: string, title: string) {
    const target = scripts.find(s => s.id === id);
    if (!target) return;
    const updated: ShadowScript = { ...target, title };
    const res = await chrome.runtime.sendMessage({ type: 'save_shadow_script', script: updated });
    if (res?.ok) {
      setScripts(prev => prev.map(s => (s.id === id ? updated : s)));
    }
  }

  async function handleUpdate(next: ShadowScript) {
    const res = await chrome.runtime.sendMessage({ type: 'save_shadow_script', script: next });
    if (!res?.ok) {
      throw new Error(res?.error ?? 'Save failed.');
    }
    setScripts(prev => prev.map(s => (s.id === next.id ? next : s)));
  }

  function handleScriptCreated(scriptId: string) {
    setSelectedId(scriptId);
  }

  function handleDrillPhoneme(symbol: string) {
    setFocusPhoneme(symbol);
    switchSection('foundation');
  }

  // Refresh the cache stats footer whenever the practice section is visible
  // (cheap call -- listCached just opens an IDB readonly cursor) and on a 5s
  // interval so newly-generated lines show up without a manual refresh.
  useEffect(() => {
    if (section !== 'practice') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot async fetch on section enter; setState only fires after the await resolves
    void refreshCacheStats();
    const id = window.setInterval(() => { void refreshCacheStats(); }, 5000);
    return () => window.clearInterval(id);
  }, [section, refreshCacheStats]);

  async function handleClearCache() {
    const ok = await confirm({
      title: 'Clear cached audio',
      message: 'Clear all cached TTS audio? Replays will need to re-generate, which costs free credits on ElevenLabs.',
      confirmLabel: 'Clear cache',
      variant: 'danger',
    });
    if (!ok) return;
    await clearCache();
    await refreshCacheStats();
  }

  const selected = scripts.find(s => s.id === selectedId) ?? null;

  return (
    <div>
      {/* Section switcher */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {(['foundation', 'practice', 'plan'] as Section[]).map(id => {
          const active = section === id;
          const label = id === 'foundation'
            ? 'Foundation · IPA'
            : id === 'practice'
              ? 'Practice · Shadow'
              : 'Practice plan';
          return (
            <button
              key={id}
              type="button"
              onClick={() => switchSection(id)}
              className={active ? 'btn btn-clay' : 'btn btn-ghost'}
              style={{ padding: '6px 14px', fontSize: 13 }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {section === 'foundation' && (
        <div>
          <ShadowGuide onGoToFoundation={undefined} />

          <div style={{ marginBottom: 18 }}>
            <h3 className="serif" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 6px' }}>
              Train your ear, then your mouth.
            </h3>
            <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.6, maxWidth: 720, margin: 0 }}>
              Click any phoneme to open the lab: watch the mouth shape, drill the minimal pairs, then
              record yourself and get checked. Mastery flips green after 10+ listening reps at 80% accuracy
              (and, if you've practiced production, 5+ speaking reps at 60%). The script generator weaves
              your weakest sounds into the Practice tab's shadowing scripts.
            </p>
          </div>

          <IpaProgressHeader />

          <div style={{ marginBottom: 28 }}>
            <IpaExplorer />
          </div>
          <IpaDrill
            focusPhoneme={focusPhoneme}
            onClearFocus={() => setFocusPhoneme(null)}
          />
        </div>
      )}

      {section === 'practice' && (
        <div>
          <ShadowGuide onGoToFoundation={() => switchSection('foundation')} />

          <ShadowComposer notes={notes} onScriptCreated={handleScriptCreated} />

          <div style={{ marginBottom: 24 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Saved scripts</div>
            <ShadowScriptList
              scripts={scripts}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRename={handleRename}
              onDelete={handleDelete}
              onUpdate={handleUpdate}
              cacheBump={cacheBump}
            />
          </div>

          {selected ? (
            <ShadowPlayer
              script={selected}
              onDrillPhoneme={handleDrillPhoneme}
              cacheBump={cacheBump}
              onCacheBump={bumpCache}
            />
          ) : (
            <div
              className="card-flat"
              style={{
                padding: 32,
                textAlign: 'center',
                color: 'var(--ink-3)',
                fontSize: 14,
                background: 'var(--card)',
              }}
            >
              Generate or pick a script above and the player will appear here.
            </div>
          )}

          {/* TTS audio cache footer. Hidden when the cache is empty so
              brand-new users don't see a "0 entries · 0 B" line. */}
          {cacheStats && cacheStats.entries > 0 && (
            <div
              style={{
                marginTop: 18,
                padding: '8px 12px',
                fontSize: 11,
                color: 'var(--ink-4)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderTop: '1px solid var(--rule)',
              }}
              className="mono"
            >
              <span>
                AUDIO CACHE: {cacheStats.entries} {cacheStats.entries === 1 ? 'ENTRY' : 'ENTRIES'} · {formatBytes(cacheStats.bytes).toUpperCase()}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={handleClearCache}
                className="btn btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11 }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {section === 'plan' && (
        <ShadowPracticePlanSection onDrillPhoneme={handleDrillPhoneme} />
      )}
    </div>
  );
}
