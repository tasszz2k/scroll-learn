import { useState } from 'react';
import { runGeminiJob } from '../../common/gemini/router';
import {
  buildKeywordSuggestPrompt,
  parseKeywordSuggestJson,
} from './keywordSuggestPrompt';

interface Props {
  // Live list of keywords already saved. Used to dedup the model's suggestions
  // before they reach the parent so the success message reflects the actual
  // count added.
  existingKeywords: string[];
  // Parent drops these into a topic group named `topic` (creating it on
  // first use, extending it on subsequent calls). The keyword auto-save
  // effect in Settings.tsx then persists the new groups list to
  // chrome.storage automatically -- no Save button click required.
  onAdd: (topic: string, keywords: string[]) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function SettingsKeywordSuggest({ existingKeywords, onAdd }: Props) {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function handleGenerate() {
    const cleaned = topic.trim();
    if (!cleaned || loading) return;

    setLoading(true);
    setStatus({ kind: 'idle' });

    try {
      const result = await runGeminiJob({
        prompt: buildKeywordSuggestPrompt(cleaned),
        mode: 'explain',
      });

      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error });
        return;
      }

      const parsed = parseKeywordSuggestJson(result.text);
      if (!parsed.ok) {
        setStatus({
          kind: 'error',
          message: `Could not parse the model's reply: ${parsed.error}`,
        });
        return;
      }

      const existingLower = new Set(existingKeywords.map(k => k.toLowerCase()));
      const fresh = parsed.keywords.filter(k => !existingLower.has(k.toLowerCase()));

      if (fresh.length === 0) {
        setStatus({
          kind: 'success',
          message: `All ${parsed.keywords.length} suggestions for "${cleaned}" are already in your list.`,
        });
        return;
      }

      onAdd(cleaned, fresh);
      const noun = fresh.length === 1 ? 'keyword' : 'keywords';
      setStatus({
        kind: 'success',
        message: `Added ${fresh.length} ${noun} to the "${cleaned}" group. Saved automatically.`,
      });
      setTopic('');
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: '6px 12px',
    fontSize: 13,
    border: '1px solid var(--border, #ddd)',
    borderRadius: 6,
    background: 'var(--bg-input, #fff)',
    color: 'var(--text, #333)',
    opacity: loading ? 0.6 : 1,
  };

  const buttonStyle: React.CSSProperties = {
    padding: '6px 14px',
    fontSize: 13,
    borderRadius: 6,
    border: '1px solid var(--border, #ddd)',
    background: 'var(--bg-secondary, #f5f5f5)',
    cursor: loading || !topic.trim() ? 'not-allowed' : 'pointer',
    color: 'var(--text, #333)',
    opacity: loading || !topic.trim() ? 0.6 : 1,
  };

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
        AI suggest
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleGenerate();
            }
          }}
          placeholder='Describe a topic to hide (e.g. "crypto drama", "election politics", "celebrity gossip")'
          disabled={loading}
          style={inputStyle}
          aria-label="Topic to hide"
        />
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={loading || !topic.trim()}
          style={buttonStyle}
        >
          {loading ? 'Generating...' : 'Generate'}
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
          ? 'Gemini turns your topic into 8-15 short keywords (English + Vietnamese), deduped against your list, and saves them.'
          : status.message}
      </div>
    </div>
  );
}
