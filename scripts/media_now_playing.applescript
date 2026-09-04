-- Title<TAB>Artist<TAB>Album from Music or Spotify (paused still counts).
-- Same tab line as scripts/media_now_playing.ps1. Empty if nothing is loaded.
on tryMusic()
  try
    tell application "System Events"
      if not (exists process "Music") then return ""
    end tell
    tell application "Music"
      if player state is stopped then return ""
      return (name of current track) & tab & (artist of current track) & tab & (album of current track)
    end tell
  end try
  return ""
end tryMusic

on trySpotify()
  try
    tell application "System Events"
      if not (exists process "Spotify") then return ""
    end tell
    tell application "Spotify"
      if player state is stopped then return ""
      return (name of current track) & tab & (artist of current track) & tab & (album of current track)
    end tell
  end try
  return ""
end trySpotify

on run
  set fromMusic to tryMusic()
  if fromMusic is not "" then return fromMusic
  return trySpotify()
end run
