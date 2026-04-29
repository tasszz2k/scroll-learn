import { useMemo, useState } from 'react';
import { speakWordWithIpa } from '../../../../common/speak';
import PhonemeLab from './PhonemeLab';
import {
  CONSONANT_GROUPS,
  PHONEMES,
  VOWEL_GROUPS,
  type Phoneme,
} from './phonemes';
import { useIpaProgress } from './useIpaProgress';

type MasteryState = 'new' | 'practicing' | 'mastered';

interface PhonemeCardProps {
  phoneme: Phoneme;
  exampleIdx: number;
  mastery: MasteryState;
  onOpen: (symbol: string) => void;
  onPlayExample: (symbol: string) => void;
}

const DOT_COLOR: Record<MasteryState, string> = {
  new: 'var(--rule)',
  practicing: 'var(--warn, #f9a825)',
  mastered: 'var(--ok, #2e7d32)',
};

const DOT_TITLE: Record<MasteryState, string> = {
  new: 'Not started',
  practicing: 'Practicing',
  mastered: 'Mastered',
};

function PhonemeCard({ phoneme, exampleIdx, mastery, onOpen, onPlayExample }: PhonemeCardProps) {
  const word = phoneme.exampleWords[exampleIdx % phoneme.exampleWords.length];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(phoneme.symbol)}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onOpen(phoneme.symbol);
        }
      }}
      className="card-flat"
      style={{
        position: 'relative',
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
      title={`${phoneme.description}\n\n${phoneme.mouthHint}\n\nClick to open the lab.`}
    >
      <span
        aria-label={DOT_TITLE[mastery]}
        title={DOT_TITLE[mastery]}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: DOT_COLOR[mastery],
          border: mastery === 'new' ? '1px solid var(--ink-4)' : 'none',
        }}
      />
      <div className="serif" style={{ fontSize: 22, lineHeight: 1, color: 'var(--ink)' }}>
        /{phoneme.symbol}/
      </div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        {word}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{phoneme.name}</span>
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onPlayExample(phoneme.symbol);
          }}
          aria-label={`Play example word for /${phoneme.symbol}/`}
          className="btn btn-ghost"
          style={{ padding: '0 6px', fontSize: 11, lineHeight: 1.4 }}
        >
          ▶
        </button>
      </div>
    </div>
  );
}

export default function IpaExplorer() {
  const { progress, isMastered } = useIpaProgress();
  // Track per-phoneme example index so successive plays rotate through the
  // example words (cat -> bad -> man -> cat ...).
  const [exampleIdx, setExampleIdx] = useState<Record<string, number>>({});
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);

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

  function masteryFor(symbol: string): MasteryState {
    if (isMastered(symbol)) return 'mastered';
    const e = progress[symbol];
    if (e && e.total + (e.productionTotal ?? 0) > 0) return 'practicing';
    return 'new';
  }

  function playExample(symbol: string) {
    const p = PHONEMES.find((x) => x.symbol === symbol);
    if (!p) return;
    const current = exampleIdx[symbol] ?? 0;
    const word = p.exampleWords[current % p.exampleWords.length];
    // Advance the visible word only after the utterance finishes so the card
    // shows the word being spoken throughout playback, then flips to the next
    // example for the learner to anticipate.
    speakWordWithIpa(word, {
      onEnd: () => {
        setExampleIdx((prev) => {
          const cur = prev[symbol] ?? current;
          return { ...prev, [symbol]: (cur + 1) % p.exampleWords.length };
        });
      },
    });
  }

  function openLab(symbol: string) {
    setOpenSymbol(symbol);
  }

  const openPhoneme = openSymbol ? PHONEMES.find((p) => p.symbol === openSymbol) ?? null : null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        <section>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Vowels</div>
          {VOWEL_GROUPS.map((g) => (
            <div key={g.id} style={{ marginBottom: 18 }}>
              <div
                className="mono"
                style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.12em', marginBottom: 8 }}
              >
                {g.label.toUpperCase()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {(vowelsByGroup[g.id] || []).map((p) => (
                  <PhonemeCard
                    key={p.symbol}
                    phoneme={p}
                    exampleIdx={exampleIdx[p.symbol] ?? 0}
                    mastery={masteryFor(p.symbol)}
                    onOpen={openLab}
                    onPlayExample={playExample}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Consonants</div>
          {CONSONANT_GROUPS.map((g) => (
            <div key={g.id} style={{ marginBottom: 18 }}>
              <div
                className="mono"
                style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.12em', marginBottom: 8 }}
              >
                {g.label.toUpperCase()}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {(consonantsByGroup[g.id] || []).map((p) => (
                  <PhonemeCard
                    key={p.symbol}
                    phoneme={p}
                    exampleIdx={exampleIdx[p.symbol] ?? 0}
                    mastery={masteryFor(p.symbol)}
                    onOpen={openLab}
                    onPlayExample={playExample}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {openPhoneme && (
        <PhonemeLab phoneme={openPhoneme} onClose={() => setOpenSymbol(null)} />
      )}
    </div>
  );
}
