// Per-script history of AI pronunciation-check runs. Each script id maps to
// an array of PronCheckRun, ordered oldest-first. Capped at 50 runs per
// script to keep storage bounded; oldest entries drop on overflow.

import type { PronCheckRun } from './types';
import { STORAGE_KEYS } from './types';

const MAX_RUNS_PER_SCRIPT = 50;

type HistoryMap = Record<string, PronCheckRun[]>;

async function readAll(): Promise<HistoryMap> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SHADOW_PRON_HISTORY);
    const raw = result[STORAGE_KEYS.SHADOW_PRON_HISTORY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as HistoryMap;
  } catch {
    return {};
  }
}

async function writeAll(map: HistoryMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SHADOW_PRON_HISTORY]: map });
}

export async function getPronCheckHistory(scriptId: string): Promise<PronCheckRun[]> {
  const map = await readAll();
  const list = map[scriptId];
  return Array.isArray(list) ? list : [];
}

export async function appendPronCheckRun(
  scriptId: string,
  run: PronCheckRun,
): Promise<void> {
  const map = await readAll();
  const existing = Array.isArray(map[scriptId]) ? map[scriptId] : [];
  const next = [...existing, run];
  if (next.length > MAX_RUNS_PER_SCRIPT) {
    next.splice(0, next.length - MAX_RUNS_PER_SCRIPT);
  }
  map[scriptId] = next;
  await writeAll(map);
}

export async function deletePronCheckHistoryFor(scriptId: string): Promise<void> {
  const map = await readAll();
  if (!(scriptId in map)) return;
  delete map[scriptId];
  await writeAll(map);
}

// Flat list of every saved run across every script, sorted oldest-first by
// createdAt so aggregate helpers (top problem words/phonemes) treat the most
// recent global occurrence as the recency tiebreak.
export async function getAllPronCheckHistory(): Promise<PronCheckRun[]> {
  const map = await readAll();
  const out: PronCheckRun[] = [];
  for (const list of Object.values(map)) {
    if (Array.isArray(list)) out.push(...list);
  }
  out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return out;
}
