# Real NSIS integration test. This deliberately refuses a developer workstation.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [string]$PreviousInstaller,
    [string]$PackagedAsar,
    [ValidateRange(30, 900)][int]$TimeoutSeconds = 240
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -cne 'true') { throw 'Installer integration tests only run on disposable GitHub Actions Windows runners.' }
if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) { throw 'Windows is required.' }
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'An administrator runner is required.' }
if (-not $env:RUNNER_TEMP -or -not (Test-Path -LiteralPath $env:RUNNER_TEMP -PathType Container)) { throw 'RUNNER_TEMP is required.' }
$repo = Split-Path -Parent $PSScriptRoot
$Installer = (Resolve-Path -LiteralPath $Installer).Path
if ($PreviousInstaller) { $PreviousInstaller = (Resolve-Path -LiteralPath $PreviousInstaller).Path } else { $PreviousInstaller = $Installer }
if (-not $PackagedAsar) {
    $arch = if ([IO.Path]::GetFileName($Installer) -match '-arm64\.exe$') { 'arm64' } else { 'x64' }
    $PackagedAsar = Join-Path $repo "out\phevere-win32-$arch\resources\app.asar"
}
$PackagedAsar = (Resolve-Path -LiteralPath $PackagedAsar).Path
$version = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$guid = (& node -e "const {UUID}=require('builder-util-runtime'); console.log(UUID.v5('com.phevere.app', UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3')))" | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $guid -notmatch '^[0-9a-f-]{36}$') { throw 'Could not derive the stable electron-builder application GUID.' }
$userData = Join-Path $env:APPDATA 'phevere'
$runnerRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$fixtureRoot = Join-Path $runnerRoot ('Phevere upgrade fixture ' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $fixtureRoot 'Custom install with spaces'
$appExe = Join-Path $installRoot 'Phevere.exe'
$stateHelper = Join-Path $PSScriptRoot 'test-installer-state.js'
$electronExe = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$fixtureHtml = Join-Path $fixtureRoot 'storage.html'
$desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$programs = [Environment]::GetFolderPath('CommonPrograms')
$links = @((Join-Path $desktop 'Phevere.lnk'), (Join-Path $programs 'Phevere.lnk'), (Join-Path $programs 'Uninstall Phevere.lnk'))

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-Entries {
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            # HKCU Software is shared between registry views. Do not count it twice.
            if ($hive -eq [Microsoft.Win32.RegistryHive]::CurrentUser -and $view -eq [Microsoft.Win32.RegistryView]::Registry32) { continue }
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
            try {
                $uninstall = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
                if ($null -eq $uninstall) { continue }
                try {
                    foreach ($name in $uninstall.GetSubKeyNames()) {
                        $entry = $uninstall.OpenSubKey($name)
                        try {
                            $display = [string]$entry.GetValue('DisplayName', '')
                            if ($name -eq $guid -or $display -like 'Phevere*') {
                                [pscustomobject]@{ Hive = $hive; View = $view; Guid = $name; Version = [string]$entry.GetValue('DisplayVersion', ''); Path = [string]$entry.GetValue('InstallLocation', ''); Uninstall = [string]$entry.GetValue('UninstallString', '') }
                            }
                        } finally { $entry.Dispose() }
                    }
                } finally { $uninstall.Dispose() }
            } finally { $base.Dispose() }
        }
    }
}
function Get-OwnedEntry {
    $entries = @(Get-Entries)
    Assert-True ($entries.Count -eq 1) "Expected one Phevere uninstall entry; found $($entries.Count)."
    $entry = $entries[0]
    Assert-True ($entry.Guid -eq $guid) 'The installer changed the stable application GUID.'
    Assert-True ([IO.Path]::GetFullPath($entry.Path).TrimEnd('\') -eq $installRoot) 'The upgrade did not reuse the recorded custom installation path.'
    return $entry
}
function Set-Choices([object]$Entry, [string]$Value) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Entry.Hive, $Entry.View)
    try {
        $key = $base.OpenSubKey("Software\$guid", $true)
        Assert-True ($null -ne $key) 'The installation preferences registry key is missing.'
        try {
            Assert-True ([string]$key.GetValue('InstallLocation', '') -eq $installRoot) 'Refusing to mutate registry choices outside the fixture.'
            foreach ($name in @('DesktopShortcut', 'StartMenuShortcut', 'OcrModels')) {
                if ($Value -eq 'legacy') { $key.DeleteValue($name, $false) }
                else { $key.SetValue($name, $Value, [Microsoft.Win32.RegistryValueKind]::String) }
            }
        } finally { $key.Dispose() }
    } finally { $base.Dispose() }
}
function Invoke-Hidden([string]$Executable, [string]$Arguments, [int]$ExpectedExitCode = 0) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    $null = $process.Handle
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Process timed out: $Executable"
    }
    Assert-True ($process.ExitCode -eq $ExpectedExitCode) "Expected exit code $ExpectedExitCode, received $($process.ExitCode): $Executable"
}
function Assert-HeadlessAudio([string]$Model, [int]$ExpectedExitCode, [string]$ExpectedEvent) {
    $suffix = if ($Model) { $Model } else { 'empty' }
    $stdout = Join-Path $fixtureRoot "audio-$suffix.stdout"
    $stderr = Join-Path $fixtureRoot "audio-$suffix.stderr"
    $process = Start-Process -FilePath $appExe -ArgumentList "--install-audio-model=$Model" -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $null = $process.Handle
    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Min($TimeoutSeconds, 60))
    try {
        do {
            Assert-True (-not [InstallerTestWindows]::HasApplicationWindow($process.Id)) "Audio CLI '$Model' opened a desktop window."
            if ([DateTime]::UtcNow -ge $deadline) { throw "Headless audio CLI timed out for '$Model'." }
            Start-Sleep -Milliseconds 25
            $process.Refresh()
        } while (-not $process.HasExited)
        $process.WaitForExit()
        Assert-True ($process.ExitCode -eq $ExpectedExitCode) "Audio CLI '$Model' exited with $($process.ExitCode), expected $ExpectedExitCode. stderr: $(Get-Content -LiteralPath $stderr -Raw)"
        $events = @()
        foreach ($line in Get-Content -LiteralPath $stdout) {
            if ($line.TrimStart().StartsWith('{')) {
                try { $events += $line | ConvertFrom-Json } catch { throw "Invalid JSON audio event: $line" }
            }
        }
        $matching = @($events | Where-Object { $_.PSObject.Properties['event'] -and $_.PSObject.Properties['model'] -and $_.event -eq $ExpectedEvent -and $_.model -eq $Model })
        Assert-True ($matching.Count -eq 1) "Audio CLI '$Model' did not flush its $ExpectedEvent JSON event. stdout: $(Get-Content -LiteralPath $stdout -Raw)"
        Assert-True (@(Get-Process -Name 'Phevere' -ErrorAction SilentlyContinue).Count -eq 0) 'Headless audio left an application process running.'
        Assert-State
    } finally {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    }
}
function Remove-OwnedTree([string]$Target) {
    $resolved = [IO.Path]::GetFullPath($Target)
    Assert-True ($resolved.StartsWith($fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Refusing recursive deletion outside the fixture.'
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
function Assert-Components([bool]$Selected) {
    foreach ($link in $links) { Assert-True ((Test-Path -LiteralPath $link) -eq $Selected) "Unexpected shortcut state: $link" }
    $models = Join-Path $installRoot 'resources\ocr-models'
    Assert-True ((Test-Path -LiteralPath $models) -eq $Selected) 'The OCR model choice was not preserved.'
    $entry = Get-OwnedEntry
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($entry.Hive, $entry.View)
    try {
        $key = $base.OpenSubKey("Software\$guid")
        Assert-True ($null -ne $key) 'The installer did not save component choices.'
        try {
            $expected = if ($Selected) { '1' } else { '0' }
            foreach ($name in @('DesktopShortcut', 'StartMenuShortcut', 'OcrModels')) {
                Assert-True ([string]$key.GetValue($name, '') -eq $expected) "The installer did not persist $name=$expected."
            }
        } finally { $key.Dispose() }
    } finally { $base.Dispose() }
    if ($Selected) {
        Assert-True (@(Get-ChildItem -LiteralPath $models -Recurse -Filter '*.onnx').Count -gt 0) 'The OCR directory has no ONNX models.'
        $shell = New-Object -ComObject WScript.Shell
        foreach ($link in $links) {
            $target = $shell.CreateShortcut($link).TargetPath
            Assert-True ([IO.Path]::GetFullPath($target).StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'A shortcut points outside the fixture installation.'
        }
    }
}
function Assert-State {
    & node $stateHelper check $userData $fixtureHtml
    Assert-True ($LASTEXITCODE -eq 0) 'The notebook or monitor preferences were lost.'
    Invoke-Hidden $electronExe ('"' + $stateHelper + '" storage-check "' + $userData + '" "' + $fixtureHtml + '"')
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $userData 'monitor-settings.json')).Hash -eq $settingsHash) 'Monitor settings bytes changed.'
}
function Assert-Payload {
    $entry = Get-OwnedEntry
    Assert-True ($entry.Version -eq $version) "Expected registry version $version; found $($entry.Version)."
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $installRoot 'resources\app.asar')).Hash -eq (Get-FileHash -LiteralPath $PackagedAsar).Hash) 'The installed payload does not match the current packaged application.'
    Assert-True ((Get-FileHash -LiteralPath $appExe).Hash -eq (Get-FileHash -LiteralPath (Join-Path (Split-Path (Split-Path $PackagedAsar -Parent) -Parent) 'Phevere.exe')).Hash) 'The installed executable differs from the current packaged application.'
}

# Refuse any existing app, notebook, shortcut or legacy directory before touching the runner.
Assert-True (@(Get-Entries).Count -eq 0) 'Refusing to run with an existing Phevere installation.'
foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
        try {
            $key = $base.OpenSubKey("Software\$guid")
            if ($null -ne $key) { $key.Dispose(); throw 'Refusing an existing Phevere installation preferences key.' }
        } finally { $base.Dispose() }
    }
}
Assert-True (@(Get-Process -Name 'Phevere', 'phevere' -ErrorAction SilentlyContinue).Count -eq 0) 'Refusing to run with an existing Phevere process.'
Assert-True (-not (Test-Path -LiteralPath $userData)) 'Refusing to run with existing Phevere user data.'
foreach ($link in $links + @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Phevere.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'Phevere.lnk'), (Join-Path $programs 'thd2020'), (Join-Path $programs 'xiangyuxiao'))) {
    Assert-True (-not (Test-Path -LiteralPath $link)) "Refusing to touch an existing shortcut or legacy folder: $link"
}
foreach ($existingPath in @((Join-Path $env:ProgramFiles 'Phevere'), (Join-Path $env:LOCALAPPDATA 'Programs\Phevere'))) {
    Assert-True (-not (Test-Path -LiteralPath $existingPath)) "Refusing an existing Phevere installation folder: $existingPath"
}
Assert-True (Test-Path -LiteralPath $electronExe) 'Install npm dependencies before running this test.'
Assert-True ([IO.Path]::GetFullPath($fixtureRoot).StartsWith($runnerRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'The fixture must be under RUNNER_TEMP.'
$createdUserData = $false
try {
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    # Enumerate actual top-level HWNDs during packaged CLI execution, including
    # titled hidden windows. Electron message-only IPC HWNDs are excluded by EnumWindows.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class InstallerTestWindows {
    private delegate bool Callback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hwnd);
    public static bool HasApplicationWindow(int processId) {
        bool found = false;
        EnumWindows(delegate(IntPtr hwnd, IntPtr ignored) {
            uint owner; GetWindowThreadProcessId(hwnd, out owner);
            if (owner == processId && (IsWindowVisible(hwnd) || GetWindowTextLength(hwnd) > 0)) { found = true; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
    Set-Content -LiteralPath $fixtureHtml -Value '<!doctype html><title>Installer storage fixture</title>'
    Write-Host 'Installing the baseline into a custom path with spaces.'
    # NSIS /D must be last, with no quotes around its value.
    Invoke-Hidden $PreviousInstaller ("/S /D=$installRoot")
    $entry = Get-OwnedEntry
    Assert-True (Test-Path -LiteralPath $appExe) 'The baseline executable is missing.'
    $baselineVersion = (Get-Item -LiteralPath $PreviousInstaller).VersionInfo.ProductVersion
    Assert-True ($entry.Version -eq $baselineVersion) 'The baseline registry version differs from the installer version.'
    $createdUserData = $true
    & node $stateHelper seed $userData $fixtureHtml
    Assert-True ($LASTEXITCODE -eq 0) 'Could not create the notebook fixture.'
    Invoke-Hidden $electronExe ('"' + $stateHelper + '" storage-seed "' + $userData + '" "' + $fixtureHtml + '"')
    $settingsHash = (Get-FileHash -LiteralPath (Join-Path $userData 'monitor-settings.json')).Hash
    $databaseHash = (Get-FileHash -LiteralPath (Join-Path $userData 'phevere.sqlite')).Hash
    Set-Choices $entry 'legacy'
    foreach ($link in $links) { if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force } }
    Remove-OwnedTree (Join-Path $installRoot 'resources\ocr-models')
    # Corrupt only the fixture asar so the same-version test proves replacement.
    Add-Content -LiteralPath (Join-Path $installRoot 'resources\app.asar') -Value 'fixture: must be replaced'
    Add-Content -LiteralPath $appExe -Value 'fixture executable: must be replaced'
    Write-Host 'Replacing the baseline without /D; checking legacy opted-out components.'
    Invoke-Hidden $Installer '/S'
    Assert-Payload
    Assert-Components $false
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $userData 'phevere.sqlite')).Hash -eq $databaseHash) 'Installation modified the SQLite file.'
    Assert-State
    Write-Host 'Checking packaged headless audio commands and wrapper error propagation.'
    Assert-HeadlessAudio 'none' 0 'audio-model-complete'
    Assert-HeadlessAudio 'invalid' 1 'audio-model-error'
    Assert-HeadlessAudio '' 1 'audio-model-error'
    Invoke-Hidden $Installer '/S --desktop-shortcut=invalid' 2
    Assert-Payload
    Assert-Components $false
    Assert-State
    foreach ($choice in @('0', '1')) {
        Set-Choices (Get-OwnedEntry) $choice
        $running = Start-Process -FilePath $appExe -WindowStyle Hidden -PassThru
        Start-Sleep -Seconds 8
        $running.Refresh()
        Assert-True (-not $running.HasExited) 'The installed app exited before the running-app upgrade test.'
        Write-Host "Reinstalling the same version with saved component choice $choice while the app is running."
        Invoke-Hidden $Installer '/S'
        $running.Refresh()
        Assert-True $running.HasExited 'The installer did not close the old running app.'
        Assert-True (@(Get-Process -Name 'Phevere' -ErrorAction SilentlyContinue).Count -eq 0) 'A previous Phevere process survived the silent upgrade.'
        Assert-Payload
        Assert-Components ($choice -eq '1')
        Assert-State
    }
    # Exercise the same explicit switches that the WPF frontend sends. Saved
    # choices are deliberately opposite, so silent upgrade cannot pass by inference.
    foreach ($choice in @('0', '1')) {
        $opposite = if ($choice -eq '0') { '1' } else { '0' }
        Set-Choices (Get-OwnedEntry) $opposite
        Invoke-Hidden $Installer "/S --desktop-shortcut=$choice --start-menu-shortcut=$choice --ocr-models=$choice"
        Assert-Payload
        Assert-Components ($choice -eq '1')
        Assert-State
    }
    $entry = Get-OwnedEntry
    $uninstaller = $entry.Uninstall.Trim('"')
    Assert-True ([IO.Path]::GetFullPath($uninstaller).StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Refusing an uninstaller outside the fixture.'
    Write-Host 'Checking that normal uninstall preserves the notebook and preferences.'
    Invoke-Hidden $uninstaller '/S'
    # NSIS may hand off to its temporary uninstaller copy before the first process exits.
    $uninstallDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ((Test-Path -LiteralPath $appExe) -or @(Get-Entries).Count -gt 0) {
        if ([DateTime]::UtcNow -ge $uninstallDeadline) { throw 'Timed out waiting for normal uninstall to finish.' }
        Start-Sleep -Milliseconds 250
    }
    Assert-True (@(Get-Entries).Count -eq 0) 'Uninstall left a Phevere registry entry.'
    Assert-True (-not (Test-Path -LiteralPath $appExe)) 'Uninstall left the application executable.'
    foreach ($link in $links) { Assert-True (-not (Test-Path -LiteralPath $link)) 'Uninstall left a shortcut.' }
    Assert-State
    Write-Host 'PASS: upgrade, same-version replacement, running-app shutdown, component switches, wrapper exit propagation, headless audio, notebook, localStorage and uninstall preservation.'
} finally {
    # Stop only processes whose executable belongs to this fixture.
    foreach ($process in @(Get-Process -Name 'Phevere' -ErrorAction SilentlyContinue)) {
        if ($process.Path -and $process.Path.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $process.Id -Force }
    }
    $remaining = @(Get-Entries)
    if ($remaining.Count -eq 1 -and $remaining[0].Path -eq $installRoot) {
        $ownedUninstaller = $remaining[0].Uninstall.Trim('"')
        if (Test-Path -LiteralPath $ownedUninstaller) {
            try { Invoke-Hidden $ownedUninstaller '/S' } catch { Write-Warning "Fixture uninstall failed: $_" }
        }
    }
    if ($createdUserData -and (Test-Path -LiteralPath $userData)) {
        Assert-True ([IO.Path]::GetFullPath($userData) -eq [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'phevere'))) 'Unexpected fixture userData path.'
        Remove-Item -LiteralPath $userData -Recurse -Force
    }
    if (Test-Path -LiteralPath $fixtureRoot) {
        Assert-True ([IO.Path]::GetFullPath($fixtureRoot).StartsWith($runnerRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Refusing cleanup outside RUNNER_TEMP.'
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
