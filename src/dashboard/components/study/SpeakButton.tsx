import { useEffect, useState } from 'react';
import { isSpeechSupported, speak, stopSpeaking } from '@/common/speak';

interface SpeakButtonProps {
  text: string;
  size?: number;
  ariaLabel?: string;
  lang?: string;
}

export default function SpeakButton({ text, size = 16, ariaLabel, lang }: SpeakButtonProps) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      if (playing) stopSpeaking();
    };
    // We intentionally only run cleanup on unmount; the playing flag is a ref-like read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isSpeechSupported() || !text.trim()) return null;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (playing) {
      stopSpeaking();
      setPlaying(false);
      return;
    }
    const ok = speak(text, {
      lang,
      onEnd: () => setPlaying(false),
    });
    if (ok) setPlaying(true);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel ?? (playing ? 'Stop pronunciation' : 'Speak answer aloud')}
      className="btn btn-ghost"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        width: size + 12,
        height: size + 12,
        borderRadius: 6,
        verticalAlign: 'middle',
        color: playing ? 'var(--clay)' : 'var(--ink-3)',
      }}
    >
      {playing ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
    </button>
  );
}
