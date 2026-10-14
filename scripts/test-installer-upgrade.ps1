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
$customInstallRoot = Join-Path $fixtureRoot 'Custom install with spaces'
$installRoot = $customInstallRoot
$allowedHistoricalRoots = @((Join-Path $env:ProgramFiles 'Phevere'), (Join-Path $env:LOCALAPPDATA 'Programs\Phevere'))
if (${env:ProgramFiles(x86)}) { $allowedHistoricalRoots += Join-Path ${env:ProgramFiles(x86)} 'Phevere' }
# Old electron-builder backends parse /D through StdUtils and can stop at the
# first space. Accept only this exact derived fixture path, never a broad prefix.
$legacyTruncatedRoot = $customInstallRoot.Split(' ')[0]
if ([IO.Path]::GetFullPath($legacyTruncatedRoot).StartsWith($runnerRoot + '\', [StringComparison]::OrdinalIgnoreCase) -and $legacyTruncatedRoot -eq (Join-Path $runnerRoot 'Phevere')) {
    $allowedHistoricalRoots += $legacyTruncatedRoot
}
$ownedInstallRoots = @($customInstallRoot)
$appExe = Join-Path $installRoot 'Phevere.exe'
$stateHelper = Join-Path $PSScriptRoot 'test-installer-state.js'
$electronExe = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$fixtureHtml = Join-Path $fixtureRoot 'storage.html'
$desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
$programs = [Environment]::GetFolderPath('CommonPrograms')
$links = @((Join-Path $desktop 'Phevere.lnk'), (Join-Path $programs 'Phevere.lnk'), (Join-Path $programs 'Uninstall Phevere.lnk'))
$startupRegistryPath = 'Software\Microsoft\Windows\CurrentVersion\Run'
$startupFixtureCommand = $null

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-StartupCommand {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
    try {
        $key = $base.OpenSubKey($startupRegistryPath)
        if ($null -eq $key) { return $null }
        try { return $key.GetValue('Phevere', $null) } finally { $key.Dispose() }
    } finally { $base.Dispose() }
}
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
function Get-OwnedEntry([bool]$AllowHistoricalDefault = $false) {
    $entries = @(Get-Entries)
    Assert-True ($entries.Count -eq 1) "Expected one Phevere uninstall entry; found $($entries.Count)."
    $entry = $entries[0]
    Assert-True ($entry.Guid -eq $guid) 'The installer changed the stable application GUID.'
    $recordedRoot = [IO.Path]::GetFullPath($entry.Path).TrimEnd('\')
    Assert-True (($recordedRoot -eq $installRoot) -or ($AllowHistoricalDefault -and $recordedRoot -in $allowedHistoricalRoots)) "The installation path is '$recordedRoot'; expected '$installRoot'."
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
function Assert-FixtureProcessesStopped {
    # Electron's main-process handle can signal before its GPU/utility helpers
    # finish exiting. Give those owned processes a bounded teardown interval.
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $remaining = @(Get-Process -Name 'Phevere' -ErrorAction SilentlyContinue)
        if ($remaining.Count -eq 0) { return }
        if ([DateTime]::UtcNow -ge $deadline) {
            $details = @($remaining | ForEach-Object {
                $record = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue
                $commandLine = if ($null -ne $record) { $record.CommandLine } else { 'exited before diagnostic snapshot' }
                "PID=$($_.Id), path=$($_.Path), commandLine=$commandLine"
            })
            throw "Fixture application processes survived after ten seconds: $($details -join '; ')"
        }
        Start-Sleep -Milliseconds 100
    } while ($true)
}
function Assert-HeadlessAudio([string]$Model, [int]$ExpectedExitCode, [string]$ExpectedEvent) {
    $suffix = if ($Model) { $Model } else { 'empty' }
    $stdout = Join-Path $fixtureRoot "audio-$suffix.stdout"
    $stderr = Join-Path $fixtureRoot "audio-$suffix.stderr"
    $process = Start-Process -FilePath $appExe -ArgumentList "--install-audio-model=$Model" -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $null = $process.Handle
    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Min($TimeoutSeconds, 60))
    $helperWindows = @{}
    try {
        do {
            $windows = @([InstallerTestWindows]::ApplicationWindows($process.Id))
            Assert-True ($windows.Count -eq 0) "Audio CLI '$Model' opened a desktop window: $($windows -join '; ')"
            foreach ($helper in [InstallerTestWindows]::OwnedWindows($process.Id)) { $helperWindows[$helper] = $true }
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
        Assert-FixtureProcessesStopped
        if ($helperWindows.Count) { Write-Host "Headless audio '$Model' used only hidden helper windows: $($helperWindows.Keys -join '; ')" }
        Assert-State
    } finally {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    }
}
function Remove-OwnedTree([string]$Target) {
    $resolved = [IO.Path]::GetFullPath($Target)
    $owned = $resolved.StartsWith($fixtureRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    foreach ($ownedRoot in $ownedInstallRoots) {
        if ($resolved.StartsWith($ownedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { $owned = $true }
    }
    Assert-True $owned 'Refusing recursive deletion outside the confirmed fixture installations.'
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
function Invoke-OwnedUninstall {
    $entry = Get-OwnedEntry
    $uninstaller = $entry.Uninstall.Trim('"')
    Assert-True ([IO.Path]::GetFullPath($uninstaller).StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Refusing an uninstaller outside the confirmed fixture installation.'
    Invoke-Hidden $uninstaller '/S'
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ((Test-Path -LiteralPath $appExe) -or @(Get-Entries).Count -gt 0) {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Timed out waiting for normal uninstall to finish.' }
        Start-Sleep -Milliseconds 250
    }
    foreach ($link in $links) { Assert-True (-not (Test-Path -LiteralPath $link)) 'Uninstall left a shortcut.' }
    Assert-True ($null -eq (Get-StartupCommand)) 'Normal uninstall left the fixture startup command.'
    Assert-State
}

# Refuse any existing app, notebook, shortcut or legacy directory before touching the runner.
Assert-True (@(Get-Entries).Count -eq 0) 'Refusing to run with an existing Phevere installation.'
Assert-True ($null -eq (Get-StartupCommand)) 'Refusing to run with an existing Phevere startup entry.'
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
foreach ($existingPath in $allowedHistoricalRoots) {
    Assert-True (-not (Test-Path -LiteralPath $existingPath)) "Refusing an existing Phevere installation folder: $existingPath"
}
Assert-True (Test-Path -LiteralPath $electronExe) 'Install npm dependencies before running this test.'
Assert-True ([IO.Path]::GetFullPath($fixtureRoot).StartsWith($runnerRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'The fixture must be under RUNNER_TEMP.'
$createdUserData = $false
try {
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    # Detect visible top-level UI and hidden Electron BrowserWindows. Titled,
    # hidden COM/IPC helper HWNDs are infrastructure, not application windows.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class InstallerTestWindows {
    private delegate bool Callback(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
    public static string[] ApplicationWindows(int processId) {
        return InspectWindows(processId, false);
    }
    public static string[] OwnedWindows(int processId) {
        return InspectWindows(processId, true);
    }
    private static string[] InspectWindows(int processId, bool includeHelpers) {
        var windows = new List<string>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr ignored) {
            uint owner; GetWindowThreadProcessId(hwnd, out owner);
            if (owner != processId) return true;
            var className = new StringBuilder(256);
            var title = new StringBuilder(512);
            GetClassName(hwnd, className, className.Capacity);
            GetWindowText(hwnd, title, title.Capacity);
            bool visible = IsWindowVisible(hwnd);
            if (includeHelpers || visible || className.ToString() == "Chrome_WidgetWin_1") {
                windows.Add(String.Format("HWND=0x{0:X}, class={1}, title={2}, visible={3}", hwnd.ToInt64(), className, title, visible));
            }
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
'@
    Set-Content -LiteralPath $fixtureHtml -Value '<!doctype html><title>Installer storage fixture</title>'
    Write-Host 'Installing the baseline into a custom path with spaces.'
    # NSIS /D must be last, with no quotes around its value.
    Invoke-Hidden $PreviousInstaller ("/S /D=$installRoot")
    $entry = Get-OwnedEntry $true
    $recordedRoot = [IO.Path]::GetFullPath($entry.Path).TrimEnd('\')
    $baselineVersion = (Get-Item -LiteralPath $PreviousInstaller).VersionInfo.ProductVersion
    $baselineExe = Join-Path $recordedRoot 'Phevere.exe'
    Assert-True (Test-Path -LiteralPath $baselineExe) 'The registered baseline executable is missing.'
    Assert-True ((Get-Item -LiteralPath $baselineExe).VersionInfo.ProductVersion -eq $baselineVersion) 'The baseline executable version differs from the supplied installer.'
    $installRoot = $recordedRoot
    $appExe = $baselineExe
    $ownedInstallRoots += $recordedRoot
    Write-Host "The published baseline recorded '$installRoot'; its executable and version are verified."
    Assert-True (Test-Path -LiteralPath $appExe) 'The baseline executable is missing.'
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
    if ($installRoot -ne $customInstallRoot) {
        Write-Host 'Uninstalling the upgraded historical path, then installing the current wrapper at a custom path without deleting historical registry leftovers.'
        Invoke-OwnedUninstall
        $installRoot = $customInstallRoot
        $appExe = Join-Path $installRoot 'Phevere.exe'
        Invoke-Hidden $Installer "/S --desktop-shortcut=0 --start-menu-shortcut=0 --ocr-models=0 /D=$installRoot"
        Assert-Payload
        Assert-Components $false
        Assert-State
    }
    # Seed the exact current-user startup command written by the setup frontend.
    # Its absence was verified before installation; ownership is the exact path.
    $startupFixtureCommand = '"' + $appExe + '"'
    $startupBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
    try {
        $startupKey = $startupBase.CreateSubKey($startupRegistryPath)
        try { $startupKey.SetValue('Phevere', $startupFixtureCommand, [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $startupKey.Dispose() }
    } finally { $startupBase.Dispose() }
    foreach ($choice in @('0', '1')) {
        Set-Choices (Get-OwnedEntry) $choice
        $startupStdout = Join-Path $fixtureRoot "startup-choice-$choice.stdout"
        $startupStderr = Join-Path $fixtureRoot "startup-choice-$choice.stderr"
        $running = Start-Process -FilePath $appExe -WindowStyle Hidden -PassThru -RedirectStandardOutput $startupStdout -RedirectStandardError $startupStderr
        $null = $running.Handle
        Start-Sleep -Seconds 8
        $running.Refresh()
        if ($running.HasExited) {
            $running.WaitForExit()
            Write-Host "Installed startup failed: PID=$($running.Id), exitCode=$($running.ExitCode), executable=$appExe"
            foreach ($logPath in @($startupStdout, $startupStderr, (Join-Path $userData 'diagnostics\lifecycle.jsonl'))) {
                if (Test-Path -LiteralPath $logPath) {
                    Write-Host "Fixture startup evidence: $logPath"
                    Get-Content -LiteralPath $logPath -Tail 80 | ForEach-Object { Write-Host $_ }
                }
            }
            throw "The installed app exited before the running-app upgrade test (exitCode=$($running.ExitCode))."
        }
        Write-Host "Reinstalling the same version with saved component choice $choice while the app is running."
        Invoke-Hidden $Installer '/S'
        $running.Refresh()
        Assert-True $running.HasExited 'The installer did not close the old running app.'
        Assert-FixtureProcessesStopped
        Assert-Payload
        Assert-Components ($choice -eq '1')
        Assert-True ((Get-StartupCommand) -ceq $startupFixtureCommand) 'Same-version replacement removed or changed the startup command.'
        Assert-State
    }
    # Exercise the same explicit switches that the WPF frontend sends. Saved
    # choices are deliberately opposite, so silent upgrade cannot pass by inference.
    foreach ($choice in @('0', '1')) {
        $opposite = if ($choice -eq '0') { '1' } else { '0' }
        Set-Choices (Get-OwnedEntry) $opposite
        # Match the frontend exactly: the final --ocr-models option is followed
        # by an unquoted, space-containing NSIS /D path.
        Invoke-Hidden $Installer "/S --desktop-shortcut=$choice --start-menu-shortcut=$choice --ocr-models=$choice /D=$installRoot"
        Assert-Payload
        Assert-Components ($choice -eq '1')
        Assert-True ((Get-StartupCommand) -ceq $startupFixtureCommand) 'Explicit component replacement removed or changed the startup command.'
        Assert-State
    }
    Write-Host 'Checking that normal uninstall preserves the notebook and preferences.'
    Invoke-OwnedUninstall
    Assert-True (@(Get-Entries).Count -eq 0) 'Uninstall left a Phevere registry entry.'
    Assert-True (-not (Test-Path -LiteralPath $appExe)) 'Uninstall left the application executable.'
    foreach ($link in $links) { Assert-True (-not (Test-Path -LiteralPath $link)) 'Uninstall left a shortcut.' }
    Assert-State
    Write-Host 'PASS: upgrade, same-version replacement, running-app shutdown, component switches, startup lifecycle, wrapper exit propagation, headless audio, notebook, localStorage and uninstall preservation.'
} finally {
    # Stop only processes whose executable belongs to this fixture.
    foreach ($process in @(Get-Process -Name 'Phevere' -ErrorAction SilentlyContinue)) {
        if ($process.Path -and $process.Path.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { Stop-Process -Id $process.Id -Force }
    }
    $remaining = @(Get-Entries)
    if ($remaining.Count -eq 1 -and $remaining[0].Path -in $ownedInstallRoots) {
        $ownedUninstaller = $remaining[0].Uninstall.Trim('"')
        if (Test-Path -LiteralPath $ownedUninstaller) {
            try { Invoke-Hidden $ownedUninstaller '/S' } catch { Write-Warning "Fixture uninstall failed: $_" }
        }
    }
    if ($startupFixtureCommand -and (Get-StartupCommand) -ceq $startupFixtureCommand) {
        $startupBase = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
        try {
            $startupKey = $startupBase.OpenSubKey($startupRegistryPath, $true)
            if ($null -ne $startupKey) {
                try { $startupKey.DeleteValue('Phevere', $false) } finally { $startupKey.Dispose() }
            }
        } finally { $startupBase.Dispose() }
    }
    # The historical installer wrote phantom preferences into other hives/views.
    # Every GUID key was absent at preflight; remove only keys with our own paths,
    # and only in final cleanup after all observable upgrade assertions have run.
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
            try {
                $key = $base.OpenSubKey("Software\$guid")
                if ($null -ne $key) {
                    $location = [string]$key.GetValue('InstallLocation', '')
                    $key.Dispose()
                    if ($location -in ($ownedInstallRoots + $allowedHistoricalRoots)) { $base.DeleteSubKeyTree("Software\$guid", $false) }
                    else { Write-Warning "Refusing to clean an unexpected fixture registry path: $location" }
                }
            } finally { $base.Dispose() }
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
