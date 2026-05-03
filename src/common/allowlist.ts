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

// True if `host` is the extension's own id (i.e. the page lives under
// `chrome-extension://<extensionId>/...`). Centralized here so callers don't
// each re-derive the comparison and so it stays unit-testable without the
// `chrome` global.
export function isExtensionHost(
  host: string,
  extensionId: string | null | undefined,
): boolean {
  if (!extensionId) return false;
  return host.trim().toLowerCase() === extensionId.trim().toLowerCase();
}

export function isHostAllowed(
  allowlist: readonly string[],
  host: string,
  // The extension's own pages (chrome-extension://<id>/...) are always
  // allowed for note capture so the user never has to add the volatile
  // extension id by hand. Callers in extension contexts pass
  // `chrome.runtime.id`; callers in tests / pure modules omit it.
  extensionId?: string | null,
  // When true, every non-empty host is allowed regardless of the allowlist.
  // Lets users opt into pluck capture everywhere without curating per-site
  // entries. The extension-host short-circuit above still wins for free.
  allowAllSites?: boolean,
): boolean {
  if (isExtensionHost(host, extensionId)) return true;
  if (allowAllSites && host.trim().length > 0) return true;
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
