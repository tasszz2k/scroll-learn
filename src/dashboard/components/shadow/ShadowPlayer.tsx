import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getEnglishVoices,
  pickVoicesForSpeakers,
  stopSpeaking,
  type SpeakerVoiceAssignment,
  type SpeakLineHandle,
} from '../../../common/speak';
import { getTTSProvider } from '../../../common/tts';
import { deleteCached, getCached } from '../../../common/tts/audioCache';
import {
  fetchAvailableVoices as fetchElevenLabsApiVoices,
  getRemainingCredits as getElevenLabsRemainingCredits,
} from '../../../common/tts/elevenlabsApi';
import {
  KOKORO_VOICES,
  assignKokoroVoicesForCast,
  type KokoroVoice,
} from '../../../common/tts/kokoroVoices';
import type { ShadowScript, TTSJobStage, TTSProviderId } from '../../../common/types';
import { SHADOW_STAGES, type ShadowStageId, getStage } from './stages';
import { useConfirm } from '../../hooks/useConfirm';
import Select, { type SelectOption } from '../Select';

const PROVIDER_KEY = 'scroll-learn:shadow-tts-provider';
// Per-script Kokoro voice assignment is persisted so the same script keeps
// the same cast across reloads (and therefore hits the audio cache instead of
// re-rendering each line). Reroll deletes this key.
const KOKORO_VOICES_KEY_PREFIX = 'scroll-learn:kokoro-voices:';
// Global per-speaker voice pins -- keyed by providerId, mapping speakerId
// (e.g., 'A', 'B') to a provider-native voice id. When set, these override
// the auto-assignment logic so speaker A is the same voice across every
// script the learner generates. The UI exposes a Voices panel that writes
// to these keys and "Reset" wipes the per-provider entry.
const SPEAKER_VOICE_PIN_PREFIX = 'scroll-learn:speaker-voice:';

function loadSpeakerVoicePins(providerId: TTSProviderId): Record<string, string> {
  try {
    const raw = localStorage.getItem(SPEAKER_VOICE_PIN_PREFIX + providerId);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch { return {}; }
}

function saveSpeakerVoicePins(providerId: TTSProviderId, map: Record<string, string>): void {
  try {
    localStorage.setItem(SPEAKER_VOICE_PIN_PREFIX + providerId, JSON.stringify(map));
  } catch { /* ignore */ }
}

// A provider-agnostic descriptor used by the voice picker. Each TTS provider
// knows how to populate this from its own native voice shape.
interface VoiceOption {
  id: string;
  name: string;
  meta?: string;
  gender?: 'female' | 'male' | 'neutral' | 'unknown';
}

function loadProviderId(): TTSProviderId {
  try {
    const v = localStorage.getItem(PROVIDER_KEY);
    if (
      v === 'web-speech'
      || v === 'elevenlabs-api'
      || v === 'kokoro-api'
      || v === 'kokoro-local'
    ) return v;
  } catch { /* ignore */ }
  return 'web-speech';
}

function loadKokoroVoiceMap(scriptId: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(KOKORO_VOICES_KEY_PREFIX + scriptId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return null;
  } catch { return null; }
}

function saveKokoroVoiceMap(scriptId: string, map: Record<string, string>): void {
  try { localStorage.setItem(KOKORO_VOICES_KEY_PREFIX + scriptId, JSON.stringify(map)); }
  catch { /* ignore */ }
}

function clearKokoroVoiceMap(scriptId: string): void {
  try { localStorage.removeItem(KOKORO_VOICES_KEY_PREFIX + scriptId); }
  catch { /* ignore */ }
}

// Group voice options by gender so the picker reads as Female / Male sections
// instead of an undifferentiated list. Within a gender, options keep their
// catalog order (which is region-grouped already for Kokoro). The empty
// "Auto" entry stays at the top.
function buildGroupedVoiceOptions(voices: VoiceOption[]): SelectOption[] {
  const female: VoiceOption[] = [];
  const male: VoiceOption[] = [];
  const other: VoiceOption[] = [];
  for (const v of voices) {
    if (v.gender === 'female') female.push(v);
    else if (v.gender === 'male') male.push(v);
    else other.push(v);
  }
  const out: SelectOption[] = [
    { value: '', label: 'Auto', hint: 'Per-script auto-assignment' },
  ];
  function pushSection(header: string, list: VoiceOption[]) {
    if (list.length === 0) return;
    // Disabled separator row -- the existing Select skips disabled values on
    // commit, so this acts purely as a visual divider.
    out.push({
      value: `__sep_${header}`,
      label: header,
      disabled: true,
    });
    for (const v of list) {
      out.push({ value: v.id, label: v.name, hint: v.meta });
    }
  }
  pushSection('FEMALE', female);
  pushSection('MALE', male);
  pushSection('OTHER', other);
  return out;
}

interface ReadinessPillProps {
  label: string;
  ready: number | null;
  total: number;
  active: boolean;
  onClick: () => void;
}

function ReadinessPill({ label, ready, total, active, onClick }: ReadinessPillProps) {
  const pct = ready != null && total > 0 ? Math.round((ready / total) * 100) : 0;
  const fullyReady = ready != null && ready === total && total > 0;

  // Active is the dominant signal -- the user always needs to know which
  // engine is rendering audio, even if multiple are fully cached. Readiness
  // is preserved via the green ✓ icon (and a subtle green tint on inactive
  // ready pills), but the clay border + filled background only appear on
  // the active pill so it's unambiguous which engine is selected.
  const borderColor = active
    ? 'var(--clay-deep, #b1502d)'
    : (fullyReady ? 'var(--ok, #2e7d32)' : 'var(--rule)');
  const textColor = active
    ? '#fff'
    : (fullyReady ? 'var(--ok, #2e7d32)' : 'var(--ink-3)');
  const bgColor = active
    ? 'var(--clay, #C96442)'
    : (fullyReady ? 'rgba(46, 125, 50, 0.08)' : 'transparent');
  // The progress fill bar lives BEHIND the label and shows cache coverage.
  // On active pills it's a darker tint of the clay so percentages read
  // against the filled background; on inactive ready pills it's the green
  // tint we had before.
  const fillColor = active
    ? 'rgba(0, 0, 0, 0.10)'
    : (fullyReady ? 'rgba(46, 125, 50, 0.18)' : 'rgba(201, 100, 66, 0.10)');

  return (
    <button
      type="button"
      onClick={onClick}
      className="mono"
      title={
        ready == null
          ? `${label}: scanning cache...`
          : active
            ? `${label}: ACTIVE engine. ${ready} of ${total} lines cached.`
            : fullyReady
              ? `${label}: all ${total} lines cached -- ready to play instantly. Click to switch engine.`
              : `${label}: ${ready} of ${total} lines cached (${pct}%). Click to switch engine.`
      }
      style={{
        position: 'relative',
        padding: '2px 10px',
        fontSize: 11,
        background: bgColor,
        border: (active ? '1.5px solid ' : '1px solid ') + borderColor,
        borderRadius: 999,
        color: textColor,
        letterSpacing: '.04em',
        cursor: 'pointer',
        overflow: 'hidden',
        fontWeight: active ? 700 : (fullyReady ? 600 : 500),
        // Active pill gets the strongest emphasis: filled clay bg + a soft
        // halo so it pops out when adjacent to ready-but-inactive pills.
        boxShadow: active
          ? '0 0 0 2px rgba(201, 100, 66, 0.25)'
          : (fullyReady ? '0 0 0 2px rgba(46, 125, 50, 0.10)' : 'none'),
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: ready != null ? `${pct}%` : '0%',
          background: fillColor,
          transition: 'width 200ms ease',
          pointerEvents: 'none',
        }}
      />
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {fullyReady && (
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 12,
              height: 12,
              borderRadius: 999,
              // White-on-clay when this is the active engine so the check
              // stays legible against the filled background; green outside
              // a circle when inactive-but-ready.
              background: active ? 'rgba(255, 255, 255, 0.9)' : 'var(--ok, #2e7d32)',
              color: active ? 'var(--clay-deep, #b1502d)' : '#fff',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            ✓
          </span>
        )}
        <span>
          {label.toUpperCase()} {ready == null ? '...' : `${ready}/${total}`}
        </span>
      </span>
    </button>
  );
}

interface SpeakerVoiceRowProps {
  speaker: string;
  pinnedId: string;
  options: SelectOption[];
  onChange: (id: string) => void;
}

function SpeakerVoiceRow({ speaker, pinnedId, options, onChange }: SpeakerVoiceRowProps) {
  return (
    <>
      <span
        className="mono"
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '.08em',
          color: 'var(--clay, #C96442)',
          minWidth: 24,
        }}
      >
        {speaker}
      </span>
      <Select
        value={pinnedId}
        options={options}
        onChange={onChange}
        size="sm"
        width="100%"
        ariaLabel={`Voice for speaker ${speaker}`}
      />
    </>
  );
}

function describeStage(stage: TTSJobStage, queuePos?: number, message?: string): string {
  switch (stage) {
    case 'opening':     return 'Opening browser tab…';
    case 'navigating':  return 'Loading page…';
    case 'configuring': return 'Configuring voice…';
    case 'submitting':  return 'Generating audio…';
    case 'queued':      return queuePos != null ? `Queued · position ${queuePos}` : 'Queued…';
    case 'capturing':   return 'Capturing audio…';
    case 'done':        return message === 'cache hit' ? 'Cache hit' : 'Ready';
    case 'error':       return message ? `Error: ${message}` : 'Error';
    default:            return stage;
  }
}

interface ShadowPlayerProps {
  script: ShadowScript;
  onDrillPhoneme?: (symbol: string) => void;
  // Cache-bump signal lifted from the panel: ShadowPanel owns it and passes
  // it down so the saved-scripts table can re-scan readiness when the
  // player generates a new line. The player both observes (re-scan) and
  // produces (onCacheBump) bumps.
  cacheBump?: number;
  onCacheBump?: () => void;
}

type RepeatMode = 'off' | 'line' | 'all';

// Cached ElevenLabs API voice shape -- mirrors the fields the player needs
// from /v1/voices.
interface ElevenLabsApiVoice {
  id: string;
  name: string;
  gender?: 'male' | 'female' | 'neutral';
  accent?: string;
}

export default function ShadowPlayer({
  script,
  onDrillPhoneme,
  cacheBump: cacheBumpProp,
  onCacheBump,
}: ShadowPlayerProps) {
  const confirm = useConfirm();
  const [stageId, setStageId] = useState<ShadowStageId>('listen');
  const [lineIdx, setLineIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [rate, setRate] = useState<number>(getStage('listen').rate);
  const [voiceMap, setVoiceMap] = useState<Record<string, SpeakerVoiceAssignment>>({});
  const [highlight, setHighlight] = useState<{ charIndex: number; charLength: number } | null>(null);
  const [providerId, setProviderId] = useState<TTSProviderId>(loadProviderId);
  const [providerReady, setProviderReady] = useState<boolean>(true);
  const [activeStatus, setActiveStatus] = useState<{
    stage: TTSJobStage;
    queuePos?: number;
    message?: string;
  } | null>(null);
  const [elevenlabsApiVoices, setElevenlabsApiVoices] = useState<Map<string, ElevenLabsApiVoice>>(new Map());
  const [kokoroApiVoices, setKokoroApiVoices] = useState<Map<string, KokoroVoice>>(new Map());
  const [voicePins, setVoicePins] = useState<Record<string, string>>({});
  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>([]);
  const [voicesPanelOpen, setVoicesPanelOpen] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [readiness, setReadiness] = useState<{
    elevenlabsApi: { ready: number; total: number } | null;
    kokoroApi: { ready: number; total: number } | null;
    kokoroLocal: { ready: number; total: number } | null;
  }>({ elevenlabsApi: null, kokoroApi: null, kokoroLocal: null });
  // Local cacheBump only used when the panel hasn't lifted ownership. When
  // cacheBumpProp is defined, that value drives the readiness scan and we
  // forward bump requests to onCacheBump so the panel-owned counter sees
  // them too.
  const [localCacheBump, setLocalCacheBump] = useState(0);
  const cacheBump = cacheBumpProp ?? localCacheBump;
  const bumpCache = useCallback(() => {
    if (onCacheBump) onCacheBump();
    else setLocalCacheBump(c => c + 1);
  }, [onCacheBump]);
  const [regenAll, setRegenAll] = useState<{ total: number } | null>(null);

  const lineIdxRef = useRef(lineIdx);
  const repeatRef = useRef(repeatMode);
  const playingRef = useRef(playing);
  const stageRef = useRef(stageId);
  const rateRef = useRef(rate);
  const handleRef = useRef<SpeakLineHandle | null>(null);
  const userStoppedRef = useRef(false);
  const playLineAtRef = useRef<(idx: number) => void>(() => {});
  useEffect(() => { lineIdxRef.current = lineIdx; }, [lineIdx]);
  useEffect(() => { repeatRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { stageRef.current = stageId; }, [stageId]);
  useEffect(() => { rateRef.current = rate; }, [rate]);

  const speakers = useMemo(() => {
    const set = new Set<string>();
    script.lines.forEach(l => set.add(l.speaker));
    return Array.from(set);
  }, [script]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const map = await pickVoicesForSpeakers(speakers);
      if (!cancelled) setVoiceMap(map);
    })();
    return () => { cancelled = true; };
  }, [speakers]);

  useEffect(() => {
    try { localStorage.setItem(PROVIDER_KEY, providerId); } catch { /* ignore */ }

    setCreditsRemaining(null);
    setVoicePins(loadSpeakerVoicePins(providerId));
    let cancelled = false;
    void (async () => {
      const ready = await getTTSProvider(providerId).isReady();
      if (!cancelled) setProviderReady(ready);
      // Pre-fetch the credits balance for ElevenLabs API the moment the
      // engine is selected, so the pill renders before the first speak()
      // call rather than after. The fetch is cheap (cached in module state
      // for 5 min) and free (subscription queries don't burn characters).
      if (!cancelled && providerId === 'elevenlabs-api' && ready) {
        const remaining = await getElevenLabsRemainingCredits();
        if (!cancelled && remaining != null) setCreditsRemaining(remaining);
      }
    })();
    return () => { cancelled = true; };
  }, [providerId]);

  // Populate the Voices panel's catalog when the engine changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let list: VoiceOption[] = [];
      if (providerId === 'web-speech') {
        const voices = await getEnglishVoices();
        list = voices.map(v => ({
          id: v.name,
          name: v.name,
          meta: v.lang + (v.default ? ' (default)' : ''),
          gender: 'unknown',
        }));
      } else if (providerId === 'elevenlabs-api') {
        const api = await fetchElevenLabsApiVoices();
        list = api.map(v => {
          const g = v.labels?.gender;
          return {
            id: v.voice_id,
            name: v.name,
            meta: [v.labels?.gender, v.labels?.accent, v.category].filter(Boolean).join(' · '),
            gender: g === 'female' ? 'female' : (g === 'male' ? 'male' : 'unknown'),
          };
        });
      } else if (providerId === 'kokoro-api' || providerId === 'kokoro-local') {
        // kokoro-local runs the same Kokoro-82M voices in-browser via kokoro-js,
        // so the catalog is identical to kokoro-api.
        list = KOKORO_VOICES.map(v => ({
          id: v.id,
          name: v.name,
          meta: `${v.region.toUpperCase()} ${v.gender}`,
          gender: v.gender,
        }));
      }
      if (!cancelled) setAvailableVoices(list);
    })();
    return () => { cancelled = true; };
  }, [providerId]);

  const setVoicePinFor = useCallback((speaker: string, voiceId: string | null) => {
    setVoicePins(prev => {
      const next = { ...prev };
      if (voiceId) next[speaker] = voiceId;
      else delete next[speaker];
      saveSpeakerVoicePins(providerId, next);
      return next;
    });
  }, [providerId]);

  const clearAllVoicePins = useCallback(() => {
    setVoicePins({});
    saveSpeakerVoicePins(providerId, {});
  }, [providerId]);

  // ElevenLabs API voice assignment. Runs ALWAYS (regardless of which engine
  // is active) so the readiness scan can rely on a stable mapping for the
  // elevenlabs-api cache namespace even when the learner is currently on a
  // different engine.
  useEffect(() => {
    let cancelled = false;
    const pins = providerId === 'elevenlabs-api' ? voicePins : loadSpeakerVoicePins('elevenlabs-api');
    void (async () => {
      const apiVoices = await fetchElevenLabsApiVoices();
      if (cancelled) return;
      const map = new Map<string, ElevenLabsApiVoice>();
      if (apiVoices.length === 0) {
        for (const spk of speakers) {
          const pinned = pins[spk];
          if (pinned) {
            map.set(spk, { id: pinned, name: pinned });
          }
        }
        setElevenlabsApiVoices(map);
        return;
      }
      speakers.forEach((spk, idx) => {
        const pinned = pins[spk];
        const apiV = pinned
          ? apiVoices.find(v => v.voice_id === pinned)
          : apiVoices[idx % apiVoices.length];
        if (apiV) {
          const g = apiV.labels?.gender;
          map.set(spk, {
            id: apiV.voice_id,
            name: apiV.name,
            gender: g === 'female' ? 'female' : (g === 'male' ? 'male' : 'neutral'),
            accent: apiV.labels?.accent,
          });
        } else if (pinned) {
          map.set(spk, { id: pinned, name: pinned });
        }
      });
      setElevenlabsApiVoices(map);
    })();
    return () => { cancelled = true; };
  }, [speakers, providerId, voicePins]);

  // Kokoro API voice assignment. Global pins first, then per-script
  // persisted pins, then a fresh random cast for whatever's left.
  function buildKokoroMap(pins: Record<string, string>, persistAuto: boolean): Map<string, KokoroVoice> {
    const map = new Map<string, KokoroVoice>();
    const used = new Set<string>();
    for (const spk of speakers) {
      const pinned = pins[spk];
      if (!pinned) continue;
      const known = KOKORO_VOICES.find(v => v.id === pinned);
      const voice = known ?? { id: pinned, name: pinned, region: 'us' as const, gender: 'female' as const };
      map.set(spk, voice);
      used.add(voice.id);
    }
    const persisted = loadKokoroVoiceMap(script.id) ?? {};
    const stillNeed: string[] = [];
    for (const spk of speakers) {
      if (map.has(spk)) continue;
      const id = persisted[spk];
      if (id) {
        const known = KOKORO_VOICES.find(v => v.id === id);
        const voice = known ?? { id, name: id, region: 'us' as const, gender: 'female' as const };
        map.set(spk, voice);
        used.add(voice.id);
      } else {
        stillNeed.push(spk);
      }
    }
    if (stillNeed.length > 0 && persistAuto) {
      const fresh = assignKokoroVoicesForCast(stillNeed);
      for (const [k, v] of fresh.entries()) {
        if (used.has(v.id)) continue;
        map.set(k, v);
        used.add(v.id);
      }
      const dump: Record<string, string> = {};
      for (const [k, v] of map.entries()) dump[k] = v.id;
      saveKokoroVoiceMap(script.id, dump);
    }
    return map;
  }

  useEffect(() => {
    const pins = providerId === 'kokoro-api' ? voicePins : loadSpeakerVoicePins('kokoro-api');
    const map = buildKokoroMap(pins, providerId === 'kokoro-api');
     
    setKokoroApiVoices(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.id, speakers, providerId, voicePins]);

  function resolveCacheVoice(speaker: string): string | null {
    if (providerId === 'web-speech') return null;
    if (providerId === 'elevenlabs-api') {
      return elevenlabsApiVoices.get(speaker)?.id ?? null;
    }
    if (providerId === 'kokoro-api' || providerId === 'kokoro-local') {
      return kokoroApiVoices.get(speaker)?.id ?? 'af_heart';
    }
    return null;
  }

  async function handleRegenerateLine(idx: number) {
    const line = script.lines[idx];
    if (!line) return;
    const voice = resolveCacheVoice(line.speaker);
    if (!voice) return;
    await deleteCached({ providerId, voice, text: line.text });
    setLineIdx(idx);
    if (playing) {
      userStoppedRef.current = true;
      handleRef.current?.stop();
      handleRef.current = null;
      window.setTimeout(() => playLineAt(idx), 60);
    }
  }

  // Recompute cache readiness for both cloud providers whenever the script,
  // voice assignment, or cache changes.
  useEffect(() => {
    if (!script.lines.length) {

      setReadiness({ elevenlabsApi: null, kokoroApi: null, kokoroLocal: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      let elApiReady = 0;
      if (elevenlabsApiVoices.size > 0) {
        for (const line of script.lines) {
          const voice = elevenlabsApiVoices.get(line.speaker)?.id;
          if (!voice) continue;
          const hit = await getCached({ providerId: 'elevenlabs-api', voice, text: line.text });
          if (cancelled) return;
          if (hit) elApiReady++;
        }
      }
      let kokApiReady = 0;
      let kokLocalReady = 0;
      if (kokoroApiVoices.size > 0) {
        for (const line of script.lines) {
          const voice = kokoroApiVoices.get(line.speaker)?.id;
          if (!voice) continue;
          // kokoro-api and kokoro-local share KOKORO_VOICES, so the same voice
          // map can be checked against both caches in a single pass.
          const [apiHit, localHit] = await Promise.all([
            getCached({ providerId: 'kokoro-api', voice, text: line.text }),
            getCached({ providerId: 'kokoro-local', voice, text: line.text }),
          ]);
          if (cancelled) return;
          if (apiHit) kokApiReady++;
          if (localHit) kokLocalReady++;
        }
      }
      if (cancelled) return;
      setReadiness({
        elevenlabsApi: { ready: elApiReady, total: script.lines.length },
        kokoroApi: { ready: kokApiReady, total: script.lines.length },
        kokoroLocal: { ready: kokLocalReady, total: script.lines.length },
      });
    })();
    return () => { cancelled = true; };
  }, [script.id, script.lines, elevenlabsApiVoices, kokoroApiVoices, cacheBump]);

  async function handleRegenerateAll() {
    if (!getTTSProvider(providerId).cacheable) return;
    if (regenAll) {
      userStoppedRef.current = true;
      handleRef.current?.stop();
      handleRef.current = null;
      setPlaying(false);
      setRegenAll(null);
      return;
    }
    const ok = await confirm({
      title: 'Regenerate audio',
      message: `Regenerate audio for all ${script.lines.length} lines? Cached audio for the current voices will be discarded; the new takes will play one after the other.`,
      confirmLabel: 'Regenerate',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;

    for (const line of script.lines) {
      const voice = resolveCacheVoice(line.speaker);
      if (!voice) continue;
      await deleteCached({ providerId, voice, text: line.text });
    }
    bumpCache();
    setRegenAll({ total: script.lines.length });
    setLineIdx(0);
    setPlaying(true);
    window.setTimeout(() => playLineAt(0), 60);
  }

  function rerollKokoroVoices() {
    clearKokoroVoiceMap(script.id);
    const fresh = assignKokoroVoicesForCast(speakers);
    setKokoroApiVoices(fresh);
    const dump: Record<string, string> = {};
    for (const [k, v] of fresh.entries()) dump[k] = v.id;
    saveKokoroVoiceMap(script.id, dump);
  }

  useEffect(() => {
     
    setLineIdx(0);
    setPlaying(false);
    setHighlight(null);
    userStoppedRef.current = true;
    handleRef.current?.stop();
    handleRef.current = null;
    stopSpeaking();
  }, [script.id]);

  useEffect(() => {
    return () => {
      userStoppedRef.current = true;
      handleRef.current?.stop();
      handleRef.current = null;
      stopSpeaking();
    };
  }, []);

  const playLineAt = useCallback(
    (idx: number) => {
      const line = script.lines[idx];
      if (!line) return;

      const wsAssignment = voiceMap[line.speaker];
      let voiceHint: string | null = null;
      let effectiveRate = rateRef.current;
      let effectivePitch = 1;
      if (providerId === 'web-speech') {
        voiceHint = wsAssignment?.voice?.name ?? null;
        effectiveRate = rateRef.current * (wsAssignment?.rate ?? 1);
        effectivePitch = wsAssignment?.pitch ?? 1;
      } else if (providerId === 'elevenlabs-api') {
        voiceHint = elevenlabsApiVoices.get(line.speaker)?.id ?? null;
      } else if (providerId === 'kokoro-api' || providerId === 'kokoro-local') {
        // kokoro-local takes the same voice ids as kokoro-api (kokoro-js
        // ships the same KOKORO_VOICES catalog), so the assignment map
        // populated for kokoro-api carries over directly.
        voiceHint = kokoroApiVoices.get(line.speaker)?.id ?? 'af_heart';
      }

      userStoppedRef.current = false;
      setHighlight(null);
      setActiveStatus(null);

      handleRef.current?.stop();

      const provider = getTTSProvider(providerId);
      handleRef.current = provider.speak({
        text: line.text,
        voiceHint,
        rate: effectiveRate,
        pitch: effectivePitch,
        onBoundary: (charIndex, charLength) => {
          setHighlight({ charIndex, charLength });
        },
        onCreditsRemaining: (n) => setCreditsRemaining(n),
        onStatus: (stage, detail) => {
          setActiveStatus({
            stage,
            queuePos: detail?.queuePosition,
            message: detail?.message,
          });
        },
        onEnd: () => {
          if (userStoppedRef.current) return;
          setActiveStatus(null);
          if (provider.cacheable) bumpCache();
          const repeat = repeatRef.current;
          if (repeat === 'line') {
            window.setTimeout(() => playLineAtRef.current(lineIdxRef.current), 200);
            return;
          }
          const next = lineIdxRef.current + 1;
          if (next < script.lines.length) {
            setLineIdx(next);
            window.setTimeout(() => playLineAtRef.current(next), 150);
            return;
          }
          if (repeat === 'all') {
            setLineIdx(0);
            window.setTimeout(() => playLineAtRef.current(0), 300);
            return;
          }
          setPlaying(false);
          setHighlight(null);
          setRegenAll(null);
        },
        onError: (err) => {
          setActiveStatus({ stage: 'error', message: err.message });
        },
      });
    },
    [script, voiceMap, providerId, elevenlabsApiVoices, kokoroApiVoices, bumpCache],
  );

  useEffect(() => { playLineAtRef.current = playLineAt; }, [playLineAt]);

  function handlePlayPause() {
    if (playing) {
      userStoppedRef.current = true;
      handleRef.current?.stop();
      handleRef.current = null;
      stopSpeaking();
      setPlaying(false);
      setRegenAll(null);
      return;
    }
    setPlaying(true);
    playLineAt(lineIdxRef.current);
  }

  function handleLineClick(idx: number) {
    setLineIdx(idx);
    if (playing) {
      userStoppedRef.current = true;
      handleRef.current?.stop();
      handleRef.current = null;
      window.setTimeout(() => playLineAt(idx), 50);
    }
  }

  function handleStageChange(id: ShadowStageId) {
    const stage = getStage(id);
    setStageId(id);
    setRate(stage.rate);
    if (playing) {
      userStoppedRef.current = true;
      handleRef.current?.stop();
      handleRef.current = null;
      window.setTimeout(() => playLineAt(lineIdxRef.current), 60);
    }
  }

  function handleRateChange(value: number) {
    setRate(value);
    if (playing) {
      userStoppedRef.current = true;
      handleRef.current?.stop();
      handleRef.current = null;
      window.setTimeout(() => playLineAt(lineIdxRef.current), 60);
    }
  }

  function cycleRepeat() {
    setRepeatMode(prev => (prev === 'off' ? 'line' : prev === 'line' ? 'all' : 'off'));
  }

  const stage = getStage(stageId);
  const showText = stage.showText;
  const voiceSelectOptions = buildGroupedVoiceOptions(availableVoices);

  return (
    <div className="card-flat" style={{ padding: 24, background: 'var(--card)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Now playing</div>
          <h3 className="serif" style={{ fontSize: 22, fontWeight: 600, margin: 0, color: 'var(--ink)' }}>
            {script.title}
          </h3>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {script.level} · {script.speakerCount} speaker{script.speakerCount === 1 ? '' : 's'} · {script.lines.length} lines
        </div>
      </div>

      {!providerReady && providerId !== 'web-speech' && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: 'var(--paper-2, #f0eada)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ marginBottom: 4 }}>
            <strong>{getTTSProvider(providerId).label}</strong> isn't connected yet — your browser's built-in voices are doing the work in the meantime.
          </div>
          <div style={{ color: 'var(--ink-3)' }}>
            {getTTSProvider(providerId).longDescription} Add the missing API key in Settings to switch over.
          </div>
        </div>
      )}
      {providerReady && getTTSProvider(providerId).cacheable && (
        <div
          style={{
            marginBottom: 14,
            fontSize: 11,
            color: 'var(--ink-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span aria-hidden="true">·</span>
          Generated audio is cached locally -- replaying this script won't re-spend credits or hit the server again.
        </div>
      )}

      {(() => {
        const activeCacheable = getTTSProvider(providerId).cacheable;
        const activeReady =
            providerId === 'elevenlabs-api' ? readiness.elevenlabsApi
          : providerId === 'kokoro-api'     ? readiness.kokoroApi
          : providerId === 'kokoro-local'   ? readiness.kokoroLocal
          : null;
        const activeFullyReady = activeReady != null
          && activeReady.total > 0
          && activeReady.ready === activeReady.total;
        const needsGeneration = activeCacheable && !activeFullyReady;
        return (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              marginBottom: 14,
              padding: '10px 12px',
              background: 'var(--paper-2, #f0eada)',
              border: '1px solid var(--rule)',
              borderRadius: 8,
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.12em', flexShrink: 0 }}
            >
              ENGINE · AUDIO READY
            </span>
            <ReadinessPill
              label="ElevenLabs"
              ready={readiness.elevenlabsApi?.ready ?? null}
              total={readiness.elevenlabsApi?.total ?? script.lines.length}
              active={providerId === 'elevenlabs-api'}
              onClick={() => setProviderId('elevenlabs-api')}
            />
            <ReadinessPill
              label="Kokoro"
              ready={readiness.kokoroApi?.ready ?? null}
              total={readiness.kokoroApi?.total ?? script.lines.length}
              active={providerId === 'kokoro-api'}
              onClick={() => setProviderId('kokoro-api')}
            />
            <ReadinessPill
              label="Kokoro Local"
              ready={readiness.kokoroLocal?.ready ?? null}
              total={readiness.kokoroLocal?.total ?? script.lines.length}
              active={providerId === 'kokoro-local'}
              onClick={() => setProviderId('kokoro-local')}
            />
            <button
              type="button"
              onClick={() => setProviderId('web-speech')}
              className="mono"
              style={{
                padding: '2px 10px',
                fontSize: 11,
                // Match the ReadinessPill's active-state treatment: filled
                // clay bg + halo so the selected engine is unambiguous even
                // when other pills are green-checked.
                background: providerId === 'web-speech' ? 'var(--clay, #C96442)' : 'transparent',
                border: '1px solid ' + (providerId === 'web-speech' ? 'var(--clay-deep, #b1502d)' : 'var(--rule)'),
                borderWidth: providerId === 'web-speech' ? 1.5 : 1,
                borderRadius: 999,
                color: providerId === 'web-speech' ? '#fff' : 'var(--ink-3)',
                fontWeight: providerId === 'web-speech' ? 700 : 500,
                letterSpacing: '.04em',
                cursor: 'pointer',
                boxShadow: providerId === 'web-speech' ? '0 0 0 2px rgba(201, 100, 66, 0.25)' : 'none',
              }}
              title="Browser's built-in voices. No caching needed -- audio is generated on the fly every time."
            >
              WEB SPEECH · INSTANT
            </button>
            <button
              type="button"
              onClick={() => setVoicesPanelOpen(o => !o)}
              className="mono"
              style={{
                padding: '2px 10px',
                fontSize: 11,
                background: voicesPanelOpen ? 'var(--card)' : 'transparent',
                border: '1px solid ' + (voicesPanelOpen ? 'var(--clay, #C96442)' : 'var(--rule)'),
                borderRadius: 999,
                color: voicesPanelOpen ? 'var(--clay-deep, #b1502d)' : 'var(--ink-3)',
                letterSpacing: '.04em',
                cursor: 'pointer',
              }}
              title="Pick a specific voice per speaker. Pins persist across every script you generate."
            >
              VOICES {Object.keys(voicePins).length > 0 ? `· ${Object.keys(voicePins).length} PINNED` : ''}
            </button>

            <span style={{ flex: 1, minWidth: 0 }} />

            {activeCacheable && (
              <button
                type="button"
                onClick={handleRegenerateAll}
                className={needsGeneration && !regenAll ? 'btn btn-clay' : 'btn btn-ghost'}
                style={{
                  padding: '4px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  boxShadow: needsGeneration && !regenAll
                    ? '0 0 0 3px rgba(201, 100, 66, 0.18)'
                    : 'none',
                }}
                title={
                  regenAll
                    ? 'Stop the current re-render and keep whatever has already been regenerated.'
                    : needsGeneration
                      ? `Generate audio for ${activeReady ? activeReady.total - activeReady.ready : script.lines.length} missing line${(activeReady && activeReady.total - activeReady.ready === 1) ? '' : 's'}. Replays after this finish hit the cache.`
                      : 'Re-render audio for every line in this script. The current cache for these voices is discarded; replays after this finish hit the freshly-cached takes.'
                }
              >
                {regenAll
                  ? '■ Stop regen'
                  : needsGeneration
                    ? `▶ Generate audio · ${activeReady ? `${activeReady.ready}/${activeReady.total}` : `0/${script.lines.length}`}`
                    : '↻ Regenerate all'}
              </button>
            )}
          </div>
        );
      })()}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 14,
          fontSize: 11,
          color: 'var(--ink-4)',
          lineHeight: 1.5,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            background: providerReady ? 'var(--paper-2, #f0eada)' : 'rgba(201, 100, 66, 0.12)',
            border: '1px solid ' + (providerReady ? 'var(--rule)' : 'var(--clay, #C96442)'),
            color: providerReady ? 'var(--ink-3)' : 'var(--clay-deep, #b1502d)',
            letterSpacing: '.04em',
          }}
        >
          {providerReady
            ? `PLAYING WITH ${getTTSProvider(providerId).label.split(' (')[0].toUpperCase()}`
            : 'PLAYING WITH WEB SPEECH (FALLBACK)'}
        </span>
        {creditsRemaining != null && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 999,
              background: creditsRemaining < 1000 ? 'rgba(201, 100, 66, 0.12)' : 'var(--paper-2, #f0eada)',
              border: '1px solid ' + (creditsRemaining < 1000 ? 'var(--clay, #C96442)' : 'var(--rule)'),
              color: creditsRemaining < 1000 ? 'var(--clay-deep, #b1502d)' : 'var(--ink-3)',
              letterSpacing: '.04em',
            }}
            title="Free monthly credits remaining on this account. ElevenLabs Flash v2.5 bills at ~0.5 credits per character; cached audio costs 0."
          >
            {creditsRemaining.toLocaleString()} CREDITS LEFT
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          {getTTSProvider(providerId).description}
        </span>
      </div>

      {voicesPanelOpen && (
        <div
          style={{
            marginBottom: 14,
            padding: '12px 14px',
            background: 'var(--card)',
            border: '1px solid var(--rule)',
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="mono" style={{ fontSize: 10, color: 'var(--ink-4)', letterSpacing: '.12em' }}>
              VOICE PINS · {getTTSProvider(providerId).label.split(' (')[0].toUpperCase()}
            </span>
            <button
              type="button"
              onClick={clearAllVoicePins}
              className="btn btn-ghost"
              style={{ padding: '2px 10px', fontSize: 11 }}
              disabled={Object.keys(voicePins).length === 0}
              title="Drop every voice pin for this engine and fall back to automatic per-script assignment."
            >
              Reset all
            </button>
          </div>
          {availableVoices.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '6px 0' }}>
              {providerId === 'elevenlabs-api'
                ? 'No voices available on this API key. Open elevenlabs.io/app/voice-library, click "Add" on a voice you want, then reopen this panel.'
                : 'Voice catalog is loading...'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 8, alignItems: 'center' }}>
              {speakers.map((spk) => (
                <SpeakerVoiceRow
                  key={spk}
                  speaker={spk}
                  pinnedId={voicePins[spk] ?? ''}
                  options={voiceSelectOptions}
                  onChange={(id) => setVoicePinFor(spk, id || null)}
                />
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5 }}>
            Voices are grouped by gender for easier scanning. Empty pin = auto-assign per script. Pinned voices apply across every script that has this speaker, so {speakers.join(' / ')} stay consistent.
          </div>
        </div>
      )}

      {regenAll && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            background: 'rgba(201, 100, 66, 0.12)',
            border: '1px solid var(--clay, #C96442)',
            borderRadius: 6,
            fontSize: 12.5,
            color: 'var(--clay-deep, #b1502d)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span className="mono" style={{ fontSize: 11, letterSpacing: '.08em' }}>
            REGENERATING
          </span>
          <span>
            Line {Math.min(lineIdx + 1, regenAll.total)} of {regenAll.total}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={handleRegenerateAll}
            className="btn btn-ghost"
            style={{ padding: '2px 10px', fontSize: 11 }}
          >
            Stop
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {SHADOW_STAGES.map(s => {
          const active = s.id === stageId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleStageChange(s.id)}
              className={active ? 'btn btn-clay' : 'btn btn-ghost'}
              style={{ padding: '6px 12px', fontSize: 12 }}
              title={s.hint}
            >
              {s.label}
              <span className="mono" style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>
                {s.rate.toFixed(1)}×
              </span>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 16, fontStyle: 'italic' }}>
        {stage.hint}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <button type="button" onClick={handlePlayPause} className="btn btn-dark" style={{ padding: '8px 16px', fontSize: 13 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => handleLineClick(Math.max(0, lineIdx - 1))}
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: 12 }}
          disabled={lineIdx === 0}
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => handleLineClick(Math.min(script.lines.length - 1, lineIdx + 1))}
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: 12 }}
          disabled={lineIdx >= script.lines.length - 1}
        >
          Next →
        </button>
        <button
          type="button"
          onClick={cycleRepeat}
          className="btn btn-ghost"
          style={{ padding: '6px 10px', fontSize: 12 }}
          title="Off / Repeat current line / Loop the whole script"
        >
          Repeat: {repeatMode === 'off' ? 'off' : repeatMode === 'line' ? 'line' : 'all'}
        </button>
        {(providerId === 'kokoro-api' || providerId === 'kokoro-local') && (
          <button
            type="button"
            onClick={rerollKokoroVoices}
            className="btn btn-ghost"
            style={{ padding: '6px 10px', fontSize: 12 }}
            title="Pick a new random voice for each speaker. Cached audio for the previous cast is kept; replays of those lines still hit the cache."
          >
            Reroll voices
          </button>
        )}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--ink-3)' }}>
          Rate
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.05}
            value={rate}
            onChange={e => handleRateChange(parseFloat(e.target.value))}
            style={{ width: 120 }}
          />
          <span className="mono" style={{ minWidth: 36, textAlign: 'right' }}>{rate.toFixed(2)}×</span>
        </label>
      </div>

      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {script.lines.map((line, idx) => {
          const isActive = idx === lineIdx;
          const isPast = idx < lineIdx;
          const speakerColor = speakers.indexOf(line.speaker) % 2 === 0 ? 'var(--clay, #C96442)' : 'var(--ink-2)';
          const opacity = isActive ? 1 : isPast ? 0.45 : 0.7;
          return (
            <li
              key={idx}
              style={{
                padding: '14px 16px',
                borderRadius: 8,
                background: isActive ? 'var(--paper-2, #f0eada)' : 'transparent',
                border: '1px solid ' + (isActive ? 'var(--rule)' : 'transparent'),
                marginBottom: 8,
                cursor: 'pointer',
                opacity,
                transition: 'opacity 200ms ease, background 200ms ease',
              }}
              onClick={() => handleLineClick(idx)}
              role="button"
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleLineClick(idx);
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: speakerColor,
                    minWidth: 22,
                    fontWeight: 700,
                    letterSpacing: '.08em',
                    flexShrink: 0,
                  }}
                >
                  {line.speaker}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {isActive && activeStatus && activeStatus.stage !== 'done' && (
                    <span
                      className="mono"
                      style={{
                        display: 'inline-block',
                        marginBottom: 6,
                        padding: '1px 8px',
                        fontSize: 10,
                        background: activeStatus.stage === 'error'
                          ? 'rgba(198, 40, 40, 0.10)'
                          : 'rgba(201, 100, 66, 0.12)',
                        border: '1px solid ' + (activeStatus.stage === 'error' ? 'var(--err, #c62828)' : 'var(--clay, #C96442)'),
                        borderRadius: 999,
                        color: activeStatus.stage === 'error' ? 'var(--err, #c62828)' : 'var(--clay-deep, #b1502d)',
                        letterSpacing: '.04em',
                      }}
                    >
                      {describeStage(activeStatus.stage, activeStatus.queuePos, activeStatus.message)}
                    </span>
                  )}
                  {isActive && activeStatus && activeStatus.stage === 'done' && activeStatus.message === 'cache hit' && (
                    <span
                      className="mono"
                      style={{
                        display: 'inline-block',
                        marginBottom: 6,
                        padding: '1px 8px',
                        fontSize: 10,
                        background: 'rgba(46, 125, 50, 0.10)',
                        border: '1px solid var(--ok, #2e7d32)',
                        borderRadius: 999,
                        color: 'var(--ok, #2e7d32)',
                        letterSpacing: '.04em',
                      }}
                    >
                      CACHE HIT
                    </span>
                  )}
                  <div
                    className="serif"
                    style={{
                      fontSize: 18,
                      lineHeight: 1.4,
                      color: 'var(--ink)',
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    {showText ? (
                      isActive && highlight ? (
                        <>
                          {line.text.slice(0, highlight.charIndex)}
                          <mark
                            style={{
                              background: 'var(--clay-bg, #f9e3d6)',
                              color: 'var(--ink)',
                              padding: '0 2px',
                              borderRadius: 3,
                            }}
                          >
                            {line.text.slice(
                              highlight.charIndex,
                              highlight.charIndex + Math.max(1, highlight.charLength),
                            )}
                          </mark>
                          {line.text.slice(highlight.charIndex + Math.max(1, highlight.charLength))}
                        </>
                      ) : (
                        line.text
                      )
                    ) : (
                      <span style={{ color: 'var(--ink-4)', letterSpacing: 2 }}>
                        {'•'.repeat(Math.min(60, Math.max(8, line.text.length)))}
                      </span>
                    )}
                  </div>

                  {line.glossVi && (
                    <div
                      style={{
                        fontSize: 13,
                        lineHeight: 1.45,
                        color: 'var(--ink-3)',
                        marginTop: 4,
                        fontStyle: 'normal',
                      }}
                    >
                      {line.glossVi}
                    </div>
                  )}

                  {((line.ipaFocus && line.ipaFocus.length > 0) || getTTSProvider(providerId).cacheable) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      {line.ipaFocus && line.ipaFocus.map(sym => (
                        <button
                          key={sym}
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            onDrillPhoneme?.(sym);
                          }}
                          className="mono"
                          title={onDrillPhoneme ? `Drill /${sym}/ in the Foundation tab` : `Focus phoneme: /${sym}/`}
                          style={{
                            padding: '1px 8px',
                            fontSize: 11,
                            background: 'var(--paper-2, #f0eada)',
                            border: '1px solid var(--rule)',
                            borderRadius: 999,
                            color: 'var(--clay-deep, #b1502d)',
                            cursor: onDrillPhoneme ? 'pointer' : 'default',
                          }}
                        >
                          /{sym}/
                        </button>
                      ))}
                      {getTTSProvider(providerId).cacheable && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            void handleRegenerateLine(idx);
                          }}
                          className="mono"
                          title="Drop the cached audio for this line and re-render. Useful if the take sounds wrong or the voice was changed."
                          style={{
                            padding: '1px 8px',
                            fontSize: 11,
                            background: 'transparent',
                            border: '1px solid var(--rule)',
                            borderRadius: 999,
                            color: 'var(--ink-3)',
                            cursor: 'pointer',
                          }}
                        >
                          ↻ Regenerate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
