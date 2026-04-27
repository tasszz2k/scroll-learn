import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compareVersions, buildUpdateInfo } from '../src/common/updater';

describe('compareVersions', () => {
  it('returns 0 for identical versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('strips a leading "v" before comparing', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v2.0.0', 'v1.9.9')).toBeGreaterThan(0);
  });

  it('orders by major version first', () => {
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });

  it('orders by minor version when major is equal', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
  });

  it('orders by patch version when major and minor are equal', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.9', '1.0.10')).toBeLessThan(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0.0', '1.2')).toBe(0);
  });

  it('does numeric (not lexical) comparison', () => {
    expect(compareVersions('1.0.10', '1.0.2')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('treats non-numeric segments as 0', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.x', '1.2.0')).toBe(0);
  });

  it('does NOT implement semver prerelease semantics (naive split-on-dot)', () => {
    // 'v1.2.3-rc.1' parses as [1,2,3,1] (parseInt stops at '-'), and any
    // 4th part > 0 makes it look newer than 'v1.2.3' = [1,2,3]. This is
    // acceptable because release-please publishes clean tags like 'v1.2.0';
    // pinning the behavior so a future "fix" to add real semver doesn't
    // silently flip update flags for users on prerelease channels.
    expect(compareVersions('v1.2.3-rc.1', 'v1.2.3')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.4-rc.1', 'v1.2.3')).toBeGreaterThan(0);
  });
});

describe('buildUpdateInfo', () => {
  const fakeManifest = { version: '1.0.0' };
  const originalFetch = globalThis.fetch;
  const originalChrome = (globalThis as unknown as { chrome?: unknown }).chrome;

  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => fakeManifest,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    if (originalChrome === undefined) {
      delete (globalThis as { chrome?: unknown }).chrome;
    } else {
      (globalThis as { chrome?: unknown }).chrome = originalChrome;
    }
  });

  function mockFetchOk(body: unknown) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    } as Response);
  }

  function mockFetchFail(status = 503, statusText = 'Service Unavailable') {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
      json: async () => ({}),
    } as Response);
  }

  it('flags an update when GitHub release is newer than the manifest', async () => {
    mockFetchOk({
      tag_name: 'v1.2.0',
      html_url: 'https://github.com/owner/repo/releases/tag/v1.2.0',
      body: 'Release notes',
      draft: false,
      prerelease: false,
      assets: [
        { name: 'extension.zip', browser_download_url: 'https://example/extension.zip' },
      ],
    });

    const info = await buildUpdateInfo();
    expect(info.currentVersion).toBe('1.0.0');
    expect(info.latestVersion).toBe('1.2.0');
    expect(info.updateAvailable).toBe(true);
    expect(info.downloadUrl).toBe('https://example/extension.zip');
    expect(info.releaseUrl).toBe('https://github.com/owner/repo/releases/tag/v1.2.0');
    expect(info.releaseNotes).toBe('Release notes');
    expect(info.error).toBeUndefined();
    expect(info.checkedAt).toBeGreaterThan(0);
  });

  it('does not flag an update when versions match', async () => {
    mockFetchOk({
      tag_name: 'v1.0.0',
      html_url: 'https://example/release',
      body: '',
      draft: false,
      prerelease: false,
      assets: [{ name: 'ext.zip', browser_download_url: 'https://example/ext.zip' }],
    });

    const info = await buildUpdateInfo();
    expect(info.latestVersion).toBe('1.0.0');
    expect(info.updateAvailable).toBe(false);
  });

  it('does not flag an update when GitHub version is older', async () => {
    mockFetchOk({
      tag_name: 'v0.9.0',
      html_url: 'https://example/release',
      body: '',
      draft: false,
      prerelease: false,
      assets: [{ name: 'ext.zip', browser_download_url: 'https://example/ext.zip' }],
    });

    const info = await buildUpdateInfo();
    expect(info.updateAvailable).toBe(false);
  });

  it('returns null downloadUrl when the release has no .zip asset', async () => {
    mockFetchOk({
      tag_name: 'v1.5.0',
      html_url: 'https://example/release',
      body: '',
      draft: false,
      prerelease: false,
      assets: [
        { name: 'extension.crx', browser_download_url: 'https://example/extension.crx' },
        { name: 'source.tar.gz', browser_download_url: 'https://example/source.tar.gz' },
      ],
    });

    const info = await buildUpdateInfo();
    expect(info.updateAvailable).toBe(true);
    expect(info.downloadUrl).toBeNull();
  });

  it('returns a safe error payload when the GitHub fetch fails', async () => {
    mockFetchFail(503, 'Service Unavailable');

    const info = await buildUpdateInfo();
    expect(info.currentVersion).toBe('1.0.0');
    expect(info.latestVersion).toBeNull();
    expect(info.updateAvailable).toBe(false);
    expect(info.downloadUrl).toBeNull();
    expect(info.releaseUrl).toBeNull();
    expect(info.releaseNotes).toBeNull();
    expect(info.error).toContain('GitHub API 503');
  });

  it('returns a safe error payload when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const info = await buildUpdateInfo();
    expect(info.updateAvailable).toBe(false);
    expect(info.error).toContain('network down');
  });

  it('preserves null releaseNotes when the release body is empty', async () => {
    mockFetchOk({
      tag_name: 'v2.0.0',
      html_url: 'https://example/release',
      body: '',
      draft: false,
      prerelease: false,
      assets: [{ name: 'ext.zip', browser_download_url: 'https://example/ext.zip' }],
    });

    const info = await buildUpdateInfo();
    expect(info.releaseNotes).toBeNull();
  });
});
