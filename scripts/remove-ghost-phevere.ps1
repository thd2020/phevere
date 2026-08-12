# Remove "ghost" Phevere installs
#
# Use when Program Files still has a Phevere folder but Settings → Apps / Control Panel
# no longer lists it (broken uninstall registry), or after aborted installs.
#
# Run in an elevated PowerShell:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\scripts\remove-ghost-phevere.ps1
# Optional:
#   .\scripts\remove-ghost-phevere.ps1 -AlsoUserData   # also delete %APPDATA%\phevere (vocab DB)
#   .\scripts\remove-ghost-phevere.ps1 -WhatIf

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$AlsoUserData
)

$ErrorActionPreference = 'Continue'

function Remove-Tree([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  if ($PSCmdlet.ShouldProcess($Path, 'Remove directory')) {
    Write-Host "Removing $Path"
    Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Remove-UninstallKey([Microsoft.Win32.RegistryKey]$Root, [string]$SubKey) {
  try {
    $key = $Root.OpenSubKey($SubKey, $true)
    if (-not $key) { return }
    foreach ($name in $key.GetSubKeyNames()) {
      $child = $key.OpenSubKey($name)
      if (-not $child) { continue }
      $dn = [string]$child.GetValue('DisplayName')
      $il = [string]$child.GetValue('InstallLocation')
      $us = [string]$child.GetValue('UninstallString')
      $child.Close()
      $hit =
        ($dn -match '(?i)phevere') -or
        ($il -match '(?i)phevere') -or
        ($us -match '(?i)phevere') -or
        ($name -match '(?i)phevere|45fdcc76|com\.phevere')
      if ($hit) {
        $full = Join-Path $SubKey $name
        if ($PSCmdlet.ShouldProcess("$($Root.Name)\$full", 'Delete uninstall registry key')) {
          Write-Host "Deleting registry $($Root.Name)\$full  (DisplayName=$dn)"
          $key.DeleteSubKeyTree($name, $false)
        }
      }
    }
    $key.Close()
  } catch {
    Write-Warning $_
  }
}

Write-Host "=== Phevere ghost cleanup ==="

# Known install directories (current + legacy author parent folders)
$dirs = @(
  "$env:ProgramFiles\Phevere",
  "${env:ProgramFiles(x86)}\Phevere",
  "$env:ProgramFiles\thd2020\Phevere",
  "$env:ProgramFiles\xiangyuxiao\Phevere",
  "${env:ProgramFiles(x86)}\thd2020\Phevere",
  "${env:ProgramFiles(x86)}\xiangyuxiao\Phevere",
  "$env:LOCALAPPDATA\Programs\Phevere",
  "$env:LOCALAPPDATA\Programs\thd2020\Phevere",
  "$env:LOCALAPPDATA\Programs\xiangyuxiao\Phevere"
) | Select-Object -Unique

foreach ($d in $dirs) { Remove-Tree $d }

# electron-builder also keeps a per-user package store under LocalAppData
Remove-Tree "$env:LOCALAPPDATA\phevere-updater"

# Install / uninstall registry (HKCU + HKLM, 32 + 64 view)
$uninstallPaths = @(
  'Software\Microsoft\Windows\CurrentVersion\Uninstall',
  'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
foreach ($up in $uninstallPaths) {
  Remove-UninstallKey ([Microsoft.Win32.Registry]::CurrentUser) $up
  Remove-UninstallKey ([Microsoft.Win32.Registry]::LocalMachine) $up
}

# electron-builder INSTALL_REGISTRY_KEY under Software\<app>
foreach ($hive in @([Microsoft.Win32.Registry]::CurrentUser, [Microsoft.Win32.Registry]::LocalMachine)) {
  foreach ($soft in @('Software\Phevere', 'Software\thd2020\Phevere', 'Software\xiangyuxiao\Phevere', 'Software\com.phevere.app')) {
    try {
      if ($hive.OpenSubKey($soft)) {
        if ($PSCmdlet.ShouldProcess("$($hive.Name)\$soft", 'Delete install registry key')) {
          Write-Host "Deleting $($hive.Name)\$soft"
          $parent = Split-Path $soft -Parent
          $leaf = Split-Path $soft -Leaf
          $p = $hive.OpenSubKey($parent, $true)
          if ($p) { $p.DeleteSubKeyTree($leaf, $false); $p.Close() }
        }
      }
    } catch { }
  }
}

# Shortcuts
$shortcuts = @(
  "$env:PUBLIC\Desktop\Phevere.lnk",
  "$env:USERPROFILE\Desktop\Phevere.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Phevere.lnk",
  "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Uninstall Phevere.lnk",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Phevere.lnk",
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Uninstall Phevere.lnk"
)
foreach ($s in $shortcuts) {
  if (Test-Path -LiteralPath $s) {
    if ($PSCmdlet.ShouldProcess($s, 'Delete shortcut')) {
      Write-Host "Deleting $s"
      Remove-Item -LiteralPath $s -Force -ErrorAction SilentlyContinue
    }
  }
}
Remove-Tree "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\thd2020"
Remove-Tree "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\xiangyuxiao"
Remove-Tree "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\thd2020"
Remove-Tree "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\xiangyuxiao"

if ($AlsoUserData) {
  Remove-Tree "$env:APPDATA\phevere"
  Write-Host "(Also removed userData — vocabulary notebook / settings gone.)"
} else {
  Write-Host "Kept %APPDATA%\phevere (vocab notebook). Pass -AlsoUserData to wipe it."
}

Write-Host "=== Done. Reboot or refresh Settings → Apps if an entry still appears. ==="
Write-Host "Then install a fresh Phevere-Setup-*-x64.exe."
