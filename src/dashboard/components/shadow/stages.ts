// Declarative shadowing stages. Both ShadowPlayer and ShadowGuide read from
// this list so the UI and the docs cannot drift apart.

export interface ShadowStage {
  id: 'listen' | 'slow' | 'full' | 'blind';
  label: string;
  // Default playback rate for this stage. The rate slider is snapped to this
  // value when the learner switches stages.
  rate: number;
  // Whether the transcript is visible on the player. Blind mode hides line
  // text but keeps the highlighted active line so the learner still tracks
  // rhythm.
  showText: boolean;
  // One-line coaching shown above the transcript while this stage is active.
  hint: string;
}

export const SHADOW_STAGES: readonly ShadowStage[] = [
  {
    id: 'listen',
    label: 'Listen',
    rate: 1.0,
    showText: true,
    hint: 'Listen 2-3 times. Track the rhythm and where speakers stress words. Do not speak yet.',
  },
  {
    id: 'slow',
    label: 'Slow shadow',
    rate: 0.7,
    showText: true,
    hint: 'Speak along ~0.5s behind the audio. Match the rhythm and intonation, not just the words. Mumble unfamiliar parts; do not stop.',
  },
  {
    id: 'full',
    label: 'Full shadow',
    rate: 1.0,
    showText: true,
    hint: 'Same exercise at native speed. Stay locked on intonation, not perfection.',
  },
  {
    id: 'blind',
    label: 'Blind shadow',
    rate: 1.0,
    showText: false,
    hint: 'Hide the transcript. Shadow from sound alone. Glance back only when you lose the thread.',
  },
] as const;

export type ShadowStageId = ShadowStage['id'];

export function getStage(id: ShadowStageId): ShadowStage {
  return SHADOW_STAGES.find(s => s.id === id) ?? SHADOW_STAGES[0];
}
