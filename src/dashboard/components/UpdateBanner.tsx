import { useCallback, useEffect, useState } from 'react';
import type { UpdateInfo } from '../../common/types';

type State = 'idle' | 'checking' | 'installing' | 'success' | 'error';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    setState('checking');
    setErrorMsg(null);
    const res = await chrome.runtime.sendMessage({ type: 'check_for_update', force: true });
    if (res?.ok) {
      setInfo(res.data);
      setState('idle');
    } else {
      setErrorMsg(res?.error || 'Check failed');
      setState('error');
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'get_update_info' });
    if (res?.ok) setInfo(res.data ?? null);
    if (!res?.data || Date.now() - res.data.checkedAt > SIX_HOURS_MS) {
      void check();
    }
  }, [check]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot async load via chrome.runtime; no Suspense bridge available
    void refresh();
  }, [refresh]);

  async function install() {
    setState('installing');
    setErrorMsg(null);
    const res = await chrome.runtime.sendMessage({ type: 'install_update' });
    if (res?.ok) {
      setState('success');
    } else {
      setErrorMsg(res?.error || 'Install failed');
      setState('error');
    }
  }

  if (dismissed) return null;
  if (!info?.updateAvailable && state !== 'success' && state !== 'error') return null;

  const bg = state === 'error' ? '#FBE9E2' : state === 'success' ? '#E8F0E5' : '#FBF1E2';
  const border = state === 'error' ? '#C96442' : state === 'success' ? '#5A7A4A' : '#C96442';

  return (
    <div
      style={{
        background: bg,
        borderBottom: `1px solid ${border}`,
        padding: '10px 24px',
        fontFamily: "'Inter', system-ui, sans-serif",
        fontSize: 13,
        color: 'var(--ink, #2A2620)',
      }}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between" style={{ gap: 16 }}>
        <div style={{ flex: 1 }}>
          {state === 'success' && (
            <span>Update installed. Reloading extension...</span>
          )}
          {state === 'error' && errorMsg && (
            <span><strong>Update error:</strong> {errorMsg}</span>
          )}
          {state !== 'success' && state !== 'error' && info?.updateAvailable && (
            <span>
              <strong>v{info.latestVersion}</strong> available
              {info.currentVersion ? ` (you have v${info.currentVersion})` : ''}.{' '}
              {info.releaseUrl && (
                <a href={info.releaseUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--clay, #C96442)', textDecoration: 'underline' }}>
                  Release notes
                </a>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          {state !== 'success' && info?.updateAvailable && info.downloadUrl && (
            <button
              type="button"
              onClick={install}
              disabled={state === 'installing' || state === 'checking'}
              className="btn btn-clay"
              style={{ padding: '6px 14px', fontSize: 12 }}
            >
              {state === 'installing' ? 'Installing...' : 'Update now'}
            </button>
          )}
          {state === 'error' && (
            <button
              type="button"
              onClick={check}
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="btn btn-ghost"
            style={{ padding: '6px 10px', fontSize: 12 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
