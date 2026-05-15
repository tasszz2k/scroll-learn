# ScrollLearn one-shot installer for Windows (no npm, no git clone needed).
#
# Usage (PowerShell):
#   powershell -c "iwr -useb https://raw.githubusercontent.com/tasszz2k/scroll-learn/main/install.ps1 | iex"
#
# Or download and double-click install.bat from the landing page.
#
# Downloads the latest release, extracts to %USERPROFILE%\.scroll-learn\,
# and registers the auto-updater (HKCU Native Messaging registry entry)
# so future updates are one click.

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo        = 'tasszz2k/scroll-learn'
$InstallDir  = Join-Path $env:USERPROFILE '.scroll-learn'
$ExtDir      = Join-Path $InstallDir 'extension'
$Helper      = Join-Path $InstallDir 'scrolllearn-updater.py'
$Wrapper     = Join-Path $InstallDir 'scrolllearn-updater.bat'
$NmManifest  = Join-Path $InstallDir 'com.scrolllearn.updater.json'
$RegPath     = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.scrolllearn.updater'

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  Write-Error 'ScrollLearn install.ps1 is the Windows installer. On macOS run install.sh instead.'
  exit 1
}

$pyCmd = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
  $pyCmd = 'py'
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $pyCmd = 'python'
} else {
  Write-Host ''
  Write-Host 'Python 3 is required for the auto-updater helper.' -ForegroundColor Yellow
  Write-Host 'Install one of the following, then re-run this installer:'
  Write-Host '  winget install Python.Python.3'
  Write-Host '  https://www.python.org/downloads/windows/'
  exit 1
}

Write-Host "==> Fetching latest release from $Repo..."
$release = Invoke-RestMethod -UseBasicParsing -Headers @{ Accept = 'application/vnd.github+json' } `
  -Uri "https://api.github.com/repos/$Repo/releases/latest"

$zipAsset = $release.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1
if (-not $zipAsset) {
  Write-Host 'Could not find a .zip asset in the latest release.' -ForegroundColor Red
  exit 1
}
$zipUrl = $zipAsset.browser_download_url
$version = ($release.tag_name -replace '^v', '')

Write-Host "==> Downloading v$version"
Write-Host "    $zipUrl"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("scrolllearn-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $zipPath = Join-Path $tmp 'release.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zipPath

  if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  }

  if (Test-Path $ExtDir) {
    Remove-Item -Recurse -Force $ExtDir
  }

  Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
}
finally {
  if (Test-Path $tmp) {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path (Join-Path $ExtDir 'manifest.json'))) {
  Write-Host "Release zip layout looks wrong (no $ExtDir\manifest.json)." -ForegroundColor Red
  Write-Host "Contents of $InstallDir`:"
  Get-ChildItem $InstallDir | Format-Table -AutoSize
  exit 1
}

if (-not (Test-Path $Helper)) {
  Write-Host 'Release zip is missing scrolllearn-updater.py - try the dev install path.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '================================================================'
Write-Host "  ScrollLearn v$version downloaded to:"
Write-Host "     $ExtDir"
Write-Host '================================================================'
Write-Host ''
Write-Host 'Next: load it in Chrome.'
Write-Host ''
Write-Host '  1. A Chrome window will open at chrome://extensions'
Write-Host "  2. Toggle 'Developer mode' (top right of the page)"
Write-Host "  3. An Explorer window will open with the 'extension' folder selected."
Write-Host "     Easiest path: DRAG the highlighted 'extension' folder onto the"
Write-Host '     chrome://extensions tab. Chrome accepts the drop and loads it.'
Write-Host ''
Write-Host "     If you'd rather click 'Load unpacked':"
Write-Host "       - Click 'Load unpacked' in chrome://extensions"
Write-Host "       - Paste this path into the dialog:  $ExtDir"
Write-Host ''
Write-Host '  4. Copy the extension ID from the ScrollLearn card'
Write-Host ''

Read-Host 'Press Enter to open Chrome and reveal the extension folder' | Out-Null

$chromeOpened = $false
foreach ($candidate in @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)) {
  if ($candidate -and (Test-Path $candidate)) {
    Start-Process -FilePath $candidate -ArgumentList 'chrome://extensions' | Out-Null
    $chromeOpened = $true
    break
  }
}
if (-not $chromeOpened) {
  try { Start-Process 'chrome://extensions' | Out-Null } catch { }
}

try {
  Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$ExtDir`"" | Out-Null
} catch { }

Write-Host ''
$extId = Read-Host 'Paste the extension ID here'
$extId = ($extId -replace '\s', '')

if ([string]::IsNullOrEmpty($extId)) {
  Write-Host 'No extension ID provided. Aborting.' -ForegroundColor Red
  exit 1
}

if ($extId -notmatch '^[a-p]{32}$') {
  Write-Host "Warning: '$extId' doesn't look like a Chrome extension ID (32 lowercase a-p chars)." -ForegroundColor Yellow
  $yn = Read-Host 'Continue anyway? [y/N]'
  if ($yn -notmatch '^[Yy]') {
    Write-Host 'Aborted.'
    exit 1
  }
}

if ($pyCmd -eq 'py') {
  $pyInvoke = 'py -3'
} else {
  $pyInvoke = 'python'
}
$wrapperContent = @"
@echo off
set "SCROLLLEARN_EXT_DIR=$ExtDir"
$pyInvoke "$Helper" %*
"@
[System.IO.File]::WriteAllText($Wrapper, $wrapperContent, [System.Text.UTF8Encoding]::new($false))

$manifest = [ordered]@{
  name            = 'com.scrolllearn.updater'
  description     = 'ScrollLearn auto-updater'
  path            = $Wrapper
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$extId/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($NmManifest, $manifestJson, [System.Text.UTF8Encoding]::new($false))

if (-not (Test-Path $RegPath)) {
  New-Item -Path $RegPath -Force | Out-Null
}
Set-ItemProperty -Path $RegPath -Name '(Default)' -Value $NmManifest

Write-Host ''
Write-Host "Done. Installed v$version."
Write-Host ''
Write-Host 'Final step: go back to chrome://extensions and click the reload icon'
Write-Host "on ScrollLearn once. From now on, updates appear as a banner in the"
Write-Host "dashboard with an 'Update now' button."
