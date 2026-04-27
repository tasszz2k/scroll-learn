// Allowlist entry matching for note capture.
//
// Each entry is either:
//   - a plain hostname (exact match against the page's normalized hostname), or
//   - a JS regex literal in the form /pattern/flags (tested against the hostname).

const REGEX_LITERAL_RE = /^\/(.+)\/([a-z]*)$/i;

export interface RegexEntry {
  source: string;
  flags: string;
}

export function parseRegexEntry(entry: string): RegexEntry | null {
  const match = entry.match(REGEX_LITERAL_RE);
  if (!match) return null;
  return { source: match[1], flags: match[2] };
}

export function entryMatches(entry: string, host: string): boolean {
  const trimmed = entry.trim();
  if (!trimmed) return false;
  const regex = parseRegexEntry(trimmed);
  if (regex) {
    try {
      return new RegExp(regex.source, regex.flags).test(host);
    } catch {
      return false;
    }
  }
  return trimmed.toLowerCase() === host;
}

export function isHostAllowed(allowlist: readonly string[], host: string): boolean {
  for (const entry of allowlist) {
    if (entryMatches(entry, host)) return true;
  }
  return false;
}

export type AllowlistEntryError = 'empty' | 'invalid-regex';

// Validates an allowlist entry. Returns an error code if invalid, or null if OK.
export function validateAllowlistEntry(entry: string): AllowlistEntryError | null {
  const trimmed = entry.trim();
  if (!trimmed) return 'empty';
  const regex = parseRegexEntry(trimmed);
  if (regex) {
    try {
      new RegExp(regex.source, regex.flags);
      return null;
    } catch {
      return 'invalid-regex';
    }
  }
  return null;
}
