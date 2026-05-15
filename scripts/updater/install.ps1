# ScrollLearn native messaging host installer (Windows).
# Sets up the helper that lets the extension's "Update now" button
# download a new release and swap it into your unpacked extension dir.
#
# Usage:
#   pwsh scripts/updater/install.ps1
#   pwsh scripts/updater/install.ps1 -ExtId <extension-id> -ExtDir <extension-dir>
#
# After running this, reload the extension once at chrome://extensions/.

[CmdletBinding()]
param(
  [string]$ExtId,
  [string]$ExtDir
)

$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') {
  Write-Error 'This installer is the Windows variant. On macOS run scripts/updater/install.sh instead.'
  exit 1
}

if ([string]::IsNullOrWhiteSpace($ExtId)) {
  Write-Host ''
  Write-Host 'ScrollLearn updater install'
  Write-Host '==========================='
  Write-Host ''
  Write-Host 'Find your extension ID at chrome://extensions/ (enable Developer Mode).'
  $ExtId = Read-Host 'Paste the ScrollLearn extension ID'
}

if ([string]::IsNullOrWhiteSpace($ExtDir)) {
  Write-Host ''
  Write-Host "Path to your unpacked extension folder (the 'dist' you loaded into Chrome)."
  $ExtDir = Read-Host 'Extension dir'
}

$ExtId = ($ExtId -replace '\s', '')
$ExtDir = (Resolve-Path -Path $ExtDir).Path

if (-not (Test-Path (Join-Path $ExtDir 'manifest.json'))) {
  Write-Error "Error: $ExtDir does not contain manifest.json"
  exit 1
}

$pyCmd = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
  $pyCmd = 'py -3'
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

$InstallDir = Join-Path $env:USERPROFILE '.scroll-learn'
$ScriptSrc  = Join-Path $PSScriptRoot 'scrolllearn-updater.py'
$ScriptDst  = Join-Path $InstallDir 'scrolllearn-updater.py'
$Wrapper    = Join-Path $InstallDir 'scrolllearn-updater.bat'
$NmManifest = Join-Path $InstallDir 'com.scrolllearn.updater.json'
$RegPath    = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.scrolllearn.updater'

if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Copy-Item -Path $ScriptSrc -Destination $ScriptDst -Force

$wrapperContent = @"
@echo off
set "SCROLLLEARN_EXT_DIR=$ExtDir"
$pyCmd "$ScriptDst" %*
"@
[System.IO.File]::WriteAllText($Wrapper, $wrapperContent, [System.Text.UTF8Encoding]::new($false))

$manifest = [ordered]@{
  name            = 'com.scrolllearn.updater'
  description     = 'ScrollLearn auto-updater'
  path            = $Wrapper
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtId/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($NmManifest, $manifestJson, [System.Text.UTF8Encoding]::new($false))

if (-not (Test-Path $RegPath)) {
  New-Item -Path $RegPath -Force | Out-Null
}
Set-ItemProperty -Path $RegPath -Name '(Default)' -Value $NmManifest

Write-Host ''
Write-Host 'Installed:'
Write-Host "  helper:   $ScriptDst"
Write-Host "  wrapper:  $Wrapper"
Write-Host "  manifest: $NmManifest"
Write-Host "  registry: $RegPath"
Write-Host "  ext dir:  $ExtDir"
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1. Go to chrome://extensions/'
Write-Host '  2. Click the reload icon on ScrollLearn'
Write-Host "  3. Open the dashboard. The 'Update now' button will work next time"
Write-Host '     a new release is published on GitHub.'
