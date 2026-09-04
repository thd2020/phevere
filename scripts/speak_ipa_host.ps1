# Phevere — long-lived System.Speech host (one process, stdin commands).
# Node writes:  CULTURE en-US
#               SPEAK C:\path\to.ssml
# Host replies: OK   or   ERR <message>
# QUIT ends the process.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1

function Write-Reply([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

function Select-CultureVoice([string]$Culture) {
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
}

try { Select-CultureVoice 'en-US' } catch {}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }
  if ($line -eq 'QUIT') { break }
  if ($line.StartsWith('CULTURE ')) {
    try {
      Select-CultureVoice $line.Substring(8).Trim()
      Write-Reply 'OK'
    } catch {
      Write-Reply ('ERR ' + $_.Exception.Message)
    }
    continue
  }
  if ($line.StartsWith('SPEAK ')) {
    $ssmlPath = $line.Substring(6).Trim()
    try {
      if (-not (Test-Path -LiteralPath $ssmlPath)) { throw "Missing SSML $ssmlPath" }
      $ssml = [System.IO.File]::ReadAllText($ssmlPath, $utf8)
      if (-not $ssml.Trim()) { throw 'Empty SSML' }
      $synth.SpeakSsml($ssml)
      Write-Reply 'OK'
    } catch {
      Write-Reply ('ERR ' + ($_.Exception.Message -replace '[\r\n]+', ' '))
    }
    continue
  }
  Write-Reply 'ERR unknown command'
}
