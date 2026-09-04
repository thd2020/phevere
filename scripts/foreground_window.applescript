-- DIP-ish bounds of the frontmost window that is not this process.
-- argv: skipPid (Electron main). Prints x<TAB>y<TAB>width<TAB>height or empty.
on run argv
  set skipPid to 0
  if (count of argv) > 0 then
    try
      set skipPid to item 1 of argv as integer
    end try
  end if
  try
    tell application "System Events"
      set p to first application process whose frontmost is true
      if unix id of p is skipPid then return ""
      tell p
        if (count of windows) is 0 then return ""
        set w to window 1
        set pos to position of w
        set sz to size of w
      end tell
      return (item 1 of pos as text) & tab & (item 2 of pos as text) & tab & (item 1 of sz as text) & tab & (item 2 of sz as text)
    end tell
  end try
  return ""
end run
