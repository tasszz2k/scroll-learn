/**
 * Content Blocker
 *
 * Hides Reels, Shorts, Sponsored, and Suggested content from social media feeds.
 * Uses two layers:
 *  1. CSS injection for elements with stable selectors (immediate, flicker-free).
 *  2. MutationObserver for text-based detection (Sponsored, Suggested, etc.).
 *
 * Facebook obfuscates "Sponsored" text using aria-label attributes, invisible
 * characters between letters, and nested spans. Detection must account for this.
 */

import type { Settings } from '../common/types';

const STYLE_ID = 'scrolllearn-blocker-styles';
const HIDDEN_CLASS = 'scrolllearn-hidden';

let blockerObserver: MutationObserver | null = null;
let currentSettings: Settings | null = null;
let periodicScanTimer: ReturnType<typeof setTimeout> | null = null;

export type BlockCategory = 'reels' | 'shorts' | 'sponsored' | 'suggested' | 'strangers' | 'other';
export type BlockedCounts = Record<BlockCategory, number>;

const blockedCounts: BlockedCounts = {
  reels: 0, shorts: 0, sponsored: 0, suggested: 0, strangers: 0, other: 0,
};

// ---------------------------------------------------------------------------
// CSS rules for stable selectors
// ---------------------------------------------------------------------------

function buildFacebookReelsCSS(): string {
  return `
    div[data-pagelet*="Reels"],
    div[aria-label="Reels"][role="region"] {
      display: none !important;
    }
    div:has(> div > div[aria-label="Reels"][role="region"]) {
      display: none !important;
    }
    div:has(> div[aria-label="Reels"][role="region"]) {
      display: none !important;
    }
    a[aria-label="Reels"][href*="/reel/"],
    a[href="/reel/"],
    a[href^="/reel/?"] {
      display: none !important;
    }
    :has(> a[aria-label="Reels"][href*="/reel/"]),
    :has(> a[href="/reel/"]),
    :has(> a[href^="/reel/?"]) {
      display: none !important;
    }
  `;
}

function buildInstagramReelsCSS(): string {
  return `
    a[href="/reels/"],
    a[href="/reels/"] ~ * {
      display: none !important;
    }
  `;
}

function buildYouTubeShortsCSS(): string {
  return `
    ytd-reel-shelf-renderer,
    ytd-rich-shelf-renderer[is-shorts] {
      display: none !important;
    }
    ytd-guide-entry-renderer:has(a[href="/shorts"]) {
      display: none !important;
    }
    ytd-mini-guide-entry-renderer:has(a[href="/shorts"]) {
      display: none !important;
    }
  `;
}

function buildHiddenClassCSS(): string {
  return `
    .${HIDDEN_CLASS} {
      display: none !important;
    }
  `;
}

function buildCSS(settings: Settings, hostname: string): string {
  const rules: string[] = [buildHiddenClassCSS()];

  const isFacebook = hostname.includes('facebook');
  const isYouTube = hostname.includes('youtube');
  const isInstagram = hostname.includes('instagram');

  if (settings.hideFacebookReels && isFacebook) {
    rules.push(buildFacebookReelsCSS());
  }

  if (settings.hideInstagramReels && isInstagram) {
    rules.push(buildInstagramReelsCSS());
  }

  if (settings.hideYouTubeShorts && isYouTube) {
    rules.push(buildYouTubeShortsCSS());
  }

  return rules.join('\n');
}

// ---------------------------------------------------------------------------
// Style element management
// ---------------------------------------------------------------------------

function injectOrUpdateStyle(css: string) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = css;
}

function removeStyle() {
  document.getElementById(STYLE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// MutationObserver -- text-based detection
// ---------------------------------------------------------------------------

function getHostname(): string {
  return window.location.hostname.replace(/^(www\.|m\.)/, '');
}

/**
 * Hide an element by adding the hidden class.
 * Returns true if the element was newly hidden.
 */
function hideElement(el: Element | null, category: BlockCategory = 'other'): boolean {
  if (!el || el.classList.contains(HIDDEN_CLASS)) return false;
  el.classList.add(HIDDEN_CLASS);
  blockedCounts[category]++;
  notifyCountChange();
  return true;
}

/**
 * Walk up from `start` to find the closest feed-level container.
 */
function closestFeedUnit(start: Element, hostname: string): Element | null {
  if (hostname.includes('facebook')) {
    return (
      start.closest('[role="article"]') ||
      start.closest('[data-pagelet*="FeedUnit"]')
    );
  }
  if (hostname.includes('instagram')) {
    return start.closest('article');
  }
  return null;
}

/**
 * Search the entire document for elements that indicate "Sponsored" content.
 * Returns the indicator elements themselves (the element closest to the label).
 * Uses the same strategies as isFacebookSponsored but globally.
 */
function findSponsoredIndicators(): Element[] {
  const results: Element[] = [];

  // Strategy A: aria-label on links (case-insensitive check)
  for (const link of document.querySelectorAll('a[aria-label]')) {
    const label = link.getAttribute('aria-label')?.toLowerCase() || '';
    if (label === 'sponsored') {
      results.push(link);
    }
  }

  // Strategy B: aria-labelledby pointing to hidden element with "Sponsored"
  for (const el of document.querySelectorAll('[aria-labelledby]')) {
    if (el.closest(`.${HIDDEN_CLASS}`)) continue;
    if (el.closest('[role="article"]')) continue;
    const labelId = el.getAttribute('aria-labelledby');
    if (labelId) {
      const labelEl = document.getElementById(labelId);
      if (labelEl) {
        const text = stripInvisible(labelEl.textContent || '').trim().toLowerCase();
        if (text === 'sponsored') {
          results.push(el);
        }
      }
    }
  }

  // Strategy C: Flex containers with obfuscated "Sponsored" text
  for (const container of document.querySelectorAll<HTMLElement>('span[style*="display: flex"], span[style*="display:flex"]')) {
    if (container.closest(`.${HIDDEN_CLASS}`)) continue;
    if (container.closest('[role="article"]')) continue;
    const children = container.children;
    if (children.length < 8 || children.length > 80) continue;
    const text = reconstructVisibleText(container);
    if (text.toLowerCase() === 'sponsored') {
      results.push(container);
    }
  }

  // Strategy D: Direct text match on link spans
  for (const el of document.querySelectorAll('a[role="link"] span, a span[dir="auto"]')) {
    if (el.closest(`.${HIDDEN_CLASS}`)) continue;
    if (el.closest('[role="article"]')) continue;
    const cleaned = stripInvisible(el.textContent || '').trim().toLowerCase();
    if (cleaned === 'sponsored') {
      results.push(el);
    }
  }

  return results;
}

/**
 * Walk up from an ad marker element to find its feed-level container.
 * Facebook does not use role="feed" or role="article" on sponsored posts.
 * Strategy: walk up from the marker, tracking the largest ancestor that
 * does NOT contain any [role="article"] (organic post). Once we hit an
 * ancestor that does contain one, the previous element was the sponsored
 * post boundary.
 */
function findAdFeedUnit(marker: Element): Element | null {
  let candidate: Element | null = null;
  let current: Element | null = marker;
  while (current && current !== document.body) {
    if (current.querySelector('[role="article"]')) {
      break;
    }
    candidate = current;
    current = current.parentElement;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Robust text detection for Facebook/Instagram
// ---------------------------------------------------------------------------

/**
 * Strip invisible Unicode characters that Facebook injects to break text
 * matching. Keeps only printable ASCII and common Unicode letters.
 */
function stripInvisible(text: string): string {
  // Remove zero-width chars, soft hyphens, and other invisible code points
  return text.replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD]/g, '');
}

/**
 * Check if an element's visible text or aria-label matches any marker.
 * Uses multiple strategies to defeat obfuscation:
 *  1. Check aria-label attributes (most reliable on Facebook)
 *  2. Check innerText after stripping invisible characters
 *  3. Check textContent after stripping invisible characters
 *  4. Substring matching for longer containers
 */
function elementContainsMarker(el: Element, markers: string[]): boolean {
  // Strategy 1: aria-label on the element itself or its children
  const ariaElements = [el, ...el.querySelectorAll('[aria-label]')];
  for (const node of ariaElements) {
    const label = node.getAttribute('aria-label');
    if (label) {
      const cleaned = stripInvisible(label).trim().toLowerCase();
      for (const marker of markers) {
        if (cleaned === marker.toLowerCase()) return true;
      }
    }
  }

  // Strategy 2: check all links and spans (text content after cleanup)
  const textElements = el.querySelectorAll('span, a, div > span, use');
  for (const child of textElements) {
    const raw = child.textContent || '';
    const cleaned = stripInvisible(raw).trim().toLowerCase();
    if (!cleaned) continue;
    for (const marker of markers) {
      if (cleaned === marker.toLowerCase()) return true;
    }
  }

  // Strategy 3: check the element's own innerText for substring match
  // (handles cases where the marker text is scattered across child nodes)
  try {
    const innerText = stripInvisible((el as HTMLElement).innerText || '')
      .toLowerCase();
    for (const marker of markers) {
      const m = marker.toLowerCase();
      // Only do substring match for short markers at the start of text
      // to avoid false positives on long articles
      if (innerText.startsWith(m) || innerText.includes('\n' + m)) {
        return true;
      }
    }
  } catch {
    // innerText may not be available on non-HTML elements
  }

  return false;
}

/**
 * Facebook-specific: detect "Sponsored" label near the post header.
 *
 * Facebook aggressively obfuscates the "Sponsored" label to evade detection:
 *  - The text is split into individual character <span> elements
 *  - Decoy/junk characters are mixed in and hidden via CSS classes
 *  - Visible characters are CSS-reordered using the flex container's `order`
 *  - textContent therefore returns scrambled garbage, not "Sponsored"
 *
 * Reliable signals (from most to least reliable):
 *  1. data-ad-rendering-role attribute -- only on ad posts
 *  2. aria-labelledby referencing a hidden element with "Sponsored" text
 *  3. Reconstructing visible text from obfuscated character spans via
 *     getBoundingClientRect (zero-size = hidden, left position = visual order)
 *  4. aria-label="Sponsored" on links (older approach, still sometimes works)
 */
function isFacebookSponsored(article: Element): boolean {
  // Strategy 1 (removed): data-ad-rendering-role is NOT exclusive to ads --
  // Facebook uses it on ALL posts in their rendering pipeline.

  // Strategy 2: aria-label on links
  if (article.querySelector('a[aria-label="Sponsored"], a[aria-label="sponsored"]')) {
    return true;
  }

  // Strategy 3: aria-labelledby pointing to a hidden element whose text
  // is the unobfuscated word "Sponsored" (used for screen readers).
  const labelledEls = article.querySelectorAll('[aria-labelledby]');
  for (const el of labelledEls) {
    const labelId = el.getAttribute('aria-labelledby');
    if (labelId) {
      const labelEl = document.getElementById(labelId);
      if (labelEl) {
        const text = stripInvisible(labelEl.textContent || '').trim().toLowerCase();
        if (text === 'sponsored') return true;
      }
    }
  }

  // Strategy 4: Reconstruct visible text from obfuscated character spans.
  // Facebook renders "Sponsored" inside a flex container where each character
  // is a separate <span>. Decoy characters are stacked at a single left
  // coordinate; visible characters have distinct, sequential left positions.
  const flexSpans = article.querySelectorAll<HTMLElement>('span[style*="display: flex"]');
  for (const container of flexSpans) {
    const children = container.children;
    if (children.length < 8 || children.length > 80) continue;
    const text = reconstructVisibleText(container);
    if (text.toLowerCase() === 'sponsored') return true;
  }

  // Strategy 5: Simple text match (non-obfuscated fallback, e.g. mobile web)
  const candidates = article.querySelectorAll('a[role="link"] span, span[dir="auto"]');
  for (const el of candidates) {
    const cleaned = stripInvisible(el.textContent || '').trim().toLowerCase();
    if (cleaned === 'sponsored') return true;
  }

  return false;
}

/**
 * Reconstruct the visually rendered text from a flex container whose children
 * are single-character spans -- some hidden by CSS (zero size) and some
 * reordered via CSS `order` or flex positioning.
 *
 * Facebook stacks all decoy characters at the same left coordinate (a "pile")
 * while visible characters receive distinct, sequential left positions.
 * We detect the pile, extract characters with distinct positions, and recover
 * the first visible character by matching its right edge to the second
 * character's left position.
 */
function reconstructVisibleText(container: HTMLElement): string {
  const children = container.children;
  if (children.length === 0) return '';

  type CharItem = { char: string; left: number; right: number };
  const items: CharItem[] = [];

  for (let i = 0; i < children.length; i++) {
    const span = children[i] as HTMLElement;
    const text = span.textContent || '';
    if (text.length !== 1) continue;

    const rect = span.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    items.push({ char: text, left: rect.left, right: rect.left + rect.width });
  }

  if (items.length === 0) return '';

  // Group by left position (0.5px tolerance) to detect the decoy pile
  const groups = new Map<number, CharItem[]>();
  for (const item of items) {
    let matched = false;
    for (const [key, group] of groups) {
      if (Math.abs(item.left - key) < 0.5) {
        group.push(item);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.set(item.left, [item]);
    }
  }

  // Find the pile (largest group of characters sharing a left position)
  let pileKey = 0;
  let pileSize = 0;
  for (const [key, group] of groups) {
    if (group.length > pileSize) {
      pileSize = group.length;
      pileKey = key;
    }
  }

  // No clear pile -- fall back to sorting all by left (legacy containers
  // where decoys have zero width and were already filtered above)
  if (pileSize < 3) {
    items.sort((a, b) => a.left - b.left);
    return items.map(c => c.char).join('');
  }

  // Separate pile (decoys + first visible char) from distinct (visible 2..N)
  const pile = groups.get(pileKey)!;
  const distinct: CharItem[] = [];
  for (const [key, group] of groups) {
    if (Math.abs(key - pileKey) >= 0.5) {
      distinct.push(...group);
    }
  }

  distinct.sort((a, b) => a.left - b.left);

  if (distinct.length === 0) return '';

  // The first visible character sits in the pile. Identify it by finding the
  // pile character whose right edge is closest to the first distinct character.
  const firstDistinctLeft = distinct[0].left;
  let bestFirst: CharItem | null = null;
  let bestDiff = Infinity;
  for (const item of pile) {
    const diff = Math.abs(item.right - firstDistinctLeft);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestFirst = item;
    }
  }

  const result: string[] = [];
  if (bestFirst && bestDiff < 2) {
    result.push(bestFirst.char);
  }
  for (const item of distinct) {
    result.push(item.char);
  }

  return result.join('');
}

/**
 * Facebook-specific: detect "Suggested for you" label.
 * Uses the same obfuscation-aware strategies as isFacebookSponsored.
 */
function isFacebookSuggested(article: Element): boolean {
  const markers = ['suggested for you', 'suggested'];

  // aria-labelledby
  const labelledEls = article.querySelectorAll('[aria-labelledby]');
  for (const el of labelledEls) {
    const labelId = el.getAttribute('aria-labelledby');
    if (labelId) {
      const labelEl = document.getElementById(labelId);
      if (labelEl) {
        const text = stripInvisible(labelEl.textContent || '').trim().toLowerCase();
        if (markers.includes(text)) return true;
      }
    }
  }

  // Obfuscated character spans
  const flexSpans = article.querySelectorAll<HTMLElement>('span[style*="display: flex"]');
  for (const container of flexSpans) {
    const children = container.children;
    if (children.length < 8 || children.length > 80) continue;
    const text = reconstructVisibleText(container).toLowerCase();
    if (markers.some(m => text === m)) return true;
  }

  // Plain text fallback
  if (elementContainsMarker(article, ['Suggested for you', 'Suggested'])) return true;

  return false;
}

/**
 * Facebook-specific: detect posts from accounts the user does not follow.
 * These posts have a visible "Follow" button in the header area. Posts from
 * friends or followed pages show "Following" or no button at all.
 *
 * Also checks data-ad-rendering-role as double coverage for ad-pipeline posts.
 */
function isFacebookStranger(article: Element): boolean {
  if (article.querySelector('[data-ad-rendering-role]')) return true;

  // Look for buttons/links whose trimmed text is exactly "Follow"
  // in the header area (roughly the first child containers, not the
  // post body or comments). Facebook wraps the header in the first
  // few nested divs before the story_message data-ad-rendering-role.
  const candidates = article.querySelectorAll(
    '[role="button"], a[role="link"], a[tabindex="0"]'
  );
  for (const el of candidates) {
    const text = stripInvisible(el.textContent || '').trim();
    if (text === 'Follow') {
      // Make sure this is in the header, not in the post body.
      // The post body is wrapped in [data-ad-rendering-role="story_message"]
      // or a deeply nested content div. We reject if the element is inside
      // a story_message container or inside a comment section.
      if (el.closest('[data-ad-rendering-role="story_message"]')) continue;
      if (el.closest('[aria-label*="comment" i]')) continue;
      if (el.closest('[aria-label*="Comment" i]')) continue;
      return true;
    }
  }

  return false;
}

/**
 * Instagram-specific: detect posts from accounts the user does not follow.
 * These posts have a "Follow" button in the article header.
 */
function isInstagramStranger(article: Element): boolean {
  // Instagram article headers use a <header> element
  const header = article.querySelector('header');
  if (!header) return false;

  const candidates = header.querySelectorAll('button, a, div[role="button"]');
  for (const el of candidates) {
    const text = stripInvisible(el.textContent || '').trim();
    if (text === 'Follow') return true;

    const label = el.getAttribute('aria-label');
    if (label && stripInvisible(label).trim() === 'Follow') return true;
  }

  return false;
}

/**
 * Scan Facebook articles within an element using a detector function.
 */
function scanFacebookArticles(el: Element, detector: (article: Element) => boolean, category: BlockCategory) {
  for (const article of el.querySelectorAll('[role="article"]')) {
    if (detector(article)) hideElement(article, category);
  }
  if (el.getAttribute('role') === 'article' && detector(el)) {
    hideElement(el, category);
  }
  // If the element is inside an article and the detector triggers,
  // walk up to the article level.
  const parentArticle = el.closest('[role="article"]');
  if (parentArticle && detector(parentArticle)) {
    hideElement(parentArticle, category);
  }
}

/**
 * Scan for Facebook sponsored posts that lack [role="article"].
 * Checks flex containers with obfuscated "Sponsored" text within `scope`
 * and walks up via findAdFeedUnit to hide the feed unit.
 */
function scanNonArticleSponsored(scope: Element) {
  const flexSel = 'span[style*="display: flex"], span[style*="display:flex"]';
  const candidates: HTMLElement[] = [];

  for (const c of scope.querySelectorAll<HTMLElement>(flexSel)) {
    if (!c.closest('[role="article"]') && !c.closest(`.${HIDDEN_CLASS}`)) {
      candidates.push(c);
    }
  }
  if (scope instanceof HTMLElement && scope.matches?.(flexSel) &&
      !scope.closest('[role="article"]') && !scope.closest(`.${HIDDEN_CLASS}`)) {
    candidates.push(scope);
  }
  const parentFlex = scope.closest?.<HTMLElement>(flexSel);
  if (parentFlex && !parentFlex.closest('[role="article"]') &&
      !parentFlex.closest(`.${HIDDEN_CLASS}`)) {
    candidates.push(parentFlex);
  }

  for (const container of candidates) {
    if (container.children.length < 8 || container.children.length > 80) continue;
    if (reconstructVisibleText(container).toLowerCase() === 'sponsored') {
      const unit = findAdFeedUnit(container);
      if (unit && !unit.classList.contains(HIDDEN_CLASS)) hideElement(unit, 'sponsored');
    }
  }
}

/**
 * Scan for Facebook stranger posts that lack [role="article"].
 * Looks for "Follow" buttons inside [data-ad-rendering-role="profile_name"]
 * areas and hides the feed unit.
 */
function scanNonArticleStrangers(scope: Element) {
  const pnSel = '[data-ad-rendering-role="profile_name"]';
  const profileNames: Element[] = [];

  for (const pn of scope.querySelectorAll(pnSel)) {
    if (!pn.closest('[role="article"]') && !pn.closest(`.${HIDDEN_CLASS}`)) {
      profileNames.push(pn);
    }
  }
  if (scope.matches?.(pnSel) &&
      !scope.closest('[role="article"]') && !scope.closest(`.${HIDDEN_CLASS}`)) {
    profileNames.push(scope);
  }
  const parentPN = scope.closest?.(pnSel);
  if (parentPN && !parentPN.closest('[role="article"]') &&
      !parentPN.closest(`.${HIDDEN_CLASS}`)) {
    profileNames.push(parentPN);
  }

  for (const pn of profileNames) {
    const btns = pn.querySelectorAll('[role="button"], a[role="link"], div[tabindex="0"]');
    let hasFollow = false;
    for (const btn of btns) {
      if (stripInvisible(btn.textContent || '').trim() === 'Follow') {
        hasFollow = true;
        break;
      }
    }
    if (!hasFollow) continue;
    const unit = findAdFeedUnit(pn);
    if (unit && !unit.classList.contains(HIDDEN_CLASS)) hideElement(unit, 'strangers');
  }
}

/**
 * Scan Instagram articles within an element for text markers.
 */
function scanInstagramArticles(el: Element, hostname: string, markers: string[], category: BlockCategory) {
  for (const article of el.querySelectorAll('article')) {
    if (elementContainsMarker(article, markers)) hideElement(article, category);
  }
  if (el.tagName === 'ARTICLE' && elementContainsMarker(el, markers)) {
    hideElement(el, category);
  }
  if (elementContainsMarker(el, markers)) {
    hideElement(closestFeedUnit(el, hostname), category);
  }
}

/**
 * Find and hide Facebook's Reels navigation items by aria-label and text.
 * Covers: top navigation bar (aria-label), sidebar (text-based divs),
 * and mobile tab bar (aria-label + href).
 */
function hideFacebookReelsNavByText(el: Element) {
  // Strategy 1: aria-label="Reels" (top bar, mobile tab bar)
  const ariaMatches = el.querySelectorAll('[aria-label="Reels"]');
  for (const match of ariaMatches) {
    // Skip the feed carousel region
    if (match.getAttribute('role') === 'region') continue;
    if (match.closest('[role="article"]')) continue;
    const link = match.closest('a') || match;
    hideElement(link.parentElement || link, 'reels');
  }

  // Strategy 2: text content "Reels" (desktop sidebar)
  // Sidebar items are plain divs, not links. Walk up from the text span
  // to find the nav item container: the first ancestor that contains an
  // icon element (i/svg/img) in a sibling branch.
  const spans = el.querySelectorAll('span');
  for (const span of spans) {
    if (span.querySelector('span')) continue; // only leaf spans
    const text = stripInvisible(span.textContent || '').trim();
    if (text !== 'Reels') continue;
    if (span.closest('[role="article"]') ||
        span.closest('[role="region"]') ||
        span.closest('[data-pagelet*="FeedUnit"]') ||
        span.closest('[aria-label="Reels"]')) continue;

    // Try link/role selectors first
    const linkItem = span.closest('a') || span.closest('[role="link"]');
    if (linkItem) {
      hideElement(linkItem, 'reels');
      continue;
    }

    // Walk up to the nav item container: the first ancestor that also
    // contains an icon element (i/svg/img) not inside the span itself.
    let current: Element | null = span.parentElement;
    for (let i = 0; i < 12 && current && current !== document.body; i++) {
      if (current.querySelector('i, svg, img')) {
        hideElement(current, 'reels');
        break;
      }
      current = current.parentElement;
    }
  }
}

/**
 * Scan an element (and its subtree) for content that should be hidden.
 */
function scanElement(el: Element, settings: Settings, hostname: string) {
  const isFacebook = hostname.includes('facebook');
  const isInstagram = hostname.includes('instagram');
  const isYouTube = hostname.includes('youtube');

  // --- Facebook Reels ---
  if (settings.hideFacebookReels && isFacebook) {
    // Find Reels region by aria-label and walk up to the full block
    const reelsRegions = el.querySelectorAll('div[aria-label="Reels"][role="region"]');
    for (const region of reelsRegions) {
      const parent = region.parentElement?.parentElement || region.parentElement;
      hideElement(parent, 'reels');
    }
    if (el.matches?.('div[aria-label="Reels"][role="region"]')) {
      const parent = el.parentElement?.parentElement || el.parentElement;
      hideElement(parent, 'reels');
    }
    // Hide Reels navigation buttons (mobile tab bar + desktop sidebar)
    const reelsNavButtons = el.querySelectorAll(
      'a[aria-label="Reels"][href*="/reel/"], a[href="/reel/"], a[href^="/reel/?"], a[href="/reel"]'
    );
    for (const btn of reelsNavButtons) {
      if (!btn.closest('[role="article"]')) {
        hideElement(btn.parentElement || btn, 'reels');
      }
    }
    if (el.matches?.('a[aria-label="Reels"][href*="/reel/"], a[href="/reel/"], a[href^="/reel/?"], a[href="/reel"]') &&
        !el.closest('[role="article"]')) {
      hideElement(el.parentElement || el, 'reels');
    }
    hideFacebookReelsNavByText(el);
    const reelLinks = el.querySelectorAll('a[href*="/reel/"]');
    for (const link of reelLinks) {
      const feedUnit = closestFeedUnit(link, hostname) || link.closest('div[data-pagelet]');
      if (feedUnit) hideElement(feedUnit, 'reels');
    }
    if (elementContainsMarker(el, ['Reels', 'Reels and short videos'])) {
      const unit = closestFeedUnit(el, hostname) || el.closest('div[data-pagelet]');
      hideElement(unit, 'reels');
    }
  }

  // --- Instagram Reels ---
  if (settings.hideInstagramReels && isInstagram) {
    const reelLinks = el.querySelectorAll('a[href*="/reel/"]');
    for (const link of reelLinks) {
      hideElement(link.closest('article'), 'reels');
    }
    const reelsNavLinks = el.querySelectorAll('a[href="/reels/"]');
    for (const link of reelsNavLinks) {
      hideElement(link.closest('div') || link.parentElement, 'reels');
    }
  }

  // --- YouTube Shorts (observer fallback for sidebar) ---
  if (settings.hideYouTubeShorts && isYouTube) {
    const shortsLinks = el.querySelectorAll(
      'ytd-guide-entry-renderer a[href="/shorts"], ytd-mini-guide-entry-renderer a[href="/shorts"]'
    );
    for (const link of shortsLinks) {
      hideElement(
        link.closest('ytd-guide-entry-renderer') ||
        link.closest('ytd-mini-guide-entry-renderer'),
        'shorts'
      );
    }
    const titleLinks = el.querySelectorAll(
      'ytd-guide-entry-renderer a[title="Shorts"], ytd-mini-guide-entry-renderer a[title="Shorts"]'
    );
    for (const link of titleLinks) {
      hideElement(
        link.closest('ytd-guide-entry-renderer') ||
        link.closest('ytd-mini-guide-entry-renderer'),
        'shorts'
      );
    }
    for (const shelf of el.querySelectorAll('ytd-reel-shelf-renderer')) {
      hideElement(shelf, 'shorts');
    }
    for (const chip of el.querySelectorAll('yt-chip-cloud-chip-renderer')) {
      const text = stripInvisible(chip.textContent || '').trim();
      if (text.toLowerCase() === 'shorts') {
        hideElement(chip, 'shorts');
      }
    }
  }

  // --- Facebook Sponsored ---
  if (settings.hideFacebookSponsored && isFacebook) {
    scanFacebookArticles(el, isFacebookSponsored, 'sponsored');
    scanNonArticleSponsored(el);
  }

  // --- Instagram Sponsored ---
  if (settings.hideInstagramSponsored && isInstagram) {
    scanInstagramArticles(el, hostname, ['Sponsored'], 'sponsored');
  }

  // --- Facebook Suggested ---
  if (settings.hideFacebookSuggested && isFacebook) {
    scanFacebookArticles(el, isFacebookSuggested, 'suggested');
  }

  // --- Instagram Suggested ---
  if (settings.hideInstagramSuggested && isInstagram) {
    scanInstagramArticles(el, hostname, ['Suggested for you', 'Suggested Posts', 'Suggested'], 'suggested');
  }

  // --- Facebook Strangers ---
  if (settings.hideFacebookStrangers && isFacebook) {
    scanFacebookArticles(el, isFacebookStranger, 'strangers');
    scanNonArticleStrangers(el);
  }

  // --- Instagram Strangers ---
  if (settings.hideInstagramStrangers && isInstagram) {
    for (const article of el.querySelectorAll('article')) {
      if (isInstagramStranger(article)) hideElement(article, 'strangers');
    }
    if (el.tagName === 'ARTICLE' && isInstagramStranger(el)) {
      hideElement(el, 'strangers');
    }
    const parentArticle = el.closest('article');
    if (parentArticle && isInstagramStranger(parentArticle)) {
      hideElement(parentArticle, 'strangers');
    }
  }
}

/**
 * Full-page scan for all blockable content.
 */
function scanPage(settings: Settings) {
  const hostname = getHostname();
  scanElement(document.body, settings, hostname);
}

function startObserver(settings: Settings) {
  if (blockerObserver) return;

  const hostname = getHostname();

  blockerObserver = new MutationObserver((mutations) => {
    if (!currentSettings) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scanElement(node as Element, currentSettings, hostname);
        }
      }
    }
  });

  blockerObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Initial full scan
  scanPage(settings);

  // Periodic re-scan to catch posts whose ad-related attributes
  // (data-ad-rendering-role, inline styles for obfuscated text, etc.)
  // are set after the initial childList mutation fires.
  startPeriodicScan(hostname);
}

/**
 * Re-scan unhidden articles every 2 seconds. Facebook sets critical
 * detection attributes (data-ad-rendering-role, style="display: flex")
 * in a later React reconciliation pass that the childList observer misses.
 */
function startPeriodicScan(hostname: string) {
  stopPeriodicScan();

  const INTERVAL_MS = 2000;
  const isFacebook = hostname.includes('facebook');
  const isInstagram = hostname.includes('instagram');

  if (!isFacebook && !isInstagram) return;

  const tick = () => {
    if (!currentSettings) return;

    const notHidden = `:not(.${HIDDEN_CLASS})`;

    if (isFacebook) {
      if (currentSettings.hideFacebookReels) {
        const reelsNavBtns = document.querySelectorAll(
          'a[aria-label="Reels"][href*="/reel/"], a[href="/reel/"], a[href^="/reel/?"], a[href="/reel"]'
        );
        for (const btn of reelsNavBtns) {
          if (!btn.closest('[role="article"]')) {
            hideElement(btn.parentElement || btn, 'reels');
          }
        }
        hideFacebookReelsNavByText(document.body);
      }

      if (currentSettings.hideFacebookSponsored) {
        scanNonArticleSponsored(document.body);
        const sponsoredEls = findSponsoredIndicators();
        for (const el of sponsoredEls) {
          if (el.closest(`.${HIDDEN_CLASS}`)) continue;
          const container = findAdFeedUnit(el);
          if (container && !container.classList.contains(HIDDEN_CLASS)) {
            hideElement(container, 'sponsored');
          }
        }
      }

      if (currentSettings.hideFacebookStrangers) {
        scanNonArticleStrangers(document.body);
      }

      const articles = document.querySelectorAll(`[role="article"]${notHidden}`);
      for (const article of articles) {
        if (currentSettings.hideFacebookSponsored && isFacebookSponsored(article)) {
          hideElement(article, 'sponsored');
          continue;
        }
        if (currentSettings.hideFacebookSuggested && isFacebookSuggested(article)) {
          hideElement(article, 'suggested');
          continue;
        }
        if (currentSettings.hideFacebookStrangers && isFacebookStranger(article)) {
          hideElement(article, 'strangers');
          continue;
        }
      }
    }

    if (isInstagram) {
      const articles = document.querySelectorAll(`article${notHidden}`);
      for (const article of articles) {
        if (currentSettings.hideInstagramSponsored && elementContainsMarker(article, ['Sponsored'])) {
          hideElement(article, 'sponsored');
          continue;
        }
        if (currentSettings.hideInstagramSuggested && elementContainsMarker(article, ['Suggested for you', 'Suggested Posts', 'Suggested'])) {
          hideElement(article, 'suggested');
          continue;
        }
        if (currentSettings.hideInstagramStrangers && isInstagramStranger(article)) {
          hideElement(article, 'strangers');
          continue;
        }
      }
    }

    periodicScanTimer = setTimeout(tick, INTERVAL_MS);
  };

  periodicScanTimer = setTimeout(tick, INTERVAL_MS);
}

function stopPeriodicScan() {
  if (periodicScanTimer !== null) {
    clearTimeout(periodicScanTimer);
    periodicScanTimer = null;
  }
}

function stopObserver() {
  blockerObserver?.disconnect();
  blockerObserver = null;
  stopPeriodicScan();
}

// ---------------------------------------------------------------------------
// Blocked count notification
// ---------------------------------------------------------------------------

function totalBlocked(): number {
  let sum = 0;
  for (const k in blockedCounts) sum += blockedCounts[k as BlockCategory];
  return sum;
}

type CountListener = (count: number) => void;
const countListeners: CountListener[] = [];

function notifyCountChange() {
  const total = totalBlocked();
  for (const listener of countListeners) {
    listener(total);
  }
}

export function onBlockedCountChange(listener: CountListener) {
  countListeners.push(listener);
  listener(totalBlocked());
}

export function getBlockedCount(): number {
  return totalBlocked();
}

export function getBlockedCounts(): BlockedCounts {
  return { ...blockedCounts };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startBlocker(settings: Settings) {
  currentSettings = settings;
  const hostname = getHostname();
  injectOrUpdateStyle(buildCSS(settings, hostname));
  startObserver(settings);
}

export function updateBlocker(settings: Settings) {
  currentSettings = settings;
  const hostname = getHostname();
  injectOrUpdateStyle(buildCSS(settings, hostname));

  // Remove hidden class from previously hidden elements when settings change
  // so they reappear without a page reload.
  const hidden = document.querySelectorAll(`.${HIDDEN_CLASS}`);
  for (const el of hidden) {
    el.classList.remove(HIDDEN_CLASS);
  }

  // Re-scan the page with updated settings
  scanPage(settings);
}

export function stopBlocker() {
  stopObserver();
  removeStyle();
  currentSettings = null;

  const hidden = document.querySelectorAll(`.${HIDDEN_CLASS}`);
  for (const el of hidden) {
    el.classList.remove(HIDDEN_CLASS);
  }
}
