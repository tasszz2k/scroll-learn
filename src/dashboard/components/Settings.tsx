import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  Settings as SettingsType,
  Response,
  TranslateDirection,
  GeminiApiModelId,
  GeminiModelChoice,
  GeminiAutoStrategy,
  KeywordGroup,
} from '../../common/types';
import { DEFAULT_SETTINGS, GEMINI_API_MODELS, STORAGE_KEYS } from '../../common/types';
import { newKeywordGroupId } from '../../common/storage';
import { MODEL_QUOTAS, getUsage, type GeminiApiUsage } from '../../common/gemini/quota';
import { parseRegexEntry, validateAllowlistEntry } from '../../common/allowlist';
import EditorialHeader from './EditorialHeader';
import SettingsKeywordSuggest from './SettingsKeywordSuggest';
import SettingsKeywordAutoGroup from './SettingsKeywordAutoGroup';
import { useConfirm } from '../hooks/useConfirm';

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

const KEYWORD_PRESETS: { label: string; keywords: string[] }[] = [
  { label: 'War & conflict',  keywords: ['war', 'conflict', 'attack', 'missile', 'bomb', 'military', 'troops'] },
  { label: 'Politics',        keywords: ['election', 'congress', 'senate', 'president', 'democrat', 'republican'] },
  { label: 'Crypto',          keywords: ['bitcoin', 'crypto', 'ethereum', 'nft', 'blockchain', 'defi', 'altcoin'] },
  { label: 'Celebrity',       keywords: ['celebrity', 'gossip', 'drama', 'kardashian', 'paparazzi'] },
  { label: 'Sports scores',   keywords: ['score', 'match result', 'standings', 'league table', 'fixture'] },
];

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

function FieldInput({ value, onChange, mono, placeholder, secret }: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; secret?: boolean }) {
  // Secrets render masked by default with a small reveal toggle. Browsers
  // also avoid autofill / spellcheck / password-manager prompts on
  // type="password", which is what we want for an HF token field.
  const [revealed, setRevealed] = useState(false);
  const isSecret = !!secret;
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
        type={isSecret && !revealed ? 'password' : 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? 'mono' : 'serif'}
        autoComplete={isSecret ? 'off' : undefined}
        spellCheck={isSecret ? false : undefined}
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
      {isSecret && (
        <button
          type="button"
          onClick={() => setRevealed(r => !r)}
          aria-label={revealed ? 'Hide token' : 'Show token'}
          title={revealed ? 'Hide token' : 'Show token'}
          className="mono"
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--ink-3)',
            fontSize: 11,
            padding: '0 12px',
            height: '100%',
            borderLeft: '1px solid var(--rule-2)',
            letterSpacing: '.06em',
          }}
        >
          {revealed ? 'HIDE' : 'SHOW'}
        </button>
      )}
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

// Multi-line text input for free-form prose like the AI personal-context
// blob. Wider than FieldInput because the value is paragraphs, not a key.
function FieldTextarea({
  value,
  onChange,
  placeholder,
  rows = 6,
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      spellCheck={true}
      className="serif"
      style={{
        width: '100%',
        minWidth: 280,
        padding: '10px 12px',
        background: 'var(--card)',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        outline: 'none',
        fontSize: 13,
        lineHeight: 1.5,
        color: 'var(--ink)',
        resize: 'vertical',
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
      }}
    />
  );
}

// Tiny read-only tile that shows per-model "X / RPD requests" for the Gemini
// API path. Subscribes to storage.onChanged so the counters tick up in real
// time as the dashboard's other tabs make API calls.
function GeminiUsageDisplay() {
  const [usage, setUsage] = useState<GeminiApiUsage>({});

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void getUsage().then(u => { if (!cancelled) setUsage(u); });
    };
    refresh();
    function onChanged(changes: { [key: string]: chrome.storage.StorageChange }, area: string) {
      if (area !== 'local') return;
      if (!(STORAGE_KEYS.GEMINI_API_USAGE in changes)) return;
      refresh();
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 260,
        padding: '8px 12px',
        border: '1px solid var(--rule-2)',
        borderRadius: 8,
        background: 'var(--card)',
        fontSize: 12,
      }}
    >
      {(Object.keys(MODEL_QUOTAS) as GeminiApiModelId[]).map(id => {
        const used = usage[id]?.dayCount ?? 0;
        const quota = MODEL_QUOTAS[id];
        const exhausted = used >= quota.rpd;
        return (
          <div
            key={id}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}
          >
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>{id}</span>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: exhausted ? 'var(--rose)' : 'var(--ink)',
                fontWeight: 600,
              }}
            >
              {used} / {quota.rpd}
            </span>
          </div>
        );
      })}
      <div className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 2 }}>
        resets at 00:00 UTC
      </div>
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

/* ----- Keyword group card ----- */

interface KeywordGroupCardProps {
  group: KeywordGroup;
  keywordHits: Record<string, number>;
  onRename: (label: string) => void;
  onToggle: () => void;
  onDelete: () => void;
  onAddKeyword: (raw: string) => void;
  onRemoveKeyword: (kw: string) => void;
}

function KeywordGroupCard({
  group,
  keywordHits,
  onRename,
  onToggle,
  onDelete,
  onAddKeyword,
  onRemoveKeyword,
}: KeywordGroupCardProps) {
  // Local-only state for the rename input so unmounted edits don't trigger
  // a save mid-typing -- we only commit on blur / Enter.
  const [labelDraft, setLabelDraft] = useState(group.label);
  const [addInput, setAddInput] = useState('');

  // Keep labelDraft in sync if the parent rewrites the group (e.g. another
  // tab/window edits settings via chrome.storage.onChanged). Uses the
  // "adjusting state on parent change" pattern from React docs -- compare
  // during render via a `prevLabel` slot so setState never runs from inside
  // a useEffect body.
  const [prevLabel, setPrevLabel] = useState(group.label);
  if (prevLabel !== group.label) {
    setPrevLabel(group.label);
    setLabelDraft(group.label);
  }

  function commitRename() {
    const cleaned = labelDraft.trim();
    if (!cleaned) {
      setLabelDraft(group.label);
      return;
    }
    if (cleaned !== group.label) onRename(cleaned);
  }

  function submitAdd() {
    const cleaned = addInput.trim();
    if (!cleaned) return;
    onAddKeyword(cleaned);
    setAddInput('');
  }

  const totalHits = group.keywords.reduce((sum, kw) => sum + (keywordHits[kw] ?? 0), 0);
  const muted = !group.enabled;

  return (
    <div
      style={{
        border: '1px solid var(--rule-2, #e0e0e0)',
        borderRadius: 8,
        padding: '12px 14px',
        background: muted ? 'var(--bg-secondary, #f8f8f8)' : 'var(--card, #fff)',
        opacity: muted ? 0.72 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <input
          type="text"
          value={labelDraft}
          onChange={e => setLabelDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.currentTarget.blur(); }
            else if (e.key === 'Escape') { setLabelDraft(group.label); e.currentTarget.blur(); }
          }}
          aria-label={`Rename group ${group.label}`}
          className="serif"
          style={{
            flex: 1,
            padding: '4px 6px',
            fontSize: 15,
            fontWeight: 600,
            border: '1px solid transparent',
            background: 'transparent',
            color: 'var(--ink, #111)',
            outline: 'none',
            borderRadius: 4,
            textDecoration: muted ? 'line-through' : 'none',
          }}
        />
        <span
          className="mono"
          style={{ fontSize: 11, color: 'var(--ink-3, #777)', letterSpacing: '0.05em' }}
          title={`${group.keywords.length} keyword${group.keywords.length === 1 ? '' : 's'} · ${totalHits} hidden all time`}
        >
          {group.keywords.length} kw · {totalHits} blocked
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={group.enabled}
          aria-label={`${group.enabled ? 'Mute' : 'Enable'} group ${group.label}`}
          className={'switch-editorial' + (group.enabled ? ' on' : '')}
        />
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete group ${group.label}`}
          title="Delete group"
          style={{
            background: 'transparent',
            border: '1px solid var(--rule-2, #ddd)',
            borderRadius: 6,
            padding: '4px 8px',
            cursor: 'pointer',
            color: 'var(--ink-3, #777)',
            fontSize: 12,
          }}
        >
          Delete
        </button>
      </div>

      {group.keywords.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted, #888)', padding: '4px 0 8px' }}>
          No keywords in this group yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {group.keywords.map(kw => {
            const hits = keywordHits[kw] ?? 0;
            return (
              <span
                key={kw}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  fontSize: 13,
                  borderRadius: 14,
                  background: 'var(--accent-soft, #e8f0fe)',
                  color: 'var(--accent, #1a73e8)',
                  border: '1px solid var(--accent-border, #c5d8fb)',
                }}
              >
                {kw}
                {hits > 0 && <span style={{ fontSize: 11, opacity: 0.75 }}>({hits})</span>}
                <button
                  onClick={() => onRemoveKeyword(kw)}
                  aria-label={`Remove keyword ${kw} from ${group.label}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    color: 'inherit',
                    opacity: 0.6,
                    fontSize: 14,
                  }}
                >
                  x
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          value={addInput}
          onChange={e => setAddInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submitAdd(); }}
          placeholder={`Add to "${group.label}"`}
          aria-label={`Add keyword to ${group.label}`}
          style={{
            flex: 1,
            padding: '5px 10px',
            fontSize: 12,
            border: '1px solid var(--border, #ddd)',
            borderRadius: 6,
            background: 'var(--bg-input, #fff)',
            color: 'var(--text, #333)',
          }}
        />
        <button
          onClick={submitAdd}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid var(--border, #ddd)',
            background: 'var(--bg-secondary, #f5f5f5)',
            cursor: 'pointer',
            color: 'var(--text, #333)',
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ----- Settings ----- */

export default function Settings({ settings, onSave }: SettingsProps) {
  const confirm = useConfirm();
  const [localSettings, setLocalSettings] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [allowlistInput, setAllowlistInput] = useState('');
  const [allowlistError, setAllowlistError] = useState<string | null>(null);
  const [keywordInput, setKeywordInput] = useState('');
  const [noteAutoSaveStatus, setNoteAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const noteAutoSaveSkipFirst = useRef(true);
  const [aiAutoSaveStatus, setAiAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const aiAutoSaveSkipFirst = useRef(true);
  const [keywordAutoSaveStatus, setKeywordAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const keywordAutoSaveSkipFirst = useRef(true);

  // Auto-save effects call onSave through this ref instead of taking it as a
  // dependency. If the parent ever passes an unstable onSave (fresh function
  // ref every render), the dep-array version of these effects would fire on
  // every App render and produce a SAVING / AUTO-SAVED spam loop the moment
  // the dashboard re-renders for any reason (storage live-sync, blocker hit,
  // etc.). The ref decouples effect re-runs from callback identity so the
  // effects only re-run when actual settings content changes.
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

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
      await onSaveRef.current({
        noteCaptureAllowlist: localSettings.noteCaptureAllowlist,
        noteCaptureAllSites: localSettings.noteCaptureAllSites,
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
    localSettings.noteCaptureAllSites,
    localSettings.noteMinLength,
    localSettings.noteRetentionDays,
    localSettings.noteTranslateDirection,
    localSettings.noteAutoTranslate,
    localSettings.noteToastDurationSeconds,
  ]);

  // Auto-save AI provider fields. Without this the user has to remember to
  // click Save changes after pasting a key, and Generate quiz silently falls
  // back to the browser path because storage still reads geminiApiKey: ''.
  useEffect(() => {
    if (aiAutoSaveSkipFirst.current) {
      aiAutoSaveSkipFirst.current = false;
      return;
    }
    setAiAutoSaveStatus('saving');
    const timer = setTimeout(async () => {
      await onSaveRef.current({
        geminiApiKey: localSettings.geminiApiKey,
        geminiPersonalContext: localSettings.geminiPersonalContext,
        geminiPreferredModel: localSettings.geminiPreferredModel,
        geminiAutoStrategy: localSettings.geminiAutoStrategy,
      });
      setAiAutoSaveStatus('saved');
      setTimeout(() => setAiAutoSaveStatus('idle'), 1500);
    }, 600);
    return () => clearTimeout(timer);
  }, [
    localSettings.geminiApiKey,
    localSettings.geminiPersonalContext,
    localSettings.geminiPreferredModel,
    localSettings.geminiAutoStrategy,
  ]);

  // Auto-save keyword filter fields. Without this, adding a keyword (Enter,
  // Add button, quick-add preset, AI Suggest, group toggle, group rename)
  // only mutates local state until the user remembers to click Save
  // changes, so the content blocker keeps reading the old list and never
  // hides the new term. storage.saveSettings recomputes blockedKeywords
  // from keywordGroups, so we don't ship the flat list here -- groups own
  // the truth.
  //
  // IMPORTANT: keywordHits is intentionally NOT in this effect. The content
  // blocker writes hits to chrome.storage on every blocked post, the
  // dashboard's storage.onChanged listener live-syncs them into
  // localSettings, and watching that field here would (a) spam a save on
  // every blocked post (status flickers SAVING / AUTO-SAVED endlessly) and
  // (b) race with the blocker -- the dashboard's stale hits would overwrite
  // the blocker's freshly incremented counts. Hits are blocker-owned;
  // storage.saveSettings prunes stale entries against keywordGroups on its
  // own, so leaving keywordHits out of the payload is correct.
  useEffect(() => {
    if (keywordAutoSaveSkipFirst.current) {
      keywordAutoSaveSkipFirst.current = false;
      return;
    }
    setKeywordAutoSaveStatus('saving');
    const timer = setTimeout(async () => {
      await onSaveRef.current({
        hideByKeyword: localSettings.hideByKeyword,
        keywordGroups: localSettings.keywordGroups,
      });
      setKeywordAutoSaveStatus('saved');
      setTimeout(() => setKeywordAutoSaveStatus('idle'), 1500);
    }, 400);
    return () => clearTimeout(timer);
  }, [
    localSettings.hideByKeyword,
    localSettings.keywordGroups,
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

  async function handleResetDefaults() {
    const ok = await confirm({
      title: 'Reset settings',
      message: 'Reset all settings to defaults? Note capture allowlist and active deck will be preserved.',
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    setLocalSettings(prev => ({
      ...DEFAULT_SETTINGS,
      activeDeckId: prev.activeDeckId,
      noteCaptureAllowlist: prev.noteCaptureAllowlist,
      noteCaptureAllSites: prev.noteCaptureAllSites,
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

  // --- Keyword group helpers ---
  //
  // The grouped store (localSettings.keywordGroups) is the source of truth.
  // storage.saveSettings recomputes the flat blockedKeywords list from these
  // groups on every persist, so the content blocker keeps reading one flat
  // field and we never need to keep two lists in sync from the UI side.

  function setGroups(next: KeywordGroup[]) {
    setLocalSettings({ ...localSettings, keywordGroups: next });
  }

  // Find a group by case-insensitive label (used by quick-add preset buttons
  // and AI Suggest -- both want "extend if a topic group already exists,
  // otherwise create it").
  function findGroupByLabel(label: string): KeywordGroup | undefined {
    const norm = label.trim().toLowerCase();
    return localSettings.keywordGroups.find(g => g.label.trim().toLowerCase() === norm);
  }

  function addGroup(label: string): KeywordGroup {
    const cleaned = label.trim() || 'Untitled';
    const fresh: KeywordGroup = {
      id: newKeywordGroupId(),
      label: cleaned,
      enabled: true,
      keywords: [],
    };
    setGroups([...localSettings.keywordGroups, fresh]);
    return fresh;
  }

  function renameGroup(id: string, nextLabel: string) {
    const cleaned = nextLabel.trim() || 'Untitled';
    setGroups(localSettings.keywordGroups.map(g => g.id === id ? { ...g, label: cleaned } : g));
  }

  function deleteGroup(id: string) {
    setGroups(localSettings.keywordGroups.filter(g => g.id !== id));
  }

  function toggleGroup(id: string) {
    setGroups(localSettings.keywordGroups.map(g => g.id === id ? { ...g, enabled: !g.enabled } : g));
  }

  function addKeywordToGroup(groupId: string, raw: string) {
    const kw = raw.trim();
    if (!kw) return;
    const lower = kw.toLowerCase();
    setGroups(localSettings.keywordGroups.map(g => {
      if (g.id !== groupId) return g;
      if (g.keywords.some(k => k.toLowerCase() === lower)) return g;
      return { ...g, keywords: [...g.keywords, kw] };
    }));
  }

  function removeKeywordFromGroup(groupId: string, kw: string) {
    setGroups(localSettings.keywordGroups.map(g => {
      if (g.id !== groupId) return g;
      return { ...g, keywords: g.keywords.filter(k => k !== kw) };
    }));
  }

  // Add the preset's keywords to a same-named group, creating it on first use.
  // Idempotent and case-insensitive: clicking "+ Politics" twice never
  // duplicates a keyword, never creates two "Politics" groups.
  function addPreset(label: string, keywords: string[]) {
    const existing = findGroupByLabel(label);
    if (existing) {
      const existingLower = new Set(existing.keywords.map(k => k.toLowerCase()));
      const toAdd = keywords.filter(k => !existingLower.has(k.toLowerCase()));
      if (toAdd.length === 0) {
        // Nothing new to merge; just make sure the group is enabled so the
        // user's click feels acknowledged.
        if (!existing.enabled) toggleGroup(existing.id);
        return;
      }
      setGroups(localSettings.keywordGroups.map(g => {
        if (g.id !== existing.id) return g;
        return { ...g, enabled: true, keywords: [...g.keywords, ...toAdd] };
      }));
      return;
    }
    const fresh: KeywordGroup = {
      id: newKeywordGroupId(),
      label,
      enabled: true,
      keywords: [...keywords],
    };
    setGroups([...localSettings.keywordGroups, fresh]);
  }

  // AI Suggest hands us a topic + a list of fresh keywords. Drop them into a
  // group named after the topic (so the user can later mute that specific
  // topic without losing other AI-generated buckets).
  function addAiSuggestion(topic: string, keywords: string[]) {
    if (keywords.length === 0) return;
    addPreset(topic, keywords);
  }

  // AI Auto-group hands us a plan: each entry is { label, keywords[] }, where
  // `keywords` is a subset of the current "Uncategorized" group (already
  // narrowed by the parser to the verbatim input set). Apply the entire plan
  // in one setGroups call so the auto-save only fires once.
  //
  // Semantics:
  //   1. Each planned keyword is removed from "Uncategorized" (case-insensitive
  //      match against the planned set).
  //   2. For each plan entry, merge into an existing same-named group (case-
  //      insensitive on label) if one exists; otherwise create a fresh group.
  //      Existing groups stay enabled regardless; new groups start enabled.
  //   3. Keywords already present in the target group are deduped out.
  function applyAutoGroup(plan: { label: string; keywords: string[] }[]) {
    if (plan.length === 0) return;

    // Collect every keyword the plan touches so we can clear them out of
    // "Uncategorized" in one pass.
    const movedLower = new Set<string>();
    for (const g of plan) {
      for (const kw of g.keywords) movedLower.add(kw.toLowerCase());
    }
    if (movedLower.size === 0) return;

    let next = localSettings.keywordGroups;

    // Remove the moved keywords from any "Uncategorized" group (case-
    // insensitive label match).
    next = next.map(g => {
      if (g.label.trim().toLowerCase() !== 'uncategorized') return g;
      const remaining = g.keywords.filter(k => !movedLower.has(k.toLowerCase()));
      return remaining.length === g.keywords.length ? g : { ...g, keywords: remaining };
    });

    // Merge each plan entry into an existing same-named group or create a
    // new one. We rebuild `next` step-by-step rather than going through the
    // setGroups/findGroupByLabel pair so a single render pass sees the full
    // result.
    for (const planGroup of plan) {
      const label = planGroup.label.trim();
      if (!label || planGroup.keywords.length === 0) continue;
      const labelLower = label.toLowerCase();

      // Skip moving keywords back into "Uncategorized" -- if the model
      // labeled some keywords "Uncategorized" we leave them where they were.
      if (labelLower === 'uncategorized') continue;

      const existingIdx = next.findIndex(
        g => g.label.trim().toLowerCase() === labelLower,
      );
      if (existingIdx >= 0) {
        const existing = next[existingIdx];
        const existingLower = new Set(existing.keywords.map(k => k.toLowerCase()));
        const toAdd = planGroup.keywords.filter(k => !existingLower.has(k.toLowerCase()));
        if (toAdd.length === 0) continue;
        next = next.map((g, i) =>
          i === existingIdx
            ? { ...g, enabled: true, keywords: [...g.keywords, ...toAdd] }
            : g,
        );
      } else {
        next = [
          ...next,
          {
            id: newKeywordGroupId(),
            label,
            enabled: true,
            keywords: [...planGroup.keywords],
          },
        ];
      }
    }

    setGroups(next);
  }

  // Convenience for the inline "Add keyword" composer at the top of Section C.
  // Drops the keyword into a default "Uncategorized" group (creating it on
  // first use) so users who don't want to think about topic taxonomy can
  // still add a one-off keyword.
  function addKeyword(raw: string) {
    const kw = raw.trim();
    if (!kw) return;
    let group = findGroupByLabel('Uncategorized');
    if (!group) {
      group = addGroup('Uncategorized');
      // addGroup mutated state asynchronously via setLocalSettings; build the
      // next state by hand so the keyword lands in the new group in the same
      // render pass instead of waiting for a second render to see the group.
      const fresh: KeywordGroup = { ...group, keywords: [kw] };
      setGroups([...localSettings.keywordGroups, fresh]);
      return;
    }
    addKeywordToGroup(group.id, kw);
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

      {/* === A · AI PROVIDER === */}
      <section style={{ marginTop: 12 }}>
        <SectionHead
          num="A"
          label="AI provider"
          count={
            aiAutoSaveStatus === 'saved' ? 'AUTO-SAVED'
            : aiAutoSaveStatus === 'saving' ? 'SAVING...'
            : localSettings.geminiApiKey ? 'API · LIVE'
            : 'BROWSER FALLBACK'
          }
        />
        <div className="card-flat" style={{ padding: '4px 28px' }}>
          <Row
            label="Gemini API key"
            hint={
              <>
                Free key from <span className="mono">aistudio.google.com/app/apikey</span>. Generate quiz, Ask, Shadow scripts, and pronunciation check then call the API directly with quota-aware model rotation. Empty falls back to driving <span className="mono">gemini.google.com</span> in a popup window.
              </>
            }
          >
            <FieldInput
              value={localSettings.geminiApiKey}
              onChange={v => update('geminiApiKey', v)}
              mono
              secret
              placeholder="AIza..."
            />
          </Row>
          <Row
            label="Default model"
            hint={
              <>
                Choose a model or let <span className="mono">Auto</span> rotate across the four free-tier flash models. Free quotas (RPD = requests per day) reset at midnight UTC.
              </>
            }
          >
            <StyledSelect<GeminiModelChoice>
              value={localSettings.geminiPreferredModel}
              onChange={v => update('geminiPreferredModel', v)}
              options={[
                { value: 'auto', label: 'Auto · pick by strategy' },
                ...GEMINI_API_MODELS.map(m => ({
                  value: m.id as GeminiModelChoice,
                  label: `${m.label} · ${m.rpd}/day`,
                })),
              ]}
            />
          </Row>
          {localSettings.geminiPreferredModel === 'auto' && (
            <Row
              label="Auto strategy"
              hint={
                <>
                  <strong>Prefer volume</strong> burns the 500-RPD lite pool first (~560 daily total). <strong>Prefer quality</strong> spends the flagship 20-RPD pools first for sharper answers, then falls back to lite.
                </>
              }
            >
              <ToggleControl
                on={localSettings.geminiAutoStrategy === 'quality'}
                onClick={() => update(
                  'geminiAutoStrategy',
                  (localSettings.geminiAutoStrategy === 'quality' ? 'volume' : 'quality') as GeminiAutoStrategy,
                )}
                label={{ on: 'Prefer quality', off: 'Prefer volume' }}
                ariaLabel="Auto strategy"
              />
            </Row>
          )}
          <Row
            label="Personal context"
            hint={
              <>
                Sent with every AI request (system instruction on API; prepended on first turn for browser fallback). Tell the tutor your name, mother tongue, target language and level, goals, and how you want feedback.
              </>
            }
          >
            <FieldTextarea
              value={localSettings.geminiPersonalContext}
              onChange={v => update('geminiPersonalContext', v)}
              placeholder={'Mother tongue: ...\nTarget language and level: ...\nGoal: ...\nFeedback style: ...'}
              rows={6}
            />
          </Row>
          <Row label="API usage today" hint="Live counter of successful API calls per model. Resets at 00:00 UTC." last>
            <GeminiUsageDisplay />
          </Row>
        </div>
      </section>

      {/* === B · SITES & BLOCKING === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead num="B" label="Sites & blocking" count={`${SUPPORTED_DOMAINS.length} SITES · ${activeSites} ACTIVE · ${blockedToday} BLOCKED TODAY`} />
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

      {/* === C · KEYWORD FILTERS === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead
          num="C"
          label="Keyword filters"
          count={
            keywordAutoSaveStatus === 'saved' ? 'AUTO-SAVED'
            : keywordAutoSaveStatus === 'saving' ? 'SAVING...'
            : `${localSettings.keywordGroups.length} GROUPS · ${localSettings.blockedKeywords.length} KEYWORDS · ${Object.values(localSettings.keywordHits).reduce((a, b) => a + b, 0)} BLOCKED`
          }
        />
        <div className="card-flat" style={{ padding: '16px 28px' }}>
          <Row label="Hide posts by keyword" hint="Hide any post on Facebook, Instagram, or YouTube whose text contains a matching word or phrase (whole-word, case-insensitive). Per-group toggles let you mute a topic without losing its keywords.">
            <ToggleControl on={localSettings.hideByKeyword} onClick={() => toggle('hideByKeyword')} ariaLabel="Hide posts by keyword" />
          </Row>
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick add a topic group</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {KEYWORD_PRESETS.map(preset => {
                const existing = findGroupByLabel(preset.label);
                const isLive = !!existing && existing.enabled;
                return (
                  <button
                    key={preset.label}
                    onClick={() => addPreset(preset.label, preset.keywords)}
                    title={existing
                      ? `Merge new keywords into existing "${preset.label}" group`
                      : `Create a "${preset.label}" group with ${preset.keywords.length} keywords`}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      borderRadius: 12,
                      border: '1px solid var(--border, #ddd)',
                      background: isLive ? 'var(--accent-soft, #e8f0fe)' : 'var(--bg-secondary, #f5f5f5)',
                      cursor: 'pointer',
                      color: isLive ? 'var(--accent, #1a73e8)' : 'var(--text, #333)',
                    }}
                  >
                    + {preset.label}{existing ? ' (added)' : ''}
                  </button>
                );
              })}
              <button
                onClick={() => addGroup('Untitled')}
                title="Create a custom topic group"
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  borderRadius: 12,
                  border: '1px dashed var(--border, #ddd)',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text, #333)',
                }}
              >
                + New group
              </button>
            </div>
            <SettingsKeywordSuggest
              existingKeywords={localSettings.blockedKeywords}
              onAdd={(topic, keywords) => addAiSuggestion(topic, keywords)}
            />
            <SettingsKeywordAutoGroup
              ungroupedKeywords={
                findGroupByLabel('Uncategorized')?.keywords ?? []
              }
              existingLabels={localSettings.keywordGroups
                .map(g => g.label.trim())
                .filter(label => label && label.toLowerCase() !== 'uncategorized')}
              onApply={applyAutoGroup}
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    addKeyword(keywordInput);
                    setKeywordInput('');
                  }
                }}
                placeholder='Add a keyword to "Uncategorized", press Enter'
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  fontSize: 13,
                  border: '1px solid var(--border, #ddd)',
                  borderRadius: 6,
                  background: 'var(--bg-input, #fff)',
                  color: 'var(--text, #333)',
                }}
              />
              <button
                onClick={() => { addKeyword(keywordInput); setKeywordInput(''); }}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid var(--border, #ddd)',
                  background: 'var(--bg-secondary, #f5f5f5)',
                  cursor: 'pointer',
                  color: 'var(--text, #333)',
                }}
              >
                Add
              </button>
            </div>
            {localSettings.keywordGroups.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted, #888)', padding: '8px 0' }}>
                No groups yet. Pick a quick-add topic above, add a keyword, or click "+ New group".
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {localSettings.keywordGroups.map(group => (
                  <KeywordGroupCard
                    key={group.id}
                    group={group}
                    keywordHits={localSettings.keywordHits}
                    onRename={label => renameGroup(group.id, label)}
                    onToggle={() => toggleGroup(group.id)}
                    onDelete={() => deleteGroup(group.id)}
                    onAddKeyword={raw => addKeywordToGroup(group.id, raw)}
                    onRemoveKeyword={kw => removeKeywordFromGroup(group.id, kw)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* === D · QUIZ BEHAVIOUR === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead num="D" label="Quiz behaviour" count="8 SETTINGS" />
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
          <Row label="Auto-speak answer" hint="Pronounce the correct answer aloud when you answer correctly or finish a retry.">
            <ToggleControl on={localSettings.autoSpeakAnswer} onClick={() => toggle('autoSpeakAnswer')} ariaLabel="Auto speak answer" />
          </Row>
          <Row label="Keyboard shortcuts" hint="Number keys to pick MCQ options, Enter to submit, Esc to skip.">
            <ToggleControl on={localSettings.enableKeyboardShortcuts} onClick={() => toggle('enableKeyboardShortcuts')} ariaLabel="Keyboard shortcuts" />
          </Row>
          <Row label="Show keyboard hints" hint="Display a small hint row beneath each quiz card.">
            <ToggleControl on={localSettings.showKeyboardHints} onClick={() => toggle('showKeyboardHints')} ariaLabel="Keyboard hints" />
          </Row>
          <Row
            label="Kokoro Local engine"
            hint={
              <>
                Expose the in-browser <span className="mono">Kokoro Local</span> engine in the Shadow player. Carries a one-time ~92 MB model download and runs best on WebGPU-capable browsers. Off by default; <span className="mono">Kokoro API</span> and <span className="mono">ElevenLabs API</span> remain available regardless.
              </>
            }
          >
            <ToggleControl
              on={localSettings.enableKokoroLocal}
              onClick={() => toggle('enableKokoroLocal')}
              ariaLabel="Enable Kokoro Local engine"
            />
          </Row>
          <Row
            label="Kokoro API token"
            hint={
              <>
                Hugging Face access token for the Shadow player's <span className="mono">Kokoro TTS - API</span> engine. Free tokens at <span className="mono">huggingface.co/settings/tokens</span> include ~4 GPU-min/day on the Space (cached audio replays for free).
              </>
            }
          >
            <FieldInput
              value={localSettings.kokoroApiToken}
              onChange={v => update('kokoroApiToken', v)}
              mono
              secret
              placeholder="hf_..."
            />
          </Row>
          <Row
            label="ElevenLabs API key"
            hint={
              <>
                API key for the Shadow player's <span className="mono">ElevenLabs - API</span> engine. Free keys at <span className="mono">elevenlabs.io/app/settings/api-keys</span> include ~10k monthly credits on Flash v2.5 (cached audio replays for free). Bypasses the browser-driven path entirely.
              </>
            }
            last
          >
            <FieldInput
              value={localSettings.elevenLabsApiKey}
              onChange={v => update('elevenLabsApiKey', v)}
              mono
              secret
              placeholder="sk_..."
            />
          </Row>
        </div>
      </section>

      {/* === E · ANSWER MATCHING === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead num="E" label="Answer matching" count="4 SETTINGS" />
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

      {/* === F · PIPELINE === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead num="F" label="The pipeline" />
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

      {/* === G · NOTE CAPTURE === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead
          num="G"
          label="Note capture"
          count={
            noteAutoSaveStatus === 'saved'
              ? 'AUTO-SAVED'
              : noteAutoSaveStatus === 'saving'
                ? 'SAVING…'
                : localSettings.noteCaptureAllSites
                  ? 'ALL SITES'
                  : `${localSettings.noteCaptureAllowlist.length} ALLOWLISTED`
          }
        />
        <p style={{ fontSize: 13, color: 'var(--ink-3)', margin: '0 0 14px', maxWidth: 720 }}>
          Selections from allowlisted sites become Notes. Auto-saved as you edit.
        </p>
        <div className="card-flat" style={{ padding: '4px 28px' }}>
          <Row
            label="Enable on all sites"
            hint="Capture bookmarks on every site you visit. Overrides the allowlist below."
          >
            <ToggleControl
              on={localSettings.noteCaptureAllSites}
              onClick={() => toggle('noteCaptureAllSites')}
              ariaLabel="Enable note capture on all sites"
            />
          </Row>
          <Row
            label="Allowlist domain"
            hint={
              localSettings.noteCaptureAllSites
                ? <>Currently ignored because <strong>Enable on all sites</strong> is on. Turn it off to manage per-host.</>
                : <>Add a host like <span className="mono" style={{ fontSize: 12 }}>en.wikipedia.org</span> or a regex like <span className="mono" style={{ fontSize: 12 }}>/^.*\.wiki/</span>.</>
            }
          >
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                opacity: localSettings.noteCaptureAllSites ? 0.45 : 1,
                pointerEvents: localSettings.noteCaptureAllSites ? 'none' : 'auto',
              }}
              aria-disabled={localSettings.noteCaptureAllSites || undefined}
            >
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
            <div
              style={{
                padding: '14px 0',
                borderBottom: '1px solid var(--rule)',
                opacity: localSettings.noteCaptureAllSites ? 0.45 : 1,
              }}
            >
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

      {/* === H · DATA === */}
      <section style={{ marginTop: 48, marginBottom: 24 }}>
        <SectionHead num="H" label="Data" count="EXPORT · WIPE" />
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
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete all data',
                  message: 'Are you sure you want to delete ALL data? This cannot be undone.',
                  confirmLabel: 'Delete everything',
                  variant: 'danger',
                });
                if (ok) {
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

      {/* === I · ABOUT === */}
      <section style={{ marginTop: 48, marginBottom: 48 }}>
        <SectionHead num="I" label="About" count={`v${chrome.runtime.getManifest().version}`} />
        <div className="card-flat" style={{ padding: '4px 28px' }}>
          <Row label="Extension" hint="Name and current installed version." last>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span className="serif" style={{ fontSize: 16, fontWeight: 600 }}>
                {chrome.runtime.getManifest().name}
              </span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.05em' }}>
                v{chrome.runtime.getManifest().version}
              </span>
            </div>
          </Row>
        </div>
      </section>
    </div>
  );
}
