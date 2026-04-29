import { useState } from 'react';

interface PropertiesPanelProps {
  tags: string[];
  onTagsChange: (next: string[]) => void;
  properties: Record<string, string>;
  onPropertiesChange: (next: Record<string, string>) => void;
  folderPath: string;
}

// Obsidian-style "Properties" rows. Title sits above this in NotebookEditor
// because the title doubles as the tab name in the FolderTree.
export default function PropertiesPanel({
  tags,
  onTagsChange,
  properties,
  onPropertiesChange,
  folderPath,
}: PropertiesPanelProps) {
  const [tagDraft, setTagDraft] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  function commitTag() {
    const v = tagDraft.trim().replace(/^#/, '');
    if (!v) return;
    if (tags.includes(v)) {
      setTagDraft('');
      return;
    }
    onTagsChange([...tags, v]);
    setTagDraft('');
  }

  function removeTag(v: string) {
    onTagsChange(tags.filter(t => t !== v));
  }

  function commitNewProperty() {
    const k = newKey.trim();
    if (!k) return;
    const next = { ...properties, [k]: newValue };
    onPropertiesChange(next);
    setNewKey('');
    setNewValue('');
    setShowAdd(false);
  }

  function updateProperty(k: string, v: string) {
    onPropertiesChange({ ...properties, [k]: v });
  }

  function deleteProperty(k: string) {
    const next = { ...properties };
    delete next[k];
    onPropertiesChange(next);
  }

  // Render order: built-in folderPath (read-only), tags, custom rows, +Add.
  return (
    <div
      style={{
        padding: '6px 0 8px',
        borderTop: '1px solid var(--rule)',
        borderBottom: '1px solid var(--rule)',
        background: 'rgba(0,0,0,0.015)',
      }}
    >
      <PropertyRow label="folder">
        <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {folderPath || '/'}
        </span>
      </PropertyRow>

      <PropertyRow label="tags">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {tags.map(t => (
            <span
              key={t}
              style={{
                background: 'var(--clay-wash)',
                color: 'var(--clay-deep)',
                borderRadius: 999,
                padding: '2px 8px',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              #{t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                aria-label={`Remove tag ${t}`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                x
              </button>
            </span>
          ))}
          <input
            type="text"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitTag();
              }
            }}
            onBlur={commitTag}
            placeholder="Add tag..."
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 12,
              minWidth: 80,
            }}
          />
        </div>
      </PropertyRow>

      {Object.entries(properties).map(([k, v]) => (
        <PropertyRow key={k} label={k} onDelete={() => deleteProperty(k)}>
          <input
            type="text"
            value={v}
            onChange={(e) => updateProperty(k, e.target.value)}
            placeholder="value"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 12,
              color: 'var(--ink)',
            }}
          />
        </PropertyRow>
      ))}

      {showAdd ? (
        <PropertyRow label="">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
            <input
              type="text"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="key (e.g. type)"
              style={{
                flex: '0 0 110px',
                border: '1px solid var(--rule)',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 12,
              }}
            />
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitNewProperty();
                }
              }}
              placeholder="value"
              style={{
                flex: 1,
                border: '1px solid var(--rule)',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 12,
              }}
            />
            <button
              type="button"
              className="btn btn-clay"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={commitNewProperty}
            >
              Add
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => {
                setShowAdd(false);
                setNewKey('');
                setNewValue('');
              }}
            >
              Cancel
            </button>
          </div>
        </PropertyRow>
      ) : (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginLeft: 18, marginTop: 4, padding: '2px 8px', fontSize: 11, color: 'var(--ink-3)' }}
          onClick={() => setShowAdd(true)}
        >
          + Add property
        </button>
      )}
    </div>
  );
}

interface PropertyRowProps {
  label: string;
  children: React.ReactNode;
  onDelete?: () => void;
}

function PropertyRow({ label, children, onDelete }: PropertyRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '2px 18px', gap: 10 }}>
      <div
        className="mono"
        style={{
          width: 80,
          fontSize: 11,
          color: 'var(--ink-4)',
          textTransform: 'lowercase',
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Remove ${label}`}
          className="btn btn-ghost"
          style={{ padding: '0 6px', fontSize: 11, color: 'var(--ink-4)' }}
        >
          x
        </button>
      )}
    </div>
  );
}
