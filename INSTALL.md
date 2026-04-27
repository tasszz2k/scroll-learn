# Install ScrollLearn

A Chrome extension that injects spaced-repetition flashcards into your social
media feed. macOS + Chrome only for now.

After this install, every future update is a **single click** — no terminal,
no re-downloading.

---

## Recommended: install from the landing page

1. Visit **<https://tasszz2k.github.io/scroll-learn/>** and click **Download installer** -- you get `scroll-learn-installer.zip`.
2. **Double-click the zip** in Finder to extract `install.command`.
3. **Right-click `install.command` -> Open** (macOS warns about unsigned scripts the first time only -- click **Open**).

A Terminal window opens and the rest of the flow is identical to the terminal install below.

> Why a zip? `.command` files lose their executable bit when downloaded directly over HTTP, so macOS refuses to run them. The zip preserves Unix permissions on extraction.

---

## Alternative: install via Terminal (no npm, no git)

Open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.sh | bash
```

This downloads the latest release into `~/.scroll-learn/`, opens
`chrome://extensions` for you, and walks you through:

1. Toggle **Developer mode** (top right of `chrome://extensions`)
2. The installer also opens a **Finder window** with the `extension`
   folder highlighted -- **drag that folder onto the Chrome tab** and
   Chrome will load it as an unpacked extension.
   - If you prefer **Load unpacked**: the `~/.scroll-learn` folder is
     hidden in macOS dialogs by default. Press **Cmd+Shift+.** inside
     the dialog to reveal hidden folders, or **Cmd+Shift+G** and paste
     `~/.scroll-learn/extension`.
3. Copy the **extension ID** from the ScrollLearn card
4. Paste it back into the terminal when prompted
5. Reload the extension once

Done. From now on, when a new release ships, the dashboard shows a banner —
click **Update now** and you're on the new version in a few seconds.

> **Python prompt on first run:** if macOS asks to install "Xcode Command
> Line Tools", click **Install**. It's a one-time ~150 MB download macOS
> needs to run the helper script.

---

## How updates work from now on

The extension polls GitHub every 6 hours. When a new release lands:

1. Dashboard shows: *"vX.Y.Z available — Update now"*
2. Click **Update now**
3. Extension reloads with the new code (~5 seconds)

No git pull. No re-build. No re-loading.

---

## Troubleshooting

**"Native helper not installed"** when clicking Update now
The native messaging registration is missing or pointing at the wrong
extension ID. Re-run the installer:
```bash
curl -fsSL https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.sh | bash
```

**Banner doesn't appear**
Open the ScrollLearn dashboard (right-click toolbar icon → Options).
Opening it triggers a fresh check.

**Update fails / something looks broken**
Check the log: `cat ~/.scroll-learn/updater.log`. As a last resort, just
re-run the installer — it's idempotent.

---

## Uninstall

1. Remove the extension at `chrome://extensions/`
2. Delete the local files:
   ```bash
   rm -rf ~/.scroll-learn
   rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.scrolllearn.updater.json"
   ```

---

## Developer install (build from source)

If you want to hack on ScrollLearn yourself:

```bash
git clone https://github.com/tasszz2k/scroll-learn.git
cd scroll-learn
npm install
npm run build
# Load dist/ at chrome://extensions/ as an unpacked extension.
# Copy the extension ID, then:
bash scripts/updater/install.sh <EXTENSION_ID> "$(pwd)/dist"
```

This wires the auto-updater to your local `dist/` folder, so the
"Update now" button still works after `npm run build`.
