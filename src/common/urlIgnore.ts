// URL ignore-list matcher used by the content blocker.
//
// Each entry can be one of:
//   - A plain host with no slash, e.g. `facebook.com`
//       -> exact host match.
//   - A host + path prefix, e.g. `facebook.com/messages`
//       -> case-insensitive startsWith on `host + pathname`.
//   - A JS regex literal `/pattern/flags`
//       -> tested against the lowercased `host + pathname`.
//
// The blocker calls `isUrlIgnored` with the page's normalized host (no
// `www.` / `m.` prefix) and pathname. Empty / whitespace-only entries are
// ignored so a blank line in the UI never accidentally disables the blocker.

const REGEX_LITERAL_RE = /^\/(.+)\/([a-z]*)$/i;

export function normalizeHost(rawHost: string): string {
  return rawHost.toLowerCase().replace(/^(www\.|m\.)/, '');
}

function buildHostPath(host: string, pathname: string): string {
  const h = normalizeHost(host);
  let p = pathname || '';
  if (!p.startsWith('/')) p = '/' + p;
  return (h + p).toLowerCase();
}

function stripEntry(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  // Tolerate users pasting full URLs by dropping the scheme.
  s = s.replace(/^[a-z]+:\/\//i, '');
  // Tolerate trailing slashes on plain entries (regex handled separately).
  if (!REGEX_LITERAL_RE.test(s) && s.endsWith('/') && s.length > 1) {
    s = s.replace(/\/+$/, '');
  }
  return s;
}

export function entryMatchesUrl(
  rawEntry: string,
  host: string,
  pathname: string,
): boolean {
  const entry = stripEntry(rawEntry);
  if (!entry) return false;

  const target = buildHostPath(host, pathname);

  const m = entry.match(REGEX_LITERAL_RE);
  if (m) {
    try {
      return new RegExp(m[1], m[2]).test(target);
    } catch {
      return false;
    }
  }

  // Normalize the host portion of the entry the same way the page host gets
  // normalized so `www.facebook.com/messages` matches `facebook.com/messages`.
  const slash = entry.indexOf('/');
  const e = (slash === -1
    ? normalizeHost(entry)
    : normalizeHost(entry.slice(0, slash)) + entry.slice(slash)
  ).toLowerCase();

  // No slash -> match host exactly. Slash present -> startsWith on host+path.
  if (!e.includes('/')) {
    return target.split('/')[0] === e;
  }
  return target === e || target.startsWith(e + '/');
}

export function isUrlIgnored(
  entries: readonly string[],
  host: string,
  pathname: string,
): boolean {
  if (!entries || entries.length === 0) return false;
  for (const entry of entries) {
    if (entryMatchesUrl(entry, host, pathname)) return true;
  }
  return false;
}

export type IgnoreEntryError = 'empty' | 'invalid-regex';

export function validateIgnoreEntry(entry: string): IgnoreEntryError | null {
  const trimmed = stripEntry(entry);
  if (!trimmed) return 'empty';
  const m = trimmed.match(REGEX_LITERAL_RE);
  if (m) {
    try {
      new RegExp(m[1], m[2]);
      return null;
    } catch {
      return 'invalid-regex';
    }
  }
  return null;
}

// Normalize input the same way the runtime matcher does so the stored entry
// matches what the user types after we strip schemes / trailing slashes.
export function normalizeIgnoreEntry(raw: string): string {
  const stripped = stripEntry(raw);
  if (!stripped) return '';
  if (REGEX_LITERAL_RE.test(stripped)) return stripped;
  // Lowercase host portion only; preserve path casing in case a regex-style
  // matcher cares (most servers don't, but it keeps the user's intent visible).
  const slash = stripped.indexOf('/');
  if (slash === -1) return normalizeHost(stripped);
  const host = normalizeHost(stripped.slice(0, slash));
  const path = stripped.slice(slash);
  return host + path;
}
