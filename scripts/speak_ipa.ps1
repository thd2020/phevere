# Phevere — speak SAPI/IPA SSML through System.Speech (desktop voices honour phonemes).
# Usage: powershell -File speak_ipa.ps1 -SsmlPath <utf8-file> [-Culture en-US]
param(
  [Parameter(Mandatory = $true)][string]$SsmlPath,
  [string]$Culture = 'en-US'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$full = (Resolve-Path -LiteralPath $SsmlPath).Path
$ssml = [System.IO.File]::ReadAllText($full, [System.Text.UTF8Encoding]::new($false))
if (-not $ssml.Trim()) { throw 'Empty SSML' }

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo })
  $inCulture = @($voices | Where-Object { $_.Culture.Name -like ($Culture + '*') })
  if (-not $inCulture.Count) {
    $inCulture = @($voices | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq 'en' })
  }
  $pick = @($inCulture | Where-Object { $_.Name -match 'Desktop' } | Select-Object -First 1)
  if (-not $pick) {
    $pick = @($inCulture | Where-Object { $_.Name -notmatch 'OneCore|Mobile' } | Select-Object -First 1)
  }
  if (-not $pick -and $inCulture.Count) { $pick = $inCulture[0] }
  if ($pick) { $synth.SelectVoice($pick.Name) }
} catch {
  # keep default voice
}

$synth.Rate = -1
$synth.SpeakSsml($ssml)
