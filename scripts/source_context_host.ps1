# Phevere: long-lived UI Automation reader for "where was this word saved".
# Node writes one JSON line per request:  {"id":1,"hwnd":123456,"kind":"browser","text":"word"}
# The host answers one JSON line:         {"id":1,"name":"...","url":"...","page":12,"paragraph":"..."}
# Every field is best effort and may be missing. Nothing here clicks, types or changes focus:
# it only reads the window Node names. QUIT ends the process.
#
#   -Probe   lists every visible browser and PDF reader window once and exits (used to test
#            which readers expose a URL, a page number or a selection).

param([switch]$Probe)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$Scope = [System.Windows.Automation.TreeScope]

function Prop-Cond($prop, $value) { New-Object System.Windows.Automation.PropertyCondition($prop, $value) }

$docCond = Prop-Cond $AE::ControlTypeProperty $CT::Document
$editCond = Prop-Cond $AE::ControlTypeProperty $CT::Edit
$textPatternCond = Prop-Cond $AE::IsTextPatternAvailableProperty $true

function Value-Of($el) {
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    return [string]$vp.Current.Value
  } catch { return '' }
}

# The page URL: Chromium (Chrome, Edge, Brave) gives it as the web document's value; Firefox and
# others as the value of the address bar.
function Find-Url($root) {
  try {
    $doc = $root.FindFirst($Scope::Descendants, $docCond)
    if ($doc) {
      $v = Value-Of $doc
      if ($v -match '^(https?|file)://') { return $v }
    }
  } catch {}
  try {
    $edits = $root.FindAll($Scope::Descendants, $editCond)
    $n = 0
    foreach ($e in $edits) {
      if (++$n -gt 12) { break }
      $name = [string]$e.Current.Name
      $aid = [string]$e.Current.AutomationId
      if ($name -match 'address|search bar|url|57305740' -or $aid -match 'urlbar|address') {
        $v = Value-Of $e
        if ($v -and $v -notmatch '\s') {
          if ($v -notmatch '^[a-z][a-z0-9+.-]*://') { $v = 'https://' + $v }
          return $v
        }
      }
    }
  } catch {}
  return ''
}

# The current page of a PDF reader: an edit box named like "Page number" holding digits.
function Find-Page($root) {
  try {
    $edits = $root.FindAll($Scope::Descendants, $editCond)
    $n = 0
    foreach ($e in $edits) {
      if (++$n -gt 60) { break }
      $name = [string]$e.Current.Name
      $aid = [string]$e.Current.AutomationId
      $v = (Value-Of $e).Trim()
      if ($v -match '^\d{1,5}$' -and ($name -match 'page|9875' -or $aid -match 'page')) { return [int]$v }
    }
    # SumatraPDF: an unnamed toolbar box with the page number, followed by "/ 777".
    $n = 0
    foreach ($e in $edits) {
      if (++$n -gt 60) { break }
      $v = (Value-Of $e).Trim()
      if ($v -match '^\d{1,5}$' -and [string]$e.Current.ClassName -eq 'Edit') { return [int]$v }
    }
  } catch {}
  return $null
}

# The paragraph (or line) holding the selection, from the first element with a non-empty
# TextPattern selection: the focused element when it belongs to this window, else the document.
function Find-Paragraph($root, $pid_) {
  $candidates = New-Object System.Collections.ArrayList
  try {
    $focused = $AE::FocusedElement
    if ($focused -and $focused.Current.ProcessId -eq $pid_) { [void]$candidates.Add($focused) }
  } catch {}
  try {
    $doc = $root.FindFirst($Scope::Descendants, $docCond)
    if ($doc) { [void]$candidates.Add($doc) }
  } catch {}
  foreach ($el in $candidates) {
    try {
      $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $sel = $tp.GetSelection()
      if (-not $sel -or $sel.Length -lt 1) { continue }
      $selected = $sel[0].GetText(200)
      if (-not $selected.Trim()) { continue }
      foreach ($unit in @([System.Windows.Automation.Text.TextUnit]::Paragraph, [System.Windows.Automation.Text.TextUnit]::Line)) {
        $r = $sel[0].Clone()
        $r.ExpandToEnclosingUnit($unit)
        $t = $r.GetText(1500)
        if ($t -and $t.Trim().Length -gt $selected.Trim().Length) { return @{ paragraph = $t; selected = $selected } }
      }
    } catch {}
  }
  return $null
}

function Read-Window([long]$hwnd, [string]$kind) {
  $out = [ordered]@{}
  $root = $AE::FromHandle([IntPtr]$hwnd)
  if (-not $root) { return $out }
  $out.name = [string]$root.Current.Name
  # A private window: read nothing more (Node checks the name again, in more languages).
  if ($kind -eq 'browser' -and $out.name -match 'Incognito|InPrivate|Private Browsing|\(Private\)') { return $out }
  $pid_ = $root.Current.ProcessId
  $url = ''
  if ($kind -eq 'browser' -or $kind -eq 'pdf') {
    $url = Find-Url $root
    if ($url) { $out.url = $url }
  }
  # A PDF reader, or a PDF open in a browser tab (Edge's and Chrome's viewers).
  if ($kind -eq 'pdf' -or $url -match '\.pdf($|[?#])') {
    $page = Find-Page $root
    if ($page) { $out.page = $page }
  }
  $para = Find-Paragraph $root $pid_
  if ($para) {
    $out.paragraph = $para.paragraph
    $out.selected = $para.selected
  }
  return $out
}

if ($Probe) {
  $browsers = 'chrome|msedge|firefox|brave|opera|vivaldi|arc'
  $readers = 'acrobat|acrord32|foxitpdfreader|foxitreader|foxitphantom|sumatrapdf|wps|wpspdf'
  foreach ($p in Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -match "^($browsers|$readers)$" }) {
    $kind = if ($p.ProcessName -match "^($browsers)$") { 'browser' } else { 'pdf' }
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try { $r = Read-Window ([long]$p.MainWindowHandle) $kind } catch { $r = @{ error = $_.Exception.Message } }
    $r.process = $p.ProcessName
    $r.title = $p.MainWindowTitle
    $r.ms = $sw.ElapsedMilliseconds
    if ($r.paragraph) { $r.paragraph = $r.paragraph.Substring(0, [Math]::Min(160, $r.paragraph.Length)) }
    [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress))
  }
  exit 0
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim() -eq 'QUIT') { break }
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $res = Read-Window ([long]$req.hwnd) ([string]$req.kind)
    $res.id = $id
  } catch {
    $res = @{ id = $id; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
