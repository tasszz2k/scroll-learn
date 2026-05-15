# Keyword Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide posts on Facebook, Instagram, and YouTube that contain user-defined keywords, with per-keyword hit counts in Settings and Stats.

**Architecture:** Keywords and hit counts live in `Settings` (merged via existing `set_settings` infrastructure). Content script buffers hits and flushes via a new `increment_keyword_hits` message. Settings UI adds a tag input with preset topic groups for quick onboarding; Stats UI adds an all-time breakdown table.

**Tech Stack:** TypeScript strict, React 19, Chrome Extensions MV3, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/common/types.ts` | Add 3 fields to `Settings` + defaults + `IncrementKeywordHitsMessage` |
| `src/content/blocker.ts` | Add `matchedKeyword`, pending-hits buffer, `flushKeywordHits`, integrate into `scanElement` + periodic tick |
| `src/background/index.ts` | Handle `increment_keyword_hits` case |
| `src/dashboard/components/Settings.tsx` | New keyword filters section with tag input + preset topic groups |
| `src/dashboard/App.tsx` | Pass `settings` prop to `<Stats>` |
| `src/dashboard/components/Stats.tsx` | Accept `settings` prop + new keyword blocks section |
| `tests/keywordFilter.test.ts` | Unit tests for `matchedKeyword` (TDD) |

---

## Task 1: Extend Settings types

**Files:**
- Modify: `src/common/types.ts`

- [ ] **Step 1: Add fields to Settings interface**

In `src/common/types.ts`, after line `hideInstagramStrangers: boolean;` (currently line 75), add:

```typescript
  hideByKeyword: boolean;
  blockedKeywords: string[];
  keywordHits: Record<string, number>;
```

- [ ] **Step 2: Add defaults**

In `DEFAULT_SETTINGS` (currently after `hideInstagramStrangers: true,`), add:

```typescript
  hideByKeyword: true,
  blockedKeywords: [],
  keywordHits: {},
```

- [ ] **Step 3: Add IncrementKeywordHitsMessage**

After the `SetSettingsMessage` interface (around line 308), add:

```typescript
export interface IncrementKeywordHitsMessage {
  type: 'increment_keyword_hits';
  hits: Record<string, number>;
}
```

- [ ] **Step 4: Add to Message union**

In the `Message` union (currently ending at `| RecordPronCheckMessage;`), add:

```typescript
  | IncrementKeywordHitsMessage
```

- [ ] **Step 5: Build to verify no type errors**

Run: `npm run build 2>&1 | tail -5`
Expected: `built in` with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/common/types.ts
git commit -m "feat(types): add keyword filtering fields to Settings"
```

---

## Task 2: Write tests for matchedKeyword (TDD)

**Files:**
- Create: `tests/keywordFilter.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect } from 'vitest';

// matchedKeyword will be exported from blocker.ts in Task 3.
// Import it here; the test will fail until Task 3 implements it.
import { matchedKeyword } from '../src/content/blocker';

describe('matchedKeyword', () => {
  it('returns null when keyword list is empty', () => {
    expect(matchedKeyword('Iran war started today', [])).toBeNull();
  });

  it('returns null when no keyword matches', () => {
    expect(matchedKeyword('friendly post about cats', ['iran war', 'crypto'])).toBeNull();
  });

  it('matches a single-word keyword case-insensitively', () => {
    expect(matchedKeyword('Crypto is rising', ['crypto'])).toBe('crypto');
  });

  it('does NOT match a substring inside a longer word', () => {
    // "iran" should not match "Iranian"
    expect(matchedKeyword('The Iranian president spoke', ['iran'])).toBeNull();
  });

  it('matches a whole word at the start of text', () => {
    expect(matchedKeyword('bitcoin hits all-time high', ['bitcoin'])).toBe('bitcoin');
  });

  it('matches a whole word surrounded by punctuation', () => {
    expect(matchedKeyword('Today, war, and peace.', ['war'])).toBe('war');
  });

  it('matches a multi-word phrase whole-word on outer edges', () => {
    expect(matchedKeyword('Breaking: Iran war escalates', ['iran war'])).toBe('iran war');
  });

  it('does NOT match a multi-word phrase inside a longer word boundary', () => {
    // "iran war" should not match if "iran" is part of "anti-iran"
    // Actually \b before "iran" WILL match after "-" (non-word char).
    // This test verifies the outer-edge boundary only.
    expect(matchedKeyword('No keywords here at all', ['iran war'])).toBeNull();
  });

  it('returns the first matching keyword when multiple could match', () => {
    const result = matchedKeyword('bitcoin and crypto news', ['crypto', 'bitcoin']);
    // Either 'crypto' or 'bitcoin' depending on order; first keyword in list wins
    expect(result).toBe('crypto');
  });

  it('escapes regex special characters in keywords', () => {
    // "$money" has a special regex char
    expect(matchedKeyword('I love $money talks', ['$money'])).toBe('$money');
  });

  it('handles keyword with mixed case stored form', () => {
    expect(matchedKeyword('Iran War 2024', ['Iran War'])).toBe('Iran War');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails (import error)**

Run: `npx vitest run tests/keywordFilter.test.ts 2>&1 | tail -10`
Expected: FAIL — `matchedKeyword` not exported from `blocker.ts` yet.

---

## Task 3: Implement keyword matching in blocker

**Files:**
- Modify: `src/content/blocker.ts`

- [ ] **Step 1: Add matchedKeyword export and hit buffer after the existing module-level vars**

After `let periodicScanTimer` declaration at the top of the file, add:

```typescript
let pendingKeywordHits: Record<string, number> = {};

export function matchedKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(lower)) return kw;
  }
  return null;
}

function bufferKeywordHit(keyword: string) {
  pendingKeywordHits[keyword] = (pendingKeywordHits[keyword] ?? 0) + 1;
}

function flushKeywordHits() {
  if (Object.keys(pendingKeywordHits).length === 0) return;
  const hits = { ...pendingKeywordHits };
  pendingKeywordHits = {};
  chrome.runtime.sendMessage({ type: 'increment_keyword_hits', hits }).catch(() => {});
}
```

- [ ] **Step 2: Add keyword scanning block inside scanElement**

Inside `scanElement`, after the `--- Instagram Strangers ---` block (around line 845), add:

```typescript
  // --- Keyword Filters (all platforms) ---
  if (settings.hideByKeyword && settings.blockedKeywords.length > 0) {
    const keywords = settings.blockedKeywords;

    if (isFacebook) {
      const articles = el.tagName === 'ARTICLE' || el.getAttribute('role') === 'article'
        ? [el]
        : Array.from(el.querySelectorAll('[role="article"]'));
      const parentArticle = el.closest('[role="article"]');
      if (parentArticle && !articles.includes(parentArticle)) articles.push(parentArticle);
      for (const article of articles) {
        if (article.classList.contains(HIDDEN_CLASS)) continue;
        const text = stripInvisible(article.textContent || '');
        const kw = matchedKeyword(text, keywords);
        if (kw) { hideElement(article, 'other'); bufferKeywordHit(kw); }
      }
    }

    if (isInstagram) {
      const articles = el.tagName === 'ARTICLE'
        ? [el]
        : Array.from(el.querySelectorAll('article'));
      const parentArticle = el.closest('article');
      if (parentArticle && !articles.includes(parentArticle)) articles.push(parentArticle);
      for (const article of articles) {
        if (article.classList.contains(HIDDEN_CLASS)) continue;
        const text = stripInvisible(article.textContent || '');
        const kw = matchedKeyword(text, keywords);
        if (kw) { hideElement(article, 'other'); bufferKeywordHit(kw); }
      }
    }

    if (isYouTube) {
      const ytSel = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer';
      const items = el.matches?.(ytSel) ? [el] : Array.from(el.querySelectorAll(ytSel));
      const parentItem = el.closest?.(ytSel);
      if (parentItem && !items.includes(parentItem)) items.push(parentItem);
      for (const item of items) {
        if (item.classList.contains(HIDDEN_CLASS)) continue;
        const text = stripInvisible(item.textContent || '');
        const kw = matchedKeyword(text, keywords);
        if (kw) { hideElement(item, 'other'); bufferKeywordHit(kw); }
      }
    }
  }
```

- [ ] **Step 3: Call flushKeywordHits in the periodic scan tick**

Inside `startPeriodicScan`'s `tick` function, just before `periodicScanTimer = setTimeout(tick, INTERVAL_MS);` at the bottom, add:

```typescript
    flushKeywordHits();
```

Also add a YouTube branch in `startPeriodicScan` so keyword scanning runs on YouTube too. Inside the `tick` function, after the `if (isInstagram)` block, add:

```typescript
    if (isYouTube && currentSettings?.hideByKeyword && currentSettings.blockedKeywords.length > 0) {
      const ytSel = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer';
      const notHidden = `:not(.${HIDDEN_CLASS})`;
      for (const item of document.querySelectorAll(`${ytSel}${notHidden}`)) {
        const text = stripInvisible(item.textContent || '');
        const kw = matchedKeyword(text, currentSettings.blockedKeywords);
        if (kw) { hideElement(item, 'other'); bufferKeywordHit(kw); }
      }
    }
```

Also update `startPeriodicScan` to run on YouTube: change the early-return guard from:

```typescript
  if (!isFacebook && !isInstagram) return;
```

to:

```typescript
  if (!isFacebook && !isInstagram && !isYouTube) return;
```

Also add `const isYouTube = hostname.includes('youtube');` alongside the existing `isFacebook`/`isInstagram` in `startPeriodicScan`'s local vars (they are already in `tick` via closure over the outer `hostname`).

Actually `isYouTube` is not declared in `startPeriodicScan` currently. Add it:

```typescript
  const isYouTube = hostname.includes('youtube');
```

after `const isInstagram = hostname.includes('instagram');` in `startPeriodicScan`.

- [ ] **Step 4: Run tests — should pass now**

Run: `npx vitest run tests/keywordFilter.test.ts 2>&1 | tail -15`
Expected: all 11 tests PASS.

- [ ] **Step 5: Build to verify no type errors**

Run: `npm run build 2>&1 | tail -5`
Expected: `built in` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/content/blocker.ts tests/keywordFilter.test.ts
git commit -m "feat(blocker): add keyword-based post hiding with hit buffering"
```

---

## Task 4: Background handler for increment_keyword_hits

**Files:**
- Modify: `src/background/index.ts`

- [ ] **Step 1: Add the case to the message switch**

Find the `case 'set_settings':` block and add the new case after it:

```typescript
    case 'increment_keyword_hits':
      return handleIncrementKeywordHits(message.hits);
```

- [ ] **Step 2: Add the handler function**

After `handleSetSettings` function (around line 783), add:

```typescript
async function handleIncrementKeywordHits(hits: Record<string, number>): Promise<Response<void>> {
  try {
    const current = await storage.getSettings();
    const merged: Record<string, number> = { ...current.keywordHits };
    for (const [kw, count] of Object.entries(hits)) {
      merged[kw] = (merged[kw] ?? 0) + count;
    }
    await storage.saveSettings({ keywordHits: merged });
    return { ok: true, data: undefined };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
```

- [ ] **Step 3: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: `built in` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/background/index.ts
git commit -m "feat(background): handle increment_keyword_hits message"
```

---

## Task 5: Settings UI — keyword filters section

**Files:**
- Modify: `src/dashboard/components/Settings.tsx`

- [ ] **Step 1: Add local state for the keyword input**

Inside the `Settings` component function, near the other `useState` calls, add:

```typescript
  const [keywordInput, setKeywordInput] = useState('');
```

- [ ] **Step 2: Add helper functions for keyword management**

Inside the component, after the `toggle` and `toggleDomain` helpers, add:

```typescript
  function addKeyword(raw: string) {
    const kw = raw.trim();
    if (!kw) return;
    const lower = kw.toLowerCase();
    if (localSettings.blockedKeywords.some(k => k.toLowerCase() === lower)) return;
    const next = [...localSettings.blockedKeywords, kw];
    update('blockedKeywords', next);
  }

  function removeKeyword(kw: string) {
    const next = localSettings.blockedKeywords.filter(k => k !== kw);
    const hits = { ...localSettings.keywordHits };
    delete hits[kw];
    updateMany({ blockedKeywords: next, keywordHits: hits });
  }

  function addPreset(keywords: string[]) {
    const existing = new Set(localSettings.blockedKeywords.map(k => k.toLowerCase()));
    const toAdd = keywords.filter(k => !existing.has(k.toLowerCase()));
    if (toAdd.length === 0) return;
    update('blockedKeywords', [...localSettings.blockedKeywords, ...toAdd]);
  }
```

Note: `update` sets a single key. For `removeKeyword` we need to update two keys atomically. Add `updateMany` helper alongside `update`:

```typescript
  function updateMany(partial: Partial<SettingsType>) {
    const next = { ...localSettings, ...partial };
    setLocalSettings(next);
    onSaveSettings(partial);
  }
```

- [ ] **Step 3: Add preset topic groups constant**

Near the top of the file (after imports), add:

```typescript
const KEYWORD_PRESETS: { label: string; keywords: string[] }[] = [
  { label: 'War & conflict',  keywords: ['war', 'conflict', 'attack', 'missile', 'bomb', 'military', 'troops'] },
  { label: 'Politics',        keywords: ['election', 'congress', 'senate', 'president', 'democrat', 'republican'] },
  { label: 'Crypto',          keywords: ['bitcoin', 'crypto', 'ethereum', 'nft', 'blockchain', 'defi', 'altcoin'] },
  { label: 'Celebrity',       keywords: ['celebrity', 'gossip', 'drama', 'kardashian', 'paparazzi'] },
  { label: 'Sports scores',   keywords: ['score', 'match result', 'standings', 'league table', 'fixture'] },
];
```

- [ ] **Step 4: Insert the keyword filters section JSX**

After the closing `</section>` of the `{/* === B · SITES & BLOCKING === */}` section and before `{/* === C · QUIZ BEHAVIOUR === */}`, insert:

```tsx
      {/* === C · KEYWORD FILTERS === */}
      <section style={{ marginTop: 48 }}>
        <SectionHead
          num="C"
          label="Keyword filters"
          count={`${localSettings.blockedKeywords.length} KEYWORDS · ${Object.values(localSettings.keywordHits).reduce((a, b) => a + b, 0)} BLOCKED`}
        />
        <div className="card-flat" style={{ padding: '16px 28px' }}>
          <Row label="Hide posts by keyword" hint="Hide any post on Facebook, Instagram, or YouTube whose text contains a matching word or phrase (whole-word, case-insensitive).">
            <ToggleControl on={localSettings.hideByKeyword} onClick={() => toggle('hideByKeyword')} ariaLabel="Hide posts by keyword" />
          </Row>
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted, #888)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick add</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {KEYWORD_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  onClick={() => addPreset(preset.keywords)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 12,
                    borderRadius: 12,
                    border: '1px solid var(--border, #ddd)',
                    background: 'var(--bg-secondary, #f5f5f5)',
                    cursor: 'pointer',
                    color: 'var(--text, #333)',
                  }}
                >
                  + {preset.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    addKeyword(keywordInput);
                    setKeywordInput('');
                  }
                }}
                placeholder="Add keyword, press Enter"
                style={{
                  flex: 1,
                  padding: '6px 12px',
                  fontSize: 13,
                  border: '1px solid var(--border, #ddd)',
                  borderRadius: 6,
                  background: 'var(--bg-input, #fff)',
                  color: 'var(--text, #333)',
                }}
              />
              <button
                onClick={() => { addKeyword(keywordInput); setKeywordInput(''); }}
                style={{
                  padding: '6px 14px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: '1px solid var(--border, #ddd)',
                  background: 'var(--bg-secondary, #f5f5f5)',
                  cursor: 'pointer',
                  color: 'var(--text, #333)',
                }}
              >
                Add
              </button>
            </div>
            {localSettings.blockedKeywords.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted, #888)', padding: '8px 0' }}>
                No keywords yet. Add one above or pick a quick-add group.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {localSettings.blockedKeywords.map(kw => {
                  const hits = localSettings.keywordHits[kw] ?? 0;
                  return (
                    <span
                      key={kw}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        fontSize: 13,
                        borderRadius: 14,
                        background: 'var(--accent-soft, #e8f0fe)',
                        color: 'var(--accent, #1a73e8)',
                        border: '1px solid var(--accent-border, #c5d8fb)',
                      }}
                    >
                      {kw}
                      {hits > 0 && (
                        <span style={{ fontSize: 11, opacity: 0.75 }}>({hits})</span>
                      )}
                      <button
                        onClick={() => removeKeyword(kw)}
                        aria-label={`Remove keyword ${kw}`}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          lineHeight: 1,
                          color: 'inherit',
                          opacity: 0.6,
                          fontSize: 14,
                        }}
                      >
                        x
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
```

- [ ] **Step 5: Update section numbering for C, D, E, F**

Change existing section comments and `SectionHead` num props:
- `{/* === C · QUIZ BEHAVIOUR === */}` → `{/* === D · QUIZ BEHAVIOUR === */}` and `num="C"` → `num="D"`
- `{/* === D · ANSWER MATCHING === */}` → `{/* === E · ANSWER MATCHING === */}` and `num="D"` → `num="E"`
- `{/* === E · THE PIPELINE === */}` → `{/* === F · THE PIPELINE === */}` and `num="E"` → `num="F"`
- `{/* === F · ... === */}` (if any) → bump accordingly

- [ ] **Step 6: Build to verify no type errors**

Run: `npm run build 2>&1 | tail -5`
Expected: `built in` with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/components/Settings.tsx
git commit -m "feat(settings): add keyword filters section with tag input and preset groups"
```

---

## Task 6: Stats UI — keyword blocks section

**Files:**
- Modify: `src/dashboard/App.tsx`
- Modify: `src/dashboard/components/Stats.tsx`

- [ ] **Step 1: Pass settings to Stats in App.tsx**

Find `<Stats` in `App.tsx` (around line 559) and add the `settings` prop:

```tsx
          <Stats
            stats={stats}
            decks={decks}
            cards={cards}
            notes={notes}
            settings={settings}
          />
```

- [ ] **Step 2: Add settings prop to StatsProps interface**

In `Stats.tsx`, update the `StatsProps` interface:

```typescript
interface StatsProps {
  stats: StatsType;
  decks: Deck[];
  cards: Card[];
  notes: Note[];
  settings: import('../../common/types').Settings | null;
}
```

- [ ] **Step 3: Add keyword blocks section at the bottom of Stats**

Find the last `</section>` before the component's closing `</div>` / `</>` return, and append:

```tsx
        {/* Keyword blocks */}
        <section style={{ marginTop: 48 }}>
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted, #888)' }}>
              Keyword blocks
            </span>
          </div>
          {!settings || settings.blockedKeywords.length === 0 ? (
            <div className="card-flat" style={{ padding: '20px 28px', fontSize: 13, color: 'var(--text-muted, #888)' }}>
              No keywords configured — add some in Settings.
            </div>
          ) : (
            <div className="card-flat" style={{ borderRadius: 0 }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 24 }}>Keyword</th>
                    <th style={{ textAlign: 'right', paddingRight: 24 }}>Hidden (all time)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...settings.blockedKeywords]
                    .sort((a, b) => (settings.keywordHits[b] ?? 0) - (settings.keywordHits[a] ?? 0))
                    .map(kw => (
                      <tr key={kw}>
                        <td style={{ paddingLeft: 24 }}>{kw}</td>
                        <td style={{ textAlign: 'right', paddingRight: 24 }}>
                          {numberFmt(settings.keywordHits[kw] ?? 0)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
```

- [ ] **Step 4: Build to verify**

Run: `npm run build 2>&1 | tail -5`
Expected: `built in` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/App.tsx src/dashboard/components/Stats.tsx
git commit -m "feat(stats): add keyword blocks breakdown section"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run all tests**

Run: `npm run test 2>&1 | tail -20`
Expected: all test suites PASS including `keywordFilter`.

- [ ] **Step 2: Final build**

Run: `npm run build 2>&1 | tail -5`
Expected: `built in` with no errors.

- [ ] **Step 3: Push**

```bash
git push
```
