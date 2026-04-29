import { useEffect, useState } from 'react';
import type { ShadowScript } from '../../../common/types';
import { useConfirm } from '../../hooks/useConfirm';
import { computeScriptReadiness, type ScriptReadiness } from './readiness';
import ShadowScriptInspector from './ShadowScriptInspector';

interface ShadowScriptListProps {
  scripts: ShadowScript[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (next: ShadowScript) => void | Promise<void>;
  // Shared with the player so this table re-scans its AUDIO column when a
  // new line lands in the cache.
  cacheBump?: number;
  // When false, the KL (Kokoro Local) mini pill is omitted from the AUDIO
  // READY column so the table mirrors the engine picker in the player.
  enableKokoroLocal: boolean;
}

interface MiniReadinessPillProps {
  label: string;
  ready: number;
  total: number;
}

// Compact per-provider readiness pill shown inside the saved-scripts table.
// Same colour story as the Now Playing readiness bar (clay-tinted on
// partial, green when fully ready, gray otherwise) but smaller so three
// fit comfortably in a single table cell.
function MiniReadinessPill({ label, ready, total }: MiniReadinessPillProps) {
  const fully = ready === total && total > 0;
  const some = ready > 0 && !fully;
  const borderColor = fully
    ? 'var(--ok, #2e7d32)'
    : (some ? 'var(--clay, #C96442)' : 'var(--rule)');
  const textColor = fully
    ? 'var(--ok, #2e7d32)'
    : (some ? 'var(--clay-deep, #b1502d)' : 'var(--ink-4)');
  const bg = fully
    ? 'rgba(46, 125, 50, 0.08)'
    : 'transparent';
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        fontSize: 10,
        background: bg,
        border: '1px solid ' + borderColor,
        borderRadius: 999,
        color: textColor,
        letterSpacing: '.04em',
        fontWeight: fully ? 600 : 500,
        whiteSpace: 'nowrap',
      }}
      title={`${label}: ${ready}/${total} cached`}
    >
      {fully && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 9,
            height: 9,
            borderRadius: 999,
            background: 'var(--ok, #2e7d32)',
            color: '#fff',
            fontSize: 7,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          ✓
        </span>
      )}
      {label} {ready}/{total}
    </span>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ShadowScriptList({
  scripts,
  selectedId,
  onSelect,
  onRename,
  onDelete,
  onUpdate,
  cacheBump,
  enableKokoroLocal,
}: ShadowScriptListProps) {
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const inspecting = inspectingId
    ? scripts.find(s => s.id === inspectingId) ?? null
    : null;
  // Per-script readiness: keyed by script.id. Recomputed whenever the
  // scripts list changes (new script added, deleted, etc.) or cacheBump
  // ticks (player just rendered + cached a line).
  const [readiness, setReadiness] = useState<Record<string, ScriptReadiness>>({});

  useEffect(() => {
    if (scripts.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot reset when the list empties
      setReadiness({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, ScriptReadiness> = {};
      for (const s of scripts) {
        const r = await computeScriptReadiness(s);
        if (cancelled) return;
        next[s.id] = r;
      }
      if (!cancelled) setReadiness(next);
    })();
    return () => { cancelled = true; };
  }, [scripts, cacheBump]);

  function startRename(s: ShadowScript) {
    setEditingId(s.id);
    setDraftTitle(s.title);
  }

  function commitRename() {
    if (editingId && draftTitle.trim()) {
      onRename(editingId, draftTitle.trim());
    }
    setEditingId(null);
    setDraftTitle('');
  }

  if (scripts.length === 0) {
    return (
      <div
        className="card-flat"
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--ink-3)',
          fontSize: 14,
          background: 'var(--card)',
        }}
      >
        No saved scripts yet. Generate one above to get started.
      </div>
    );
  }

  return (
    <div className="card-flat" style={{ padding: 0, background: 'var(--card)', overflow: 'hidden' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 60px 60px minmax(220px, auto) 90px 100px',
          gap: 12,
          padding: '10px 16px',
          fontSize: 11,
          color: 'var(--ink-4)',
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          background: 'var(--paper-2, #f0eada)',
          borderBottom: '1px solid var(--rule)',
        }}
        className="mono"
      >
        <span>Title</span>
        <span>Level</span>
        <span>Lines</span>
        <span>Audio ready</span>
        <span>Created</span>
        <span style={{ textAlign: 'right' }}>Actions</span>
      </div>

      {scripts.map(s => {
        const isSelected = s.id === selectedId;
        const isEditing = editingId === s.id;
        return (
          <div
            key={s.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 60px 60px minmax(220px, auto) 90px 100px',
              gap: 12,
              alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--rule)',
              background: isSelected ? 'var(--paper-2, #f0eada)' : 'transparent',
              cursor: 'pointer',
              fontSize: 13,
            }}
            onClick={() => !isEditing && onSelect(s.id)}
          >
            {isEditing ? (
              <input
                type="text"
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                onClick={e => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') { setEditingId(null); setDraftTitle(''); }
                }}
                className="input-editorial"
                style={{ padding: '4px 8px' }}
                autoFocus
              />
            ) : (
              <span style={{ color: 'var(--ink)', fontWeight: isSelected ? 600 : 500 }}>
                {s.title}
              </span>
            )}
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.level}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.lines.length}</span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {readiness[s.id] ? (
                <>
                  <MiniReadinessPill
                    label="11L"
                    ready={readiness[s.id].elevenlabsApi.ready}
                    total={readiness[s.id].elevenlabsApi.total}
                  />
                  <MiniReadinessPill
                    label="KK"
                    ready={readiness[s.id].kokoroApi.ready}
                    total={readiness[s.id].kokoroApi.total}
                  />
                  {enableKokoroLocal && (
                    <MiniReadinessPill
                      label="KL"
                      ready={readiness[s.id].kokoroLocal.ready}
                      total={readiness[s.id].kokoroLocal.total}
                    />
                  )}
                </>
              ) : (
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>...</span>
              )}
            </span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{formatDate(s.createdAt)}</span>
            <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setInspectingId(s.id); }}
                className="btn btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11 }}
                title="View / update"
                aria-label="View or update script"
              >
                ⓘ
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); startRename(s); }}
                className="btn btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11 }}
                title="Rename"
              >
                ✎
              </button>
              <button
                type="button"
                onClick={async e => {
                  e.stopPropagation();
                  const ok = await confirm({
                    title: 'Delete script',
                    message: `Delete "${s.title}"?`,
                    confirmLabel: 'Delete',
                    variant: 'danger',
                  });
                  if (ok) onDelete(s.id);
                }}
                className="btn btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11, color: 'var(--err, #c62828)' }}
                title="Delete"
              >
                ✕
              </button>
            </span>
          </div>
        );
      })}
      {inspecting && (
        <ShadowScriptInspector
          script={inspecting}
          onClose={() => setInspectingId(null)}
          onSave={onUpdate}
        />
      )}
    </div>
  );
}
