# ScrollLearn Auto-Updater

One-click upgrades for ScrollLearn loaded as an unpacked extension on Chrome + macOS,
without paying the Chrome Web Store fee.

## How it works

1. The background service worker polls the GitHub Releases API every 6 hours.
2. When a newer `tag_name` is found, the dashboard shows a banner and the toolbar
   icon gets a `!` badge.
3. The user clicks **Update now**. Chrome talks over Native Messaging to a small
   Python helper at `~/.scroll-learn/scrolllearn-updater.py`.
4. The helper downloads the release zip, verifies the manifest version, and
   atomically swaps the new files into the unpacked extension directory.
5. The extension calls `chrome.runtime.reload()` and Chrome restarts with the new code.

No drag-and-drop. No `chrome://extensions` round trip after the first install.

## One-time install (per machine)

```bash
git clone https://github.com/tasszz2k/scroll-learn.git
cd scroll-learn
npm install
npm run build
# Load `dist/` at chrome://extensions/ as an unpacked extension.
# Copy the extension ID from the card.

bash scripts/updater/install.sh <EXTENSION_ID> "$(pwd)/dist"
# Reload the extension once. Done.
```

The installer writes:

- `~/.scroll-learn/scrolllearn-updater.py` – the helper
- `~/.scroll-learn/scrolllearn-updater.sh` – wrapper that pins the extension dir
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.scrolllearn.updater.json`
  – Native Messaging registration scoped to your extension ID

## Cutting a release (publisher side)

Releases are fully automated via GitHub Actions
(`.github/workflows/release.yml`) using
[`release-please`](https://github.com/googleapis/release-please).

Just commit using [Conventional Commits](https://www.conventionalcommits.org/)
and push to `main`:

```bash
git commit -m "feat: add some new card type"
git push origin main
```

`release-please` opens (or updates) a release PR with the bumped
`package.json` + `manifest.json` and a generated CHANGELOG. The workflow
auto-merges that PR, tags the version, builds, zips `dist/`, and attaches
the zip to the GitHub release.

Commit prefixes that trigger version bumps:

| Prefix          | Bump  |
|-----------------|-------|
| `fix:`          | patch |
| `feat:`         | minor |
| `feat!:` / `BREAKING CHANGE:` in body | major |
| `chore:`, `docs:`, `refactor:`, `test:` | none |

The extension auto-detects the new release within 6 hours, or immediately
on next service worker startup.

## Troubleshooting

- **"Native helper not installed"** – run `install.sh` again, then reload the extension.
- **"Specified native messaging host not found"** – the `allowed_origins` extension
  ID in the manifest has to match. Re-running `install.sh` with the right ID fixes it.
- **Logs** – `~/.scroll-learn/updater.log`
- **Manual reload after update** – if the extension does not pick up new files,
  go to `chrome://extensions/` and click the reload icon once.

## Security notes

- The helper only accepts messages from `chrome-extension://<your-id>/` thanks to
  Chrome's Native Messaging origin allowlist.
- It only downloads from the URL the extension passes in (which the extension itself
  read from `api.github.com/repos/tasszz2k/scroll-learn`). If your threat model
  needs more, pin to `https://github.com/tasszz2k/scroll-learn/...` in
  `scrolllearn-updater.py`.
