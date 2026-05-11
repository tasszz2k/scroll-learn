# Keyword Filtering — Design Spec

Date: 2026-05-11
Status: Approved

## Overview

Add a keyword-based post hiding feature to ScrollLearn. Users define a global keyword list; the content blocker hides any post on Facebook, Instagram, or YouTube whose text contains a whole-word match. Per-keyword hit counts are tracked and surfaced in Settings (inline) and Stats (full breakdown).

---

## Data Model

### `Settings` additions (`src/common/types.ts`)

```ts
blockedKeywords: string[]           // ordered list of user-defined keywords
keywordHits: Record<string, number> // all-time hide count per keyword
hideByKeyword: boolean              // global on/off toggle
```

Defaults:
```ts
blockedKeywords: [],
keywordHits: {},
hideByKeyword: true,
```

`keywordHits` keys mirror `blockedKeywords` entries exactly (same casing as stored). Removing a keyword from `blockedKeywords` also removes its key from `keywordHits`.

### New message type (`src/common/types.ts`)

```ts
export interface IncrementKeywordHitsMessage {
  type: 'increment_keyword_hits';
  hits: Record<string, number>; // keyword -> increment amount
}
```

Added to the `Message` discriminated union.

---

## Matching Logic (`src/content/blocker.ts`)

### `matchedKeyword(text: string, keywords: string[]): string | null`

- Returns the first keyword that matches, or `null`.
- Matching: whole-word, case-insensitive.
- Single-word keyword `"iran"` → regex `/\biran\b/i`
- Multi-word keyword `"iran war"` → regex `/\biran war\b/i` (boundary only on outer edges; spaces in the middle are literal).
- Escapes regex special chars in keyword before building regex.
- Scans the post's `textContent` after `stripInvisible()`.

### Scan targets

| Platform | Element |
|---|---|
| Facebook | `[role="article"]` |
| Instagram | `article` |
| YouTube | `ytd-rich-item-renderer`, `ytd-video-renderer`, `ytd-compact-video-renderer` |

### Hit buffering

Content script maintains a module-level `pendingKeywordHits: Record<string, number>` buffer. Each hide increments the buffer. The periodic scan tick calls `flushKeywordHits()` which sends `increment_keyword_hits` if the buffer is non-empty, then clears the buffer.

### Integration in `scanElement`

New guard after existing stranger checks:
```
if (settings.hideByKeyword && settings.blockedKeywords.length > 0) {
  // run matchedKeyword on post text, hide and buffer hit
}
```

Keyword scan runs on all three platforms (Facebook, Instagram, YouTube).

---

## Background Handler (`src/background/index.ts`)

Handle `increment_keyword_hits`:
1. Load current settings from storage.
2. For each `[keyword, increment]` in `message.hits`: add to `settings.keywordHits[keyword]` (initialise to 0 if absent).
3. Save updated settings.
4. Send `{ success: true }` response.

---

## Settings UI (`src/dashboard/components/Settings.tsx`)

New section between "Sites & blocking" and "Quiz behaviour" (becomes section C; existing C, D, E shift to D, E, F).

Section header: `"C"  "Keyword filters"  "<N> KEYWORDS · <total> BLOCKED"`

Content:
- Global on/off `ToggleControl` labelled "Hide posts by keyword".
- Tag input row: `<input placeholder="Add keyword, press Enter" />` + chip list below.
- Each chip: `<keyword> (<hit-count>)` with an X button to remove.
- Adding a keyword trims whitespace and deduplicates (case-insensitive check).
- Removing a keyword deletes both its entry in `blockedKeywords` and its `keywordHits` key.
- Changes save via existing `saveSettings` pattern (debounced or on-change).

---

## Stats UI (`src/dashboard/components/Stats.tsx`)

New section at the bottom of the Stats tab: "Keyword blocks".

Content:
- Table columns: Keyword | Hidden (all time).
- Rows sorted by count descending.
- If `blockedKeywords` is empty: render `"No keywords configured — add some in Settings."`.
- If keywords exist but all counts are 0: show table with 0s (user can see keywords are armed).

---

## Out of Scope

- Per-site keyword lists.
- Daily/time-series keyword hit history.
- Regex or glob patterns (whole-word only).
- Import/export of keyword lists.

---

## File Change Summary

| File | Change |
|---|---|
| `src/common/types.ts` | Add `hideByKeyword`, `blockedKeywords`, `keywordHits` to `Settings`; add `IncrementKeywordHitsMessage` to `Message` union |
| `src/content/blocker.ts` | Add `matchedKeyword`, `pendingKeywordHits`, `flushKeywordHits`; integrate into `scanElement` and periodic tick |
| `src/background/index.ts` | Handle `increment_keyword_hits` message |
| `src/dashboard/components/Settings.tsx` | New keyword filters section (C) |
| `src/dashboard/components/Stats.tsx` | New keyword blocks section |
