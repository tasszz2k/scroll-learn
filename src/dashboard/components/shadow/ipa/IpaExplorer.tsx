import { useMemo, useState } from 'react';
import { speakWordWithIpa } from '../../../../common/speak';
import {
  CONSONANT_GROUPS,
  PHONEMES,
  VOWEL_GROUPS,
  type Phoneme,
} from './phonemes';

interface PhonemeCardProps {
  phoneme: Phoneme;
  // 0-indexed example word position; second click on the same card cycles to
  // the next example so the learner hears variation in the same phoneme.
  exampleIdx: number;
  onPlay: (symbol: string) => void;
}

function PhonemeCard({ phoneme, exampleIdx, onPlay }: PhonemeCardProps) {
  const word = phoneme.exampleWords[exampleIdx % phoneme.exampleWords.length];
  return (
    <button
      type="button"
      onClick={() => onPlay(phoneme.symbol)}
      className="card-flat"
      style={{
        padding: '12px 12px 10px',
        textAlign: 'left',
        cursor: 'pointer',
        background: 'var(--card)',
        border: '1px solid var(--rule)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 76,
      }}
      title={`${phoneme.description}\n\n${phoneme.mouthHint}`}
    >
      <div className="serif" style={{ fontSize: 22, lineHeight: 1, color: 'var(--ink)' }}>
        /{phoneme.symbol}/
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        {word}
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {phoneme.name}
      </div>
    </button>
  );
}

export default function IpaExplorer() {
  // Track per-phoneme example index so successive clicks rotate through the
  // example words (cat -> bad -> man -> cat ...).
  const [exampleIdx, setExampleIdx] = useState<Record<string, number>>({});

  const vowelsByGroup = useMemo(() => {
    const map: Record<string, Phoneme[]> = {};
    for (const p of PHONEMES) {
      if (p.type !== 'vowel') continue;
      (map[p.group] ||= []).push(p);
    }
    return map;
  }, []);

  const consonantsByGroup = useMemo(() => {
    const map: Record<string, Phoneme[]> = {};
    for (const p of PHONEMES) {
      if (p.type !== 'consonant') continue;
      (map[p.group] ||= []).push(p);
    }
    return map;
  }, []);

  function play(symbol: string) {
    const p = PHONEMES.find(x => x.symbol === symbol);
    if (!p) return;
    const current = exampleIdx[symbol] ?? 0;
    const word = p.exampleWords[current % p.exampleWords.length];
    speakWordWithIpa(word);
    setExampleIdx(prev => ({ ...prev, [symbol]: (current + 1) % p.exampleWords.length }));
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
      <section>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Vowels</div>
        {VOWEL_GROUPS.map(g => (
          <div key={g.id} style={{ marginBottom: 18 }}>
            <div
              className="mono"
              style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.12em', marginBottom: 8 }}
            >
              {g.label.toUpperCase()}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {(vowelsByGroup[g.id] || []).map(p => (
                <PhonemeCard
                  key={p.symbol}
                  phoneme={p}
                  exampleIdx={exampleIdx[p.symbol] ?? 0}
                  onPlay={play}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Consonants</div>
        {CONSONANT_GROUPS.map(g => (
          <div key={g.id} style={{ marginBottom: 18 }}>
            <div
              className="mono"
              style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.12em', marginBottom: 8 }}
            >
              {g.label.toUpperCase()}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {(consonantsByGroup[g.id] || []).map(p => (
                <PhonemeCard
                  key={p.symbol}
                  phoneme={p}
                  exampleIdx={exampleIdx[p.symbol] ?? 0}
                  onPlay={play}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
