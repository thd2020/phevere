# Phevere — read Windows SMTC now-playing (Spotify, Edge, …)
# Prints: Title<TAB>Artist<TAB>Album  or empty line if none.

$ErrorActionPreference = 'Stop'
try {
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

  function Await-WinRt($WinRtTask, [Type]$ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
  }

  $mgr = Await-WinRt `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

  $session = $mgr.GetCurrentSession()
  if ($null -eq $session) {
    Write-Output ''
    exit 0
  }

  $props = Await-WinRt `
    ($session.TryGetMediaPropertiesAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])

  $title = [string]$props.Title
  $artist = [string]$props.Artist
  $album = [string]$props.AlbumTitle
  Write-Output ("{0}`t{1}`t{2}" -f $title, $artist, $album)
} catch {
  Write-Output ''
  exit 0
}
