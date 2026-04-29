import { useEffect, useState } from 'react';
import { SHADOW_STAGES } from './stages';

const COLLAPSED_KEY = 'scroll-learn:shadow-guide-collapsed';

interface ShadowGuideProps {
  // When set, clicking the "Start with Foundation" callout fires this
  // instead of trying to navigate by hash. The Panel passes a function that
  // switches its inner section to 'foundation'.
  onGoToFoundation?: () => void;
}

export default function ShadowGuide({ onGoToFoundation }: ShadowGuideProps) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  return (
    <section
      className="card-flat"
      style={{
        padding: collapsed ? '14px 18px' : 24,
        marginBottom: 28,
        background: 'var(--card)',
        border: '1px solid var(--rule)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div>
          <div className="eyebrow">How to shadow</div>
          {collapsed && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
              Listen → Slow shadow → Full shadow → Blind shadow.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="btn btn-ghost"
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          {collapsed ? 'Read' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <div style={{ marginTop: 16, color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.6, maxWidth: 760 }}>
          <p style={{ marginTop: 0 }}>
            <strong>Shadowing</strong> is real-time imitation of a native recording. You speak along, about half a second behind the audio, copying the rhythm, stress, and intonation. It is <em>not</em> pause-and-repeat: the goal is to lock onto the prosody of the sentence, not to nail every consonant on the first try.
          </p>

          <div className="eyebrow" style={{ marginTop: 18, marginBottom: 8 }}>The 4-stage loop</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {SHADOW_STAGES.map(stage => (
              <li key={stage.id} style={{ marginBottom: 8 }}>
                <strong>{stage.label}</strong> ({stage.rate.toFixed(1)}×{stage.showText ? '' : ', transcript hidden'}): {stage.hint}
              </li>
            ))}
          </ol>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Do</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>Pick short clips (10-60s) and repeat them many times.</li>
                <li>Prioritise rhythm and stress over individual phonemes.</li>
                <li>Keep moving even when you miss a word.</li>
                <li>Record yourself once per session and listen back.</li>
                <li>Start with the IPA foundation so your ear knows the contrasts.</li>
              </ul>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Don't</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>Pause-and-repeat each line — that's repetition, not shadowing.</li>
                <li>Chase perfect pronunciation on the first pass.</li>
                <li>Pick scripts above your CEFR level.</li>
                <li>Shadow silently in your head. Voice it.</li>
              </ul>
            </div>
          </div>

          <div className="eyebrow" style={{ marginTop: 18, marginBottom: 6 }}>Troubleshooting</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>"I can't keep up"</strong> — drop to the Slow stage; the rate slider snaps to 0.7×.</li>
            <li><strong>"I'm just reading aloud"</strong> — switch to Blind shadow; remove the visual crutch.</li>
            <li><strong>"The voices sound robotic"</strong> — that's the Web Speech engine. Focus on the rhythm, not the timbre.</li>
            <li><strong>"No English voices in the picker"</strong> — install Chrome's en-US voice pack at <code>chrome://settings/languages</code>.</li>
          </ul>

          {onGoToFoundation && (
            <div style={{ marginTop: 18, padding: 12, background: 'var(--paper-2, #f0eada)', border: '1px solid var(--rule)', borderRadius: 6 }}>
              <strong>New here?</strong> Spend ten minutes in the Foundation drill first.
              You can't shadow sounds you can't hear. {' '}
              <button
                type="button"
                onClick={onGoToFoundation}
                className="btn btn-clay"
                style={{ marginLeft: 8, padding: '4px 12px', fontSize: 12 }}
              >
                Start with Foundation →
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
