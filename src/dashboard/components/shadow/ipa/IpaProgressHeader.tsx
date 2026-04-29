import { useConfirm } from '../../../hooks/useConfirm';
import { useIpaProgress } from './useIpaProgress';

export default function IpaProgressHeader() {
  const confirm = useConfirm();
  const { mastered, streakDays, todayAttempts, totalAnswers, resetProgress } = useIpaProgress();

  async function handleReset() {
    const ok = await confirm({
      title: 'Reset IPA progress',
      message:
        'This clears all listening drill stats, production stats, mastery badges, and your practice streak. Saved scripts and notes are not affected.',
      confirmLabel: 'Reset progress',
      variant: 'danger',
    });
    if (!ok) return;
    resetProgress();
  }

  return (
    <div
      className="card-flat"
      style={{
        padding: '14px 18px',
        marginBottom: 22,
        background: 'var(--card)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        flexWrap: 'wrap',
      }}
    >
      <Stat
        label="MASTERED"
        value={`${mastered.count} / ${mastered.total}`}
        accent={mastered.count > 0 ? 'var(--ok, #2e7d32)' : undefined}
      />
      <Stat
        label="STREAK"
        value={streakDays > 0 ? `${streakDays} ${streakDays === 1 ? 'day' : 'days'}` : '0 days'}
        accent={streakDays >= 3 ? 'var(--clay-deep, #b1502d)' : undefined}
      />
      <Stat
        label="TODAY"
        value={`${todayAttempts} ${todayAttempts === 1 ? 'sound' : 'sounds'}`}
      />
      <span style={{ flex: 1 }} />
      {totalAnswers > 0 && (
        <button
          type="button"
          onClick={handleReset}
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '4px 10px', color: 'var(--ink-3)' }}
        >
          Reset progress
        </button>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  accent?: string;
}

function Stat({ label, value, accent }: StatProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 90 }}>
      <span
        className="mono"
        style={{ fontSize: 10, letterSpacing: '.14em', color: 'var(--ink-4)' }}
      >
        {label}
      </span>
      <span
        className="serif"
        style={{ fontSize: 20, lineHeight: 1.2, color: accent ?? 'var(--ink)' }}
      >
        {value}
      </span>
    </div>
  );
}
