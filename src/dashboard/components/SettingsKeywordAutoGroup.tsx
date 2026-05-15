import { useState } from 'react';
import { runGeminiJob } from '../../common/gemini/router';
import {
  buildKeywordAutoGroupPrompt,
  parseKeywordAutoGroupJson,
} from './keywordSuggestPrompt';

interface Props {
  // The keywords that should be regrouped (typically the contents of the
  // "Uncategorized" group). Empty means nothing to do -- the button is
  // disabled with a hint.
  ungroupedKeywords: string[];
  // Labels of groups the user already curated. The model is asked to prefer
  // these when a keyword fits, so AI-organization extends the existing
  // taxonomy instead of inventing parallel buckets.
  existingLabels: string[];
  // Atomic apply -- the parent merges each suggested group into existing or
  // new groups and removes the moved keywords from "Uncategorized" in one
  // setLocalSettings call. Auto-save persists the change.
  onApply: (plan: { label: string; keywords: string[] }[]) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function SettingsKeywordAutoGroup({
  ungroupedKeywords,
  existingLabels,
  onApply,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const hasKeywords = ungroupedKeywords.length > 0;
  const disabled = loading || !hasKeywords;

  async function handleGroup() {
    if (disabled) return;
    setLoading(true);
    setStatus({ kind: 'idle' });

    try {
      const result = await runGeminiJob({
        prompt: buildKeywordAutoGroupPrompt(ungroupedKeywords, existingLabels),
        mode: 'explain',
      });

      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error });
        return;
      }

      const parsed = parseKeywordAutoGroupJson(result.text, ungroupedKeywords);
      if (!parsed.ok) {
        setStatus({
          kind: 'error',
          message: `Could not parse the model's reply: ${parsed.error}`,
        });
        return;
      }

      const movedCount = parsed.groups.reduce((sum, g) => sum + g.keywords.length, 0);
      if (movedCount === 0) {
        setStatus({
          kind: 'error',
          message: 'The model returned groups but none of the keywords matched your list.',
        });
        return;
      }

      onApply(parsed.groups);
      const groupNoun = parsed.groups.length === 1 ? 'group' : 'groups';
      const kwNoun = movedCount === 1 ? 'keyword' : 'keywords';
      setStatus({
        kind: 'success',
        message: `Organized ${movedCount} ${kwNoun} into ${parsed.groups.length} ${groupNoun}. Saved automatically.`,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  const buttonStyle: React.CSSProperties = {
    padding: '6px 14px',
    fontSize: 13,
    borderRadius: 6,
    border: '1px solid var(--border, #ddd)',
    background: 'var(--bg-secondary, #f5f5f5)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: 'var(--text, #333)',
    opacity: disabled ? 0.6 : 1,
  };

  const buttonLabel = loading
    ? 'Organizing...'
    : hasKeywords
      ? `Auto-group ${ungroupedKeywords.length} keyword${ungroupedKeywords.length === 1 ? '' : 's'}`
      : 'Auto-group (no uncategorized keywords)';

  return (
    <div style={{ marginTop: 16, marginBottom: 16 }}>
      <div
        style={{
          marginBottom: 8,
          fontSize: 12,
          color: 'var(--text-muted, #888)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        AI auto-group
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => void handleGroup()}
          disabled={disabled}
          style={buttonStyle}
          title={hasKeywords
            ? `Cluster the ${ungroupedKeywords.length} uncategorized keywords into topic groups`
            : 'Move keywords into "Uncategorized" first, or add new ones with the input below'}
        >
          {buttonLabel}
        </button>
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color:
            status.kind === 'error'
              ? 'var(--danger, #c0392b)'
              : 'var(--text-muted, #888)',
          minHeight: 14,
        }}
      >
        {status.kind === 'idle'
          ? 'Gemini clusters your "Uncategorized" keywords into topic groups, preferring labels you already have.'
          : status.message}
      </div>
    </div>
  );
}
