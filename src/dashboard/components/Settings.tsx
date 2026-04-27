import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Settings as SettingsType, Response, TranslateDirection } from '../../common/types';
import { DEFAULT_SETTINGS } from '../../common/types';
import { parseRegexEntry, validateAllowlistEntry } from '../../common/allowlist';
import EditorialHeader from './EditorialHeader';

interface SettingsProps {
  settings: SettingsType;
  onSave: (settings: Partial<SettingsType>) => Promise<Response<SettingsType>>;
  decks: unknown;
}

function normalizeAllowlistInput(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (parseRegexEntry(value)) return value;
  let host = value.toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '');
  host = host.split('/')[0];
  host = host.replace(/^(www\.|m\.)/, '');
  return host;
}

const SUPPORTED_DOMAINS = [
  { domain: 'facebook.com',  label: 'facebook.com',  reels: 'hideFacebookReels',  sponsored: 'hideFacebookSponsored',  suggested: 'hideFacebookSuggested',  strangers: 'hideFacebookStrangers',  hides: 'Reels · Sponsored · Suggested · Strangers' },
  { domain: 'instagram.com', label: 'instagram.com', reels: 'hideInstagramReels', sponsored: 'hideInstagramSponsored', suggested: 'hideInstagramSuggested', strangers: 'hideInstagramStrangers', hides: 'Reels · Sponsored · Suggested · Strangers' },
  { domain: 'youtube.com',   label: 'youtube.com',   reels: 'hideYouTubeShorts',  sponsored: null,                     suggested: null,                     strangers: null,                     hides: 'Shorts only' },
] as const;

/* ----- Atoms ----- */

function SectionHead({ num, label, count }: { num: string; label: string; count?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{num}</span>
        <span className="eyebrow">{label}</span>
      </div>
      {count && <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>{count}</span>}
    </div>
  );
}

function Row({ label, hint, last, children }: { label: string; hint: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 280px',
        gap: 32,
        padding: '20px 0',
        borderBottom: last ? 'none' : '1px solid var(--rule)',
        alignItems: 'center',
      }}
    >
      <div>
        <div className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45 }}>{hint}</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  );
}

function Stepper({ value, unit, min, max, step = 1, onChange }: { value: number; unit?: string; min: number; max: number; step?: number; onChange: (n: number) => void }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const btn: React.CSSProperties = {
    width: 36,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: 'var(--ink-3)',
    fontSize: 16,
    padding: 0,
  };
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      <button type="button" onClick={() => onChange(clamp(value - step))} style={{ ...btn, borderRight: '1px solid var(--rule-2)' }} aria-label={`Decrease ${value}`}>−</button>
      <div style={{ minWidth: 80, padding: '8px 14px', display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
        <span className="serif" style={{ fontSize: 18, fontWeight: 600 }}>{value}</span>
        {unit && <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{unit}</span>}
      </div>
      <button type="button" onClick={() => onChange(clamp(value + step))} style={{ ...btn, borderLeft: '1px solid var(--rule-2)' }} aria-label={`Increase ${value}`}>+</button>
    </div>
  );
}

function ToggleControl({ on, onClick, label, ariaLabel }: { on: boolean; onClick: () => void; label?: { on: string; off: string }; ariaLabel?: string }) {
  const text = label ? (on ? label.on : label.off) : (on ? 'enabled' : 'disabled');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={ariaLabel}
      className="settings-toggle"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px 8px 16px',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        background: 'var(--card)',
        minWidth: 180,
        justifyContent: 'space-between',
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <span className="mono" style={{ fontSize: 11, color: on ? 'var(--clay-deep)' : 'var(--ink-3)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{text}</span>
      <span className={'switch-editorial' + (on ? ' on' : '')} aria-hidden style={{ pointerEvents: 'none' }} />
    </button>
  );
}

function FieldInput({ value, onChange, mono, placeholder }: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        background: 'var(--card)',
        minWidth: 220,
        height: 40,
        overflow: 'hidden',
      }}
    >
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? 'mono' : 'serif'}
        style={{
          width: '100%',
          textAlign: 'right',
          padding: '0 14px',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: mono ? 13 : 15,
          fontWeight: 600,
          letterSpacing: mono ? '.05em' : 'normal',
          color: 'var(--ink)',
          height: '100%',
        }}
      />
    </div>
  );
}

function Slider({ value, label, min, max, step, onChange, format }: { value: number; label: string; min: number; max: number; step: number; onChange: (n: number) => void; format?: (n: number) => string }) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 6,
        width: 240,
        padding: '8px 14px 10px',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        background: 'var(--card)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{label}</span>
        <span className="serif" style={{ fontSize: 15, fontWeight: 600 }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ accentColor: 'var(--clay)', margin: 0, width: '100%' }}
      />
    </div>
  );
}

function StyledSelect<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 14px',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        background: 'var(--card)',
        minWidth: 220,
        height: 40,
      }}
    >
      <select
        value={value}
        onChange={e => onChange(e.target.value as T)}
        className="serif"
        style={{
          flex: 1,
          border: 'none',
          background: 'transparent',
          outline: 'none',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--ink)',
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          cursor: 'pointer',
          paddingRight: 8,
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', pointerEvents: 'none' }}>▾</span>
    </div>
  );
}

function SiteToggle({ on, onClick, dim, ariaLabel }: { on: boolean; onClick: () => void; dim?: boolean; ariaLabel?: string }) {
  if (dim) {
    return <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.1em' }}>—</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={ariaLabel}
      className={'switch-editorial' + (on ? ' on' : '')}
    />
  );
}

/* ----- Settings ----- */

export default function Settings({ settings, onSave }: SettingsProps) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [allowlistInput, setAllowlistInput] = useState('');
  const [allowlistError, setAllowlistError] = useState<string | null>(null);
  const [noteAutoSaveStatus, setNoteAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const noteAutoSaveSkipFirst = useRef(true);

  // Sticky save-bar plumbing: when the editorial header's action buttons scroll
  // out of view, surface a compact bar pinned just below the dashboard nav.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [headerOffset, setHeaderOffset] = useState<number>(132);
  const [showStickyBar, setShowStickyBar] = useState(false);

  // Measure the dashboard's sticky <header> so the sticky save-bar tucks in
  // exactly below it. ResizeObserver keeps it in sync if tabs wrap or the
  // viewport changes.
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const measure = () => setHeaderOffset(header.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Reveal the sticky bar once the in-flow action buttons leave the viewport
  // top. rootMargin offsets by the header height so the bar appears as soon as
  // the buttons would be hidden behind the nav, not when they leave the page.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (!entry) return;
        // boundingClientRect.top < 0 means we have scrolled past the sentinel.
        const scrolledPast = entry.boundingClientRect.top < headerOffset && !entry.isIntersecting;
        setShowStickyBar(scrolledPast);
      },
      { rootMargin: `-${headerOffset}px 0px 0px 0px`, threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [headerOffset]);

  useEffect(() => {
    if (noteAutoSaveSkipFirst.current) {
      noteAutoSaveSkipFirst.current = false;
      return;
    }
    setNoteAutoSaveStatus('saving');
    const timer = setTimeout(async () => {
      await onSave({
        noteCaptureAllowlist: localSettings.noteCaptureAllowlist,
        noteMinLength: localSettings.noteMinLength,
        noteRetentionDays: localSettings.noteRetentionDays,
        noteTranslateDirection: localSettings.noteTranslateDirection,
        noteAutoTranslate: localSettings.noteAutoTranslate,
        noteToastDurationSeconds: localSettings.noteToastDurationSeconds,
      });
      setNoteAutoSaveStatus('saved');
      setTimeout(() => setNoteAutoSaveStatus('idle'), 1500);
    }, 400);
    return () => clearTimeout(timer);
  }, [
    localSettings.noteCaptureAllowlist,
    localSettings.noteMinLength,
    localSettings.noteRetentionDays,
    localSettings.noteTranslateDirection,
    localSettings.noteAutoTranslate,
    localSettings.noteToastDurationSeconds,
    onSave,
  ]);

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

  function handleResetDefaults() {
    if (!window.confirm('Reset all settings to defaults? Note capture allowlist and active deck will be preserved.')) return;
    setLocalSettings(prev => ({
      ...DEFAULT_SETTINGS,
      activeDeckId: prev.activeDeckId,
      noteCaptureAllowlist: prev.noteCaptureAllowlist,
    }));
  }

  function update<K extends keyof SettingsType>(key: K, value: SettingsType[K]) {
    setLocalSettings({ ...localSettings, [key]: value });
  }

  function toggle<K extends keyof SettingsType>(key: K) {
    update(key, !localSettings[key] as SettingsType[K]);
  }

  function isDomainEnabled(domain: string) {
    return localSettings.domainSettings[domain]?.enabled !== false;
  }

  function toggleDomain(domain: string) {
    setLocalSettings({
      ...localSettings,
      domainSettings: {
        ...localSettings.domainSettings,
        [domain]: { ...localSettings.domainSettings[domain], enabled: !isDomainEnabled(domain) },
      },
    });
  }

  function addAllowlistDomain() {
    const entry = normalizeAllowlistInput(allowlistInput);
    if (!entry) {
      setAllowlistError(null);
      return;
    }
    const validation = validateAllowlistEntry(entry);
    if (validation === 'invalid-regex') {
      setAllowlistError('Invalid regex pattern');
      return;
    }
    if (localSettings.noteCaptureAllowlist.includes(entry)) {
      setAllowlistInput('');
      setAllowlistError(null);
      return;
    }
    setLocalSettings({
      ...localSettings,
      noteCaptureAllowlist: [...localSettings.noteCaptureAllowlist, entry],
    });
    setAllowlistInput('');
    setAllowlistError(null);
  }

  function removeAllowlistDomain(entry: string) {
    setLocalSettings({
      ...localSettings,
      noteCaptureAllowlist: localSettings.noteCaptureAllowlist.filter(d => d !== entry),
    });
  }

  const activeSites = SUPPORTED_DOMAINS.filter(s => isDomainEnabled(s.domain)).length;
  const blockedToday = 27;
  const showAfter = String(localSettings.showAfterNPosts).padStart(2, ' ');

  const saveLabel = saving ? 'Saving…' : saved ? 'Saved' : 'Save changes';

  return (
    <div>
      <EditorialHeader
        kicker="05 · Settings"
        title={
          <>
            Calibrate the <span style={{ fontStyle: 'italic', color: 'var(--clay)' }}>quiet feed</span>.
          </>
        }
        sub="What the feed hides, how often quizzes appear, how strict your grader is."
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={handleResetDefaults} className="btn btn-ghost">Reset to defaults</button>
            <button type="button" onClick={handleSave} disabled={saving} className="btn btn-clay">
              {saveLabel}
            </button>
          </div>
        }
      />

      {/* Sentinel: tracks when the in-flow Save buttons have scrolled out of view. */}
      <div ref={sentinelRef} aria-hidden style={{ height: 0, marginTop: -1 }} />

      {/* Sticky save bar — slides in below the dashboard nav once the editorial
          header has scrolled away. Pointer-events disabled while hidden so it
          never blocks clicks underneath. */}
      <div
        role="toolbar"
        aria-label="Settings actions"
        style={{
          position: 'sticky',
          top: headerOffset,
          zIndex: 40,
          marginLeft: -24,
          marginRight: -24,
          padding: '10px 24px',
          background: 'rgba(245, 241, 235, 0.94)',
          backdropFilter: 'saturate(160%) blur(8px)',
          WebkitBackdropFilter: 'saturate(160%) blur(8px)',
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          opacity: showStickyBar ? 1 : 0,
          transform: showStickyBar ? 'translateY(0)' : 'translateY(-8px)',
          transition: 'opacity 160ms ease, transform 160ms ease',
          pointerEvents: showStickyBar ? 'auto' : 'none',
        }}
      >
        <button type="button" onClick={handleResetDefaults} className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }}>
          Reset to defaults
        </button>
        <button type="button" onClick={handleSave} disabled={saving} className="btn btn-clay" style={{ padding: '6px 14px', fontSize: 12 }}>
          {saveLabel}
        </button>
      </div>

      {/* === A · SITES & BLOCKING === */}
      <section style={{ marginTop: 12 }}>
        <SectionHead num="A" label="Sites & blocking" count={`${SUPPORTED_DOMAINS.length} SITES · ${activeSites} ACTIVE · ${blockedToday} BLOCKED TODAY`} />
        <div className="card-flat" style={{ borderRadius: 0 }}>
          <table className="dtable">
            <thead>
              <tr>
                <th style={{ paddingLeft: 24 }}>Site</th>
                <th style={{ textAlign: 'center' }}>Quizzes</th>
                <th style={{ textAlign: 'center' }}>Reels / Shorts</th>
                <th style={{ textAlign: 'center' }}>Sponsored</th>
                <th style={{ textAlign: 'center' }}>Suggested</th>
                <th style={{ textAlign: 'center', paddingRight: 24 }}>Strangers</th>
              </tr>
            </thead>
            <tbody>
              {SUPPORTED_DOMAINS.map(s => {
                const reelsKey = s.reels as keyof SettingsType;
                const sponsoredKey = s.sponsored as keyof SettingsType | null;
                const suggestedKey = s.suggested as keyof SettingsType | null;
                const strangersKey = s.strangers as keyof SettingsType | null;
                return (
                  <tr key={s.domain}>
                    <td style={{ paddingLeft: 24 }}>
                      <div className="serif" style={{ fontWeight: 600, fontSize: 16 }}>{s.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{s.hides}</div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <SiteToggle on={isDomainEnabled(s.domain)} onClick={() => toggleDomain(s.domain)} ariaLabel={`Quizzes on ${s.label}`} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <SiteToggle on={localSettings[reelsKey] as boolean} onClick={() => toggle(reelsKey)} ariaLabel={`Reels on ${s.label}`} />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {sponsoredKey
                        ? <SiteToggle on={localSettings[sponsoredKey] as boolean} onClick={() => toggle(sponsoredKey)} ariaLabel={`Sponsored on ${s.label}`} />
                        : <SiteToggle on={false} onClick={() => {}} dim />}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {suggestedKey
                        ? <SiteToggle on={localSettings[suggestedKey] as boolean} onClick={() => toggle(suggestedKey)} ariaLabel={`Suggested on ${s.label}`} />
                        : <SiteToggle on={false} onClick={() => {}} dim />}
                    </td>
                    <td style={{ textAlign: 'center', paddingRight: 24 }}>
                      {strangersKey
                        ? <SiteToggle on={localSettings[strangersKey] as boolean} onClick={() => toggle(strangersKey)} ariaLabel={`Strangers on ${s.label}`} />
                        : <SiteToggle on={false} onClick={() => {}} dim />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* === B · QUIZ BEHAVIOUR === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead num="B" label="Quiz behaviour" count="5 SETTINGS" />
        <div className="card-flat" style={{ padding: '4px 28px' }}>
          <Row label="Show after N posts" hint="Cards appear once you have scrolled past this many feed items.">
            <Stepper value={localSettings.showAfterNPosts} unit="posts" min={1} max={50} onChange={n => update('showAfterNPosts', n)} />
          </Row>
          <Row label="Pause after a card" hint="Cooldown before another quiz can appear on the same site.">
            <Stepper value={localSettings.pauseMinutesAfterQuiz} unit="min" min={0} max={180} onChange={n => update('pauseMinutesAfterQuiz', n)} />
          </Row>
          <Row label="Allow skip" hint="Show a Skip button and let Esc move past a card without grading.">
            <ToggleControl on={localSettings.allowSkip} onClick={() => toggle('allowSkip')} ariaLabel="Allow skip" />
          </Row>
          <Row label="Keyboard shortcuts" hint="Number keys to pick MCQ options, Enter to submit, Esc to skip.">
            <ToggleControl on={localSettings.enableKeyboardShortcuts} onClick={() => toggle('enableKeyboardShortcuts')} ariaLabel="Keyboard shortcuts" />
          </Row>
          <Row label="Show keyboard hints" hint="Display a small hint row beneath each quiz card." last>
            <ToggleControl on={localSettings.showKeyboardHints} onClick={() => toggle('showKeyboardHints')} ariaLabel="Keyboard hints" />
          </Row>
        </div>
      </section>

      {/* === C · ANSWER MATCHING === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead num="C" label="Answer matching" count="4 SETTINGS" />
        <div className="card-flat" style={{ padding: '4px 28px' }}>
          <Row label="Case sensitive" hint={'"Madrid" vs "madrid" — do they count the same?'}>
            <ToggleControl
              on={!localSettings.lowercaseNormalization}
              onClick={() => toggle('lowercaseNormalization')}
              ariaLabel="Case sensitive"
            />
          </Row>
          <Row label="Ignore characters" hint="Punctuation and accents stripped before comparison.">
            <FieldInput value={localSettings.eliminateChars} onChange={v => update('eliminateChars', v)} mono placeholder=".,!?" />
          </Row>
          <Row label="Fuzzy threshold" hint="Higher means stricter — fewer typos forgiven.">
            <Slider
              label="Levenshtein"
              min={0.6}
              max={1}
              step={0.01}
              value={localSettings.fuzzyThresholds.high}
              onChange={n => setLocalSettings({
                ...localSettings,
                fuzzyThresholds: {
                  ...localSettings.fuzzyThresholds,
                  high: n,
                  medium: Math.min(localSettings.fuzzyThresholds.medium, n),
                },
              })}
            />
          </Row>
          <Row label="Partial credit" hint="Threshold for a Grade-2 partial-credit answer." last>
            <Slider
              label="Partial"
              min={0.5}
              max={localSettings.fuzzyThresholds.high}
              step={0.01}
              value={localSettings.fuzzyThresholds.medium}
              onChange={n => setLocalSettings({
                ...localSettings,
                fuzzyThresholds: { ...localSettings.fuzzyThresholds, medium: n },
              })}
            />
          </Row>
        </div>
      </section>

      {/* === D · PIPELINE === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead num="D" label="The pipeline" />
        <div className="card-flat" style={{ padding: '24px 32px' }}>
          <pre className="ascii" style={{ margin: 0, fontSize: 12, lineHeight: 1.55 }}>
{`scroll                  scroll
  │                        │
  ▼                        ▼
┌──────┐  every ${showAfter}    ┌──────────┐
│ POST │ ───────────▶│  QUIZ    │
└──────┘  posts      │  (cloze) │
  │                  └────┬─────┘
  ▼                       │
 next                  graded ─▶ SM-2`}
          </pre>
        </div>
      </section>

      {/* === E · NOTE CAPTURE === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead
          num="E"
          label="Note capture"
          count={noteAutoSaveStatus === 'saved' ? 'AUTO-SAVED' : noteAutoSaveStatus === 'saving' ? 'SAVING…' : `${localSettings.noteCaptureAllowlist.length} ALLOWLISTED`}
        />
        <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 14px', maxWidth: 720 }}>
          Selections from allowlisted sites become Notes. Auto-saved as you edit.
        </p>
        <div className="card-flat" style={{ padding: '4px 28px' }}>
          <Row
            label="Allowlist domain"
            hint={<>Add a host like <span className="mono" style={{ fontSize: 12 }}>en.wikipedia.org</span> or a regex like <span className="mono" style={{ fontSize: 12 }}>/^.*\.wiki/</span>.</>}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <FieldInput
                value={allowlistInput}
                onChange={v => setAllowlistInput(v)}
                placeholder="example.com"
              />
              <button type="button" onClick={addAllowlistDomain} className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: 12 }}>
                Add
              </button>
            </div>
          </Row>
          {(allowlistError || localSettings.noteCaptureAllowlist.length > 0) && (
            <div style={{ padding: '14px 0', borderBottom: '1px solid var(--rule)' }}>
              {allowlistError && (
                <div className="mono" style={{ fontSize: 11, color: 'var(--rose)', marginBottom: 8 }}>{allowlistError}</div>
              )}
              {localSettings.noteCaptureAllowlist.length > 0 && (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {localSettings.noteCaptureAllowlist.map(entry => (
                    <li key={entry}>
                      <span className="pill" style={{ paddingRight: 6, gap: 4 }}>
                        {entry}
                        <button
                          type="button"
                          onClick={() => removeAllowlistDomain(entry)}
                          aria-label={`Remove ${entry}`}
                          style={{ background: 'transparent', border: 'none', color: 'var(--ink-3)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                        >×</button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Row label="Minimum length" hint="Selections shorter than this are ignored.">
            <Stepper
              value={localSettings.noteMinLength}
              unit="chars"
              min={1}
              max={50}
              onChange={n => update('noteMinLength', n)}
            />
          </Row>
          <Row label="Retention" hint="Notes older than this are deleted automatically. 0 keeps notes forever.">
            <Stepper
              value={localSettings.noteRetentionDays}
              unit="days"
              min={0}
              max={365}
              onChange={n => update('noteRetentionDays', n)}
            />
          </Row>
          <Row label="Translate direction" hint='Used by "Copy EN ↔ VI pairs" and the auto-translate toggle below.'>
            <StyledSelect<TranslateDirection>
              value={localSettings.noteTranslateDirection}
              onChange={v => update('noteTranslateDirection', v)}
              options={[
                { value: 'auto', label: 'Auto-detect' },
                { value: 'en->vi', label: 'EN → VI' },
                { value: 'vi->en', label: 'VI → EN' },
              ]}
            />
          </Row>
          <Row
            label="Auto-translate captures"
            hint="Translate each captured selection in the chosen direction and store it on the note. Off by default."
          >
            <ToggleControl
              on={localSettings.noteAutoTranslate}
              onClick={() => toggle('noteAutoTranslate')}
              ariaLabel="Auto-translate captured notes"
            />
          </Row>
          <Row
            label="Capture toast duration"
            hint="How long the on-page confirmation stays visible after a capture. Click the toast to dismiss it sooner."
            last
          >
            <Stepper
              value={localSettings.noteToastDurationSeconds}
              unit="sec"
              min={1}
              max={30}
              onChange={n => update('noteToastDurationSeconds', n)}
            />
          </Row>
        </div>
      </section>

      {/* === F · DATA === */}
      <section style={{ marginTop: 48, marginBottom: 24 }}>
        <SectionHead num="F" label="Data" count="EXPORT · WIPE" />
        <div className="card-flat" style={{ padding: '4px 28px' }}>
          <Row label="Export" hint="Download every card and deck as JSON for backup or migration.">
            <button
              type="button"
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
              className="btn btn-ghost"
              style={{ padding: '10px 18px' }}
            >
              Export all data
            </button>
          </Row>
          <Row label="Clear" hint="Delete every card, deck, note, and setting. This cannot be undone." last>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Are you sure you want to delete ALL data? This cannot be undone.')) {
                  chrome.storage.local.clear();
                  window.location.reload();
                }
              }}
              className="btn"
              style={{
                background: 'transparent',
                color: 'var(--rose)',
                border: '1px solid var(--rose)',
                padding: '10px 18px',
              }}
            >
              Clear all data
            </button>
          </Row>
        </div>
      </section>
    </div>
  );
}
