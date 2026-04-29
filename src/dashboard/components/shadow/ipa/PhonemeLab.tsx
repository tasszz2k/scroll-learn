import { useCallback, useEffect, useMemo, useState } from 'react';
import { speakWordWithIpa } from '../../../../common/speak';
import IpaDrill from './IpaDrill';
import { getPhonemeVideo } from './phonemeVideos';
import type { Phoneme } from './phonemes';
import PronunciationCheck from './PronunciationCheck';
import { useIpaProgress } from './useIpaProgress';

interface PhonemeLabProps {
  phoneme: Phoneme;
  onClose: () => void;
}

type LabTab = 'watch' | 'listen' | 'speak';

interface MasteryBadge {
  label: string;
  bg: string;
  border: string;
  ink: string;
}

function masteryBadge(state: 'new' | 'practicing' | 'mastered'): MasteryBadge {
  switch (state) {
    case 'mastered':
      return {
        label: 'Mastered',
        bg: 'var(--ok-bg, #e8f5e9)',
        border: 'var(--ok, #2e7d32)',
        ink: 'var(--ok, #2e7d32)',
      };
    case 'practicing':
      return {
        label: 'Practicing',
        bg: 'var(--warn-bg, #fff8e1)',
        border: 'var(--warn, #f9a825)',
        ink: 'var(--warn-deep, #b76d00)',
      };
    case 'new':
      return {
        label: 'New',
        bg: 'var(--paper-2, #f0eada)',
        border: 'var(--rule)',
        ink: 'var(--ink-3)',
      };
  }
}

export default function PhonemeLab({ phoneme, onClose }: PhonemeLabProps) {
  const { progress, recordProduction, recordPracticeToday, isMastered } = useIpaProgress();
  const entry = progress[phoneme.symbol];
  const masteryState: 'new' | 'practicing' | 'mastered' = isMastered(phoneme.symbol)
    ? 'mastered'
    : entry && entry.total + (entry.productionTotal ?? 0) > 0
      ? 'practicing'
      : 'new';
  const badge = masteryBadge(masteryState);

  // Default tab: Watch when a video exists, Listen otherwise. Stays sticky as
  // the user clicks around within the lab. The component is unmounted when
  // the user closes the lab, so the initial state correctly resets per open.
  const video = getPhonemeVideo(phoneme.symbol);
  const [tab, setTab] = useState<LabTab>(video ? 'watch' : 'listen');

  // Opening the lab counts as practice for the streak.
  useEffect(() => {
    recordPracticeToday();
  }, [recordPracticeToday]);

  // Close on Escape so the drawer behaves like a modal.
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleProduction = useCallback(
    (correct: boolean) => {
      recordProduction(phoneme.symbol, correct);
    },
    [phoneme.symbol, recordProduction],
  );

  const listenAccuracyPct = useMemo(() => {
    if (!entry || entry.total === 0) return null;
    return Math.round((entry.correct / entry.total) * 100);
  }, [entry]);

  const speakAccuracyPct = useMemo(() => {
    const total = entry?.productionTotal ?? 0;
    if (total === 0) return null;
    const correct = entry?.productionCorrect ?? 0;
    return Math.round((correct / total) * 100);
  }, [entry]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Practice the ${phoneme.name} sound`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '5vh 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper, #fffaf0)',
          border: '1px solid var(--rule)',
          borderRadius: 10,
          width: 'min(720px, 100%)',
          padding: '20px 22px 24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
              <div className="serif" style={{ fontSize: 36, lineHeight: 1, color: 'var(--ink)' }}>
                /{phoneme.symbol}/
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink-2)' }}>{phoneme.name}</div>
              <span
                className="mono"
                style={{
                  padding: '2px 8px',
                  fontSize: 10,
                  letterSpacing: '.12em',
                  textTransform: 'uppercase',
                  background: badge.bg,
                  border: `1px solid ${badge.border}`,
                  color: badge.ink,
                  borderRadius: 999,
                }}
              >
                {badge.label}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
              {phoneme.description}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
              {phoneme.mouthHint}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            aria-label="Close"
            style={{ fontSize: 18, lineHeight: 1, padding: '4px 10px' }}
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div role="tablist" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--rule)', marginBottom: 16 }}>
          {([
            { id: 'watch' as LabTab, label: 'Watch' },
            { id: 'listen' as LabTab, label: 'Listen' },
            { id: 'speak' as LabTab, label: 'Speak' },
          ]).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className="btn btn-ghost"
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  borderRadius: '6px 6px 0 0',
                  borderBottom: active ? '2px solid var(--clay, #b1502d)' : '2px solid transparent',
                  color: active ? 'var(--clay-deep, #b1502d)' : 'var(--ink-2)',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {t.label}
                {t.id === 'watch' && !video && (
                  <span className="mono" style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-4)' }}>
                    soon
                  </span>
                )}
                {t.id === 'listen' && listenAccuracyPct != null && (
                  <span className="mono" style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-4)' }}>
                    {listenAccuracyPct}%
                  </span>
                )}
                {t.id === 'speak' && speakAccuracyPct != null && (
                  <span className="mono" style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-4)' }}>
                    {speakAccuracyPct}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab body */}
        {tab === 'watch' && (
          <div>
            {video ? (
              <div>
                {/* YouTube embeds in chrome-extension:// pages return
                    Error 153 ("Video player configuration error") regardless
                    of host or referrer policy -- the player rejects the
                    extension origin. The "lite-youtube-embed" pattern
                    sidesteps that by surfacing the canonical thumbnail and
                    handing the click off to a real youtube.com tab, which
                    plays normally. */}
                <a
                  href={`https://www.youtube.com/watch?v=${video.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Watch the mouth-shape video for /${phoneme.symbol}/ on YouTube`}
                  style={{
                    position: 'relative',
                    display: 'block',
                    width: '100%',
                    paddingTop: '56.25%',
                    background: 'var(--paper-2, #f0eada)',
                    borderRadius: 6,
                    overflow: 'hidden',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <img
                    src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block',
                    }}
                  />
                  {/* Play button overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 100%)',
                    }}
                  >
                    <div
                      style={{
                        width: 68,
                        height: 48,
                        borderRadius: 12,
                        background: 'rgba(33,33,33,0.85)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
                      }}
                    >
                      <span
                        style={{
                          width: 0,
                          height: 0,
                          borderTop: '10px solid transparent',
                          borderBottom: '10px solid transparent',
                          borderLeft: '16px solid #fff',
                          marginLeft: 4,
                        }}
                      />
                    </div>
                  </div>
                  {/* Bottom-left badge so the user knows this is a click-through, not a broken embed */}
                  <div
                    className="mono"
                    style={{
                      position: 'absolute',
                      left: 10,
                      bottom: 10,
                      padding: '3px 8px',
                      fontSize: 10,
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                      background: 'rgba(0,0,0,0.6)',
                      color: '#fff',
                      borderRadius: 3,
                    }}
                  >
                    Open on YouTube ↗
                  </div>
                </a>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 8,
                    flexWrap: 'wrap',
                    fontSize: 11,
                    color: 'var(--ink-4)',
                  }}
                >
                  <span>Source: {video.credit}</span>
                  <span style={{ flex: 1 }} />
                  <a
                    href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                      `BBC Learning English ${phoneme.symbol} sound pronunciation ${phoneme.name}`,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 11, textDecoration: 'none', color: 'var(--clay-deep, #b1502d)' }}
                  >
                    Search YouTube for /{phoneme.symbol}/ →
                  </a>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: 16,
                  background: 'var(--card)',
                  border: '1px solid var(--rule)',
                  borderRadius: 6,
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div>
                  No mouth-shape video curated for /{phoneme.symbol}/ yet. The mouth-shape hint above is
                  the quick reference; for a video walkthrough, the BBC Learning English channel covers
                  every phoneme.
                </div>
                <a
                  href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                    `BBC Learning English ${phoneme.symbol} sound pronunciation ${phoneme.name}`,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                  style={{
                    alignSelf: 'flex-start',
                    padding: '6px 12px',
                    fontSize: 12,
                    textDecoration: 'none',
                    color: 'var(--clay-deep, #b1502d)',
                  }}
                >
                  Search YouTube for /{phoneme.symbol}/ →
                </a>
              </div>
            )}
          </div>
        )}

        {tab === 'listen' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Examples</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {phoneme.exampleWords.map((w) => (
                  <div
                    key={w}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 10px',
                      background: 'var(--card)',
                      border: '1px solid var(--rule)',
                      borderRadius: 6,
                    }}
                  >
                    <div className="serif" style={{ fontSize: 18, color: 'var(--ink)', flex: 1 }}>{w}</div>
                    <button
                      type="button"
                      onClick={() => speakWordWithIpa(w)}
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: 12 }}
                    >
                      Play
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Minimal-pair drill</div>
              <IpaDrill focusPhoneme={phoneme.symbol} />
            </div>
          </div>
        )}

        {tab === 'speak' && (
          <PronunciationCheck phoneme={phoneme} onProductionRecorded={handleProduction} />
        )}
      </div>
    </div>
  );
}
