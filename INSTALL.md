# Install ScrollLearn

A Chrome extension that injects spaced-repetition flashcards into your social
media feed. macOS and Windows + Chrome.

After this install, every future update is a **single click** -- no terminal,
no re-downloading.

---

## Recommended: install from the landing page

Visit **<https://tasszz2k.github.io/scroll-learn/>** -- the page detects your
operating system and shows the matching download button. The macOS and
Windows flows are described below; both end at the same place (a working
extension with a one-click "Update now" button).

---

## macOS

### One-click install (landing page)

1. Click **Download installer** -- you get `scroll-learn-installer.zip`.
2. **Double-click the zip** in Finder to extract `install.command`.
3. **Right-click `install.command` -> Open** (macOS warns about unsigned scripts the first time only -- click **Open**).

A Terminal window opens and the rest of the flow is identical to the terminal install below.

> Why a zip? `.command` files lose their executable bit when downloaded directly over HTTP, so macOS refuses to run them. The zip preserves Unix permissions on extraction.

### Terminal install (no npm, no git)

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

> **Python prompt on first run:** if macOS asks to install "Xcode Command
> Line Tools", click **Install**. It's a one-time ~150 MB download macOS
> needs to run the helper script.

---

## Windows

### One-click install (landing page)

1. Click **Download installer** -- you get `install.bat`.
2. **Double-click `install.bat`** in File Explorer.
   - If Windows SmartScreen warns "Windows protected your PC", click
     **More info** then **Run anyway** (the installer is open source;
     this only happens the first time).
3. A Command Prompt window opens and runs the PowerShell installer.

### Terminal install (no npm, no git)

Open **PowerShell** and paste:

```powershell
powershell -c "iwr -useb https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.ps1 | iex"
```

This downloads the latest release into `%USERPROFILE%\.scroll-learn\`,
opens `chrome://extensions` for you, and walks you through:

1. Toggle **Developer mode** (top right of `chrome://extensions`)
2. The installer also opens an **Explorer window** with the `extension`
   folder selected -- **drag that folder onto the Chrome tab** and
   Chrome will load it as an unpacked extension.
   - If you prefer **Load unpacked**: paste `%USERPROFILE%\.scroll-learn\extension`
     into the dialog's address bar.
3. Copy the **extension ID** from the ScrollLearn card
4. Paste it back into PowerShell when prompted
5. Reload the extension once

> **Python required:** the helper script needs Python 3 on `PATH`. If the
> installer reports it's missing, install with one of:
>
> ```powershell
> winget install Python.Python.3
> ```
>
> ...or download from <https://www.python.org/downloads/windows/>. The
> installer can be re-run safely once Python is on `PATH`.

---

## How updates work from now on

The extension polls GitHub every 6 hours. When a new release lands:

1. Dashboard shows: *"vX.Y.Z available -- Update now"*
2. Click **Update now**
3. Extension reloads with the new code (~5 seconds)

No git pull. No re-build. No re-loading.

---

## Troubleshooting

**"Native helper not installed"** when clicking Update now
The native messaging registration is missing or pointing at the wrong
extension ID. Re-run the installer for your OS:

```bash
# macOS
curl -fsSL https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.sh | bash
```

```powershell
# Windows
powershell -c "iwr -useb https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.ps1 | iex"
```

**Banner doesn't appear**
Open the ScrollLearn dashboard (right-click toolbar icon -> Options).
Opening it triggers a fresh check.

**Update fails / something looks broken**
Check the log: `cat ~/.scroll-learn/updater.log` (macOS) or
`type %USERPROFILE%\.scroll-learn\updater.log` (Windows). As a last
resort, just re-run the installer -- it's idempotent.

---

## Uninstall

1. Remove the extension at `chrome://extensions/`
2. Delete the local files:

   macOS:

   ```bash
   rm -rf ~/.scroll-learn
   rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.scrolllearn.updater.json"
   ```

   Windows (PowerShell):

   ```powershell
   Remove-Item -Recurse -Force "$env:USERPROFILE\.scroll-learn"
   Remove-Item -Recurse -Force "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.scrolllearn.updater"
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

# macOS
bash scripts/updater/install.sh <EXTENSION_ID> "$(pwd)/dist"
```

```powershell
# Windows
pwsh scripts/updater/install.ps1 -ExtId <EXTENSION_ID> -ExtDir "$PWD\dist"
```

This wires the auto-updater to your local `dist/` folder, so the
"Update now" button still works after `npm run build`.
