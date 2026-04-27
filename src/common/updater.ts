import type { UpdateInfo } from './types';

export const GITHUB_REPO = 'tasszz2k/scroll-learn';
export const NATIVE_HOST_NAME = 'com.scrolllearn.updater';

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubAsset[];
}

export function getCurrentVersion(): string {
  return chrome.runtime.getManifest().version;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

export async function fetchLatestRelease(repo: string = GITHUB_REPO): Promise<GithubRelease> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<GithubRelease>;
}

export async function buildUpdateInfo(repo: string = GITHUB_REPO): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();
  const checkedAt = Date.now();
  try {
    const release = await fetchLatestRelease(repo);
    const latestVersion = release.tag_name.replace(/^v/, '');
    const zipAsset = release.assets.find(a => a.name.endsWith('.zip'));
    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      downloadUrl: zipAsset?.browser_download_url ?? null,
      releaseUrl: release.html_url,
      releaseNotes: release.body || null,
      checkedAt,
    };
  } catch (err) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      downloadUrl: null,
      releaseUrl: null,
      releaseNotes: null,
      checkedAt,
      error: String(err),
    };
  }
}
