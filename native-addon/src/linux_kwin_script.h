// KWin script bridge for KDE Plasma Wayland.
//
// Wayland gives clients no global pointer position or active-window geometry,
// and Xwayland's copy goes stale once a native Wayland window has the pointer
// or focus. KWin knows both: a one-line KWin script evaluates an expression
// and calls back over D-Bus. Coordinates are KWin logical pixels (= Electron DIPs).
#pragma once

#include <string>

namespace phevere {

// True on Plasma with KWin's scripting interface on the session bus.
bool kwinScriptAvailable();
// Evaluate a KWin-script expression (stringified). Blocks up to timeoutMs.
bool kwinEval(const std::string& expression, int timeoutMs, std::string* out);
bool kwinCursorPos(int timeoutMs, int* x, int* y);
// Keep a KWin script running that reports every pointer move (hover lookup).
bool kwinWatchCursor(bool on);
// Latest pointer from the watch; false when not watching yet.
bool kwinWatchedCursor(int* x, int* y);
// Active window frame (x, y, width, height) and its pid. False when none.
bool kwinActiveWindow(int timeoutMs, int* x, int* y, int* w, int* h, int* pid);

}  // namespace phevere
