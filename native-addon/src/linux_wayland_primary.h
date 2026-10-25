// Wayland PRIMARY selection watcher over ext-data-control-v1 (KWin ≥ 6.2,
// wlroots, COSMIC) or wlr-data-control-unstable-v1 (older KWin, Sway, Hyprland).
// GNOME/Mutter exposes neither; the caller falls back to X11.
#pragma once

#include <functional>
#include <string>

namespace phevere {

class WaylandPrimaryWatcher {
 public:
  using TextFn = std::function<void(const std::string&)>;

  WaylandPrimaryWatcher();
  ~WaylandPrimaryWatcher();

  // Connect and bind a data-control manager. False when unavailable.
  bool open();
  // fd to poll for readability; -1 before open().
  int fd() const;
  // Read and dispatch pending events. Calls onChange with the new PRIMARY text
  // (empty when cleared). False when the connection died.
  bool dispatch(const TextFn& onChange);
  // Flush outgoing requests before polling.
  void prepare();
  void close();
  const char* protocolName() const;

 private:
  struct Impl;
  Impl* impl_;
};

}  // namespace phevere
