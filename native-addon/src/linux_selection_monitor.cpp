/**
 * Linux selection backend.
 *
 * Windows uses UI Automation and macOS uses AX. On Linux every toolkit (GTK, Qt,
 * Chromium/Electron, Firefox, terminals) publishes a drag or double-click
 * selection as the X11 PRIMARY selection, and password fields never do. So:
 *   - XFixes SelectionNotify on PRIMARY (event-driven, no polling) on our own
 *     X connection. Under a Wayland session this is Xwayland, which bridges
 *     native Wayland selections into PRIMARY on KWin, wlroots and Mutter.
 *   - After an owner change, re-read PRIMARY until the text is stable for
 *     500ms and no mouse button is held (the native debounce Win/Mac also use).
 *   - Callback (text, x, y) with the pointer in physical root-window pixels.
 *   - getWordAtPoint: AT-SPI2 (accessible at point -> text offset -> WORD),
 *     the Linux twin of UIA RangeFromPoint. Turns on org.a11y.Status first.
 *     Call it only outside Electron's process: Chromium's ATK bridge shares
 *     libatspi there and crashes. index.js runs it in a helper child process.
 *
 * Build: OS=='linux' target `linux_selection_monitor` in binding.gyp.
 * Env: PHEVERE_DEBUG_LINUX_SEL=1
 */

#include <napi.h>

#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/extensions/Xfixes.h>

#include <atspi/atspi.h>
#include <gio/gio.h>

#include "linux_kwin_script.h"
#include "linux_wayland_primary.h"

#include <dlfcn.h>
#include <poll.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>

namespace {

static constexpr int kDebounceDelayMs = 500;
static constexpr int kRereadIntervalMs = 100;
static constexpr int kTrackWindowMs = 8000;
static constexpr int kConvertTimeoutMs = 400;
static constexpr size_t kMaxSelectionBytes = 8000;
static constexpr int kWordAtPointMaxChars = 64;

using Clock = std::chrono::steady_clock;

static bool debugEnabled() {
  static int cached = -1;
  if (cached < 0) {
    const char* v = std::getenv("PHEVERE_DEBUG_LINUX_SEL");
    cached = (v && std::string(v) == "1") ? 1 : 0;
  }
  return cached == 1;
}

static void selLog(const std::string& msg) {
  if (debugEnabled()) std::cout << "[LINUX-SEL] " << msg << std::endl;
}

static int msSince(Clock::time_point t) {
  return static_cast<int>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t).count());
}

/** Synchronous PRIMARY read on a given display + requestor window. */
static bool readPrimary(Display* dpy, Window win, Atom prop, std::string* out) {
  const Atom primary = XA_PRIMARY;
  const Atom utf8 = XInternAtom(dpy, "UTF8_STRING", False);
  const Atom incr = XInternAtom(dpy, "INCR", False);
  out->clear();
  if (XGetSelectionOwner(dpy, primary) == None) return false;

  for (Atom target : {utf8, static_cast<Atom>(XA_STRING)}) {
    XDeleteProperty(dpy, win, prop);
    XConvertSelection(dpy, primary, target, prop, win, CurrentTime);
    XFlush(dpy);

    const auto started = Clock::now();
    bool got = false;
    bool refused = false;
    while (!got && !refused && msSince(started) < kConvertTimeoutMs) {
      XEvent ev;
      if (XCheckTypedWindowEvent(dpy, win, SelectionNotify, &ev)) {
        if (ev.xselection.property == None) refused = true;
        else got = true;
        break;
      }
      struct pollfd pfd = {ConnectionNumber(dpy), POLLIN, 0};
      poll(&pfd, 1, 20);
    }
    if (!got) continue;

    Atom actualType = None;
    int actualFormat = 0;
    unsigned long nitems = 0, bytesAfter = 0;
    unsigned char* data = nullptr;
    const long maxLongs = static_cast<long>(kMaxSelectionBytes / 4 + 1);
    if (XGetWindowProperty(dpy, win, prop, 0, maxLongs, True, AnyPropertyType, &actualType,
                           &actualFormat, &nitems, &bytesAfter, &data) != Success) {
      continue;
    }
    if (actualType == incr) {
      // Huge selection (≥ ~256 KB). Not a lookup; skip.
      if (data) XFree(data);
      return false;
    }
    if (data && actualFormat == 8 && nitems > 0) {
      out->assign(reinterpret_cast<char*>(data), nitems);
      XFree(data);
      if (bytesAfter > 0) return false;  // longer than any lookup we keep
      return true;
    }
    if (data) XFree(data);
  }
  return false;
}

enum class Backend { Off, Wayland, X11 };

static const char* backendName(Backend b) {
  switch (b) {
    case Backend::Wayland: return "wayland";
    case Backend::X11: return "x11";
    default: return "none";
  }
}

/** Debounce shared by both backends: stable for 500ms, no button held. */
struct Settle {
  static constexpr int kSameTextAgainMs = 1500;
  std::string current;
  std::string lastEmitted;
  bool tracking = false;
  bool reselected = false;  // a new selection owner, even if the text is the same
  Clock::time_point trackStart{};
  Clock::time_point lastChange{};
  Clock::time_point lastEmitAt{};

  void seed(const std::string& text) {
    current = text;
    lastEmitted = text;
  }
  void changed() {
    if (!tracking) trackStart = Clock::now();
    tracking = true;
    reselected = true;
    lastChange = Clock::now();
  }
  /** A new selection (Wayland offer / X owner change) holding `t`. */
  void selected(const std::string& t) {
    current = t;
    changed();
  }
  void text(const std::string& t) {
    if (t != current) {
      current = t;
      changed();
    }
  }
  // Returns true when `current` should be emitted now.
  bool due(bool buttonDown) {
    if (!tracking) return false;
    if (buttonDown) lastChange = Clock::now();
    if (msSince(lastChange) >= kDebounceDelayMs) {
      tracking = false;
      // Selecting the same word again later opens it again (as on Windows);
      // a quick re-assert of the same PRIMARY does not.
      const bool again = reselected && current == lastEmitted && msSince(lastEmitAt) >= kSameTextAgainMs;
      reselected = false;
      if (!current.empty() && (current != lastEmitted || again)) {
        lastEmitted = current;
        lastEmitAt = Clock::now();
        return true;
      }
    } else if (msSince(trackStart) > kTrackWindowMs && !buttonDown) {
      tracking = false;
    }
    return false;
  }
};

class LinuxSelectionMonitor {
 public:
  // space: "physical" (X11 root pixels), "dip" (KWin logical), "none" (unknown).
  using Callback = std::function<void(std::string, int, int, std::string)>;

  ~LinuxSelectionMonitor() { stop(); }

  void set_callback(Callback cb) {
    std::lock_guard<std::mutex> lock(cb_mutex_);
    callback_ = std::move(cb);
  }

  Backend backend() const { return backend_; }
  const char* protocol() const { return protocol_.c_str(); }

  bool start() {
    if (running_) return true;
    const char* modeEnv = std::getenv("PHEVERE_LINUX_SELECTION");
    const std::string mode = modeEnv ? modeEnv : "auto";
    const char* wl = std::getenv("WAYLAND_DISPLAY");

    backend_ = Backend::Off;
    if (mode != "x11" && wl && *wl) {
      wayland_ = new phevere::WaylandPrimaryWatcher();
      if (wayland_->open()) {
        backend_ = Backend::Wayland;
        protocol_ = wayland_->protocolName();
      } else {
        delete wayland_;
        wayland_ = nullptr;
        selLog("no Wayland data-control manager (GNOME?)");
      }
    }
    if (backend_ == Backend::Off && mode != "wayland") {
      Display* probe = XOpenDisplay(nullptr);
      if (probe) {
        int evBase = 0, errBase = 0;
        if (XFixesQueryExtension(probe, &evBase, &errBase)) {
          backend_ = Backend::X11;
          protocol_ = "xfixes";
        }
        XCloseDisplay(probe);
      } else {
        selLog("XOpenDisplay failed (no DISPLAY / Xwayland)");
      }
    }
    if (backend_ == Backend::Off) return false;
    if (pipe(wake_) != 0) {
      closeWayland();
      backend_ = Backend::Off;
      return false;
    }
    running_ = true;
    worker_ = std::thread([this] {
      if (backend_ == Backend::Wayland) runWayland();
      else runX11();
    });
    return true;
  }

  void stop() {
    if (!running_) return;
    running_ = false;
    const char b = 'q';
    if (write(wake_[1], &b, 1) < 0) {
    }
    if (worker_.joinable()) worker_.join();
    close(wake_[0]);
    close(wake_[1]);
    closeWayland();
  }

  std::string get_current_selection() {
    if (backend_ == Backend::Wayland && running_) {
      std::lock_guard<std::mutex> lock(text_mutex_);
      return latest_;
    }
    Display* dpy = XOpenDisplay(nullptr);
    if (!dpy) return {};
    Window win = XCreateSimpleWindow(dpy, DefaultRootWindow(dpy), -10, -10, 1, 1, 0, 0, 0);
    Atom prop = XInternAtom(dpy, "PHEVERE_SEL_SYNC", False);
    std::string text;
    readPrimary(dpy, win, prop, &text);
    XDestroyWindow(dpy, win);
    XCloseDisplay(dpy);
    return text;
  }

 private:
  void closeWayland() {
    if (wayland_) {
      wayland_->close();
      delete wayland_;
      wayland_ = nullptr;
    }
  }

  void emit(const std::string& text, int x, int y, const char* space) {
    selLog("emit \"" + text.substr(0, 60) + "\" @ " + std::to_string(x) + "," + std::to_string(y) + " " + space);
    Callback cb;
    {
      std::lock_guard<std::mutex> lock(cb_mutex_);
      cb = callback_;
    }
    if (cb) cb(text, x, y, space);
  }

  static bool queryPointer(Display* dpy, int* x, int* y, bool* buttonDown) {
    if (!dpy) return false;
    Window rr, cr;
    int wx = 0, wy = 0;
    unsigned int mask = 0;
    if (!XQueryPointer(dpy, DefaultRootWindow(dpy), &rr, &cr, x, y, &wx, &wy, &mask)) return false;
    *buttonDown = (mask & (Button1Mask | Button2Mask | Button3Mask)) != 0;
    return true;
  }

  void runWayland() {
    selLog(std::string("Wayland PRIMARY watch started (") + protocol_ + ")");
    // Xwayland, when present, only for button state over X11 windows.
    Display* xdpy = XOpenDisplay(nullptr);
    const bool kwin = phevere::kwinScriptAvailable();
    Settle settle;
    bool seeded = false;
    auto onText = [&](const std::string& t) {
      {
        std::lock_guard<std::mutex> lock(text_mutex_);
        latest_ = t;
      }
      if (!seeded) {
        seeded = true;
        settle.seed(t);
        return;
      }
      selLog("PRIMARY changed");
      settle.selected(t);
    };
    // Initial primary_selection from open() seeds without emitting.
    wayland_->dispatch(onText);
    seeded = true;

    while (running_) {
      wayland_->prepare();
      struct pollfd fds[2] = {{wayland_->fd(), POLLIN, 0}, {wake_[0], POLLIN, 0}};
      poll(fds, 2, settle.tracking ? kRereadIntervalMs : -1);
      if (!running_) break;
      if (!wayland_->dispatch(onText)) {
        selLog("Wayland connection lost; reconnecting");
        wayland_->close();
        while (running_ && !wayland_->open()) {
          struct pollfd w = {wake_[0], POLLIN, 0};
          poll(&w, 1, 2000);
        }
        if (!running_) break;
        seeded = false;
        wayland_->dispatch(onText);
        seeded = true;
        continue;
      }
      int px = 0, py = 0;
      bool down = false;
      const bool haveX = queryPointer(xdpy, &px, &py, &down);
      if (settle.due(down)) {
        int kx = 0, ky = 0;
        if (kwin && phevere::kwinCursorPos(150, &kx, &ky)) emit(settle.current, kx, ky, "dip");
        else if (haveX) emit(settle.current, px, py, "none");
        else emit(settle.current, 0, 0, "none");
      }
    }
    if (xdpy) XCloseDisplay(xdpy);
    selLog("Wayland PRIMARY watch stopped");
  }

  void runX11() {
    Display* dpy = XOpenDisplay(nullptr);
    if (!dpy) {
      running_ = false;
      return;
    }
    int evBase = 0, errBase = 0;
    XFixesQueryExtension(dpy, &evBase, &errBase);
    const Window root = DefaultRootWindow(dpy);
    const Window win = XCreateSimpleWindow(dpy, root, -10, -10, 1, 1, 0, 0, 0);
    const Atom prop = XInternAtom(dpy, "PHEVERE_SEL", False);
    XFixesSelectSelectionInput(dpy, root, XA_PRIMARY, XFixesSetSelectionOwnerNotifyMask);
    XFlush(dpy);
    selLog("XFixes PRIMARY watch started");

    // Seed with whatever PRIMARY holds now, so a stale selection never fires on start.
    Settle settle;
    std::string seed;
    readPrimary(dpy, win, prop, &seed);
    settle.seed(seed);
    Clock::time_point lastRead{};

    while (running_) {
      struct pollfd fds[2] = {{ConnectionNumber(dpy), POLLIN, 0}, {wake_[0], POLLIN, 0}};
      if (XPending(dpy) == 0) poll(fds, 2, settle.tracking ? kRereadIntervalMs : -1);
      if (!running_) break;

      while (XPending(dpy) > 0) {
        XEvent ev;
        XNextEvent(dpy, &ev);
        if (ev.type == evBase + XFixesSelectionNotify) {
          auto* sn = reinterpret_cast<XFixesSelectionNotifyEvent*>(&ev);
          if (sn->owner == win) continue;
          selLog("PRIMARY owner changed");
          settle.changed();
          lastRead = Clock::time_point{};
        }
      }
      if (!settle.tracking) continue;

      // Some toolkits keep ownership while the selection grows: re-read.
      if (msSince(lastRead) >= kRereadIntervalMs) {
        lastRead = Clock::now();
        std::string text;
        readPrimary(dpy, win, prop, &text);
        settle.text(text);
      }

      int rx = 0, ry = 0;
      bool down = false;
      queryPointer(dpy, &rx, &ry, &down);
      if (settle.due(down)) emit(settle.current, rx, ry, "physical");
    }

    XFixesSelectSelectionInput(dpy, root, XA_PRIMARY, 0);
    XDestroyWindow(dpy, win);
    XCloseDisplay(dpy);
    selLog("XFixes PRIMARY watch stopped");
  }

  std::atomic<bool> running_{false};
  Backend backend_ = Backend::Off;
  std::string protocol_ = "none";
  phevere::WaylandPrimaryWatcher* wayland_ = nullptr;
  std::thread worker_;
  int wake_[2] = {-1, -1};
  std::mutex cb_mutex_;
  Callback callback_;
  std::mutex text_mutex_;
  std::string latest_;
};

// ---------------------------------------------------------------- active window

struct WindowBox {
  int x = 0, y = 0, w = 0, h = 0, pid = 0;
};

static unsigned long windowCardinal(Display* dpy, Window win, const char* name, unsigned long* out, int count) {
  Atom prop = XInternAtom(dpy, name, True);
  if (prop == 0) return 0;
  Atom type = 0;
  int format = 0;
  unsigned long n = 0, after = 0;
  unsigned char* data = nullptr;
  if (XGetWindowProperty(dpy, win, prop, 0, count, False, AnyPropertyType, &type, &format, &n, &after, &data) !=
          Success ||
      !data) {
    return 0;
  }
  unsigned long got = 0;
  if (format == 32) {
    auto* longs = reinterpret_cast<unsigned long*>(data);
    for (; got < n && static_cast<int>(got) < count; ++got) out[got] = longs[got];
  }
  XFree(data);
  return got;
}

/** EWMH _NET_ACTIVE_WINDOW frame in X root pixels (X11 sessions / X11 apps). */
static bool x11ActiveWindow(WindowBox* box) {
  Display* dpy = XOpenDisplay(nullptr);
  if (!dpy) return false;
  bool ok = false;
  const Window root = DefaultRootWindow(dpy);
  unsigned long active = 0;
  if (windowCardinal(dpy, root, "_NET_ACTIVE_WINDOW", &active, 1) == 1 && active) {
    Window child;
    int x = 0, y = 0;
    XWindowAttributes attrs;
    if (XGetWindowAttributes(dpy, active, &attrs) &&
        XTranslateCoordinates(dpy, active, root, 0, 0, &x, &y, &child)) {
      unsigned long ext[4] = {0, 0, 0, 0};  // left, right, top, bottom decorations
      windowCardinal(dpy, active, "_NET_FRAME_EXTENTS", ext, 4);
      box->x = x - static_cast<int>(ext[0]);
      box->y = y - static_cast<int>(ext[2]);
      box->w = attrs.width + static_cast<int>(ext[0] + ext[1]);
      box->h = attrs.height + static_cast<int>(ext[2] + ext[3]);
      unsigned long pid = 0;
      if (windowCardinal(dpy, active, "_NET_WM_PID", &pid, 1) == 1) box->pid = static_cast<int>(pid);
      ok = box->w > 0 && box->h > 0;
    }
  }
  XCloseDisplay(dpy);
  return ok;
}

// ---------------------------------------------------------------- AT-SPI word

static bool g_atspiReady = false;

/** Same switch Orca flips: toolkits only expose text once the a11y bus says so. */
static void enableAccessibilityBus() {
  GError* err = nullptr;
  GDBusConnection* bus = g_bus_get_sync(G_BUS_TYPE_SESSION, nullptr, &err);
  if (!bus) {
    if (err) g_error_free(err);
    return;
  }
  // IsEnabled only; ScreenReaderEnabled would change how apps behave.
  GVariant* r = g_dbus_connection_call_sync(
      bus, "org.a11y.Bus", "/org/a11y/bus", "org.freedesktop.DBus.Properties", "Set",
      g_variant_new("(ssv)", "org.a11y.Status", "IsEnabled", g_variant_new_boolean(TRUE)), nullptr,
      G_DBUS_CALL_FLAGS_NONE, 500, nullptr, &err);
  if (r) g_variant_unref(r);
  if (err) {
    selLog(std::string("a11y enable failed: ") + err->message);
    g_error_free(err);
  }
  g_object_unref(bus);
}

static bool ensureAtspi() {
  if (g_atspiReady) return true;
  const char* off = std::getenv("PHEVERE_DISABLE_ATSPI");
  if (off && std::string(off) == "1") return false;
  enableAccessibilityBus();
  const int rc = atspi_init();
  if (rc != 0 && rc != 1) return false;  // 1 = already initialised
  atspi_set_timeout(250, 1000);
  g_atspiReady = true;
  return true;
}

static bool containsPoint(AtspiAccessible* acc, int x, int y) {
  AtspiComponent* comp = atspi_accessible_get_component_iface(acc);
  if (!comp) return false;
  GError* err = nullptr;
  gboolean in = atspi_component_contains(comp, x, y, ATSPI_COORD_TYPE_SCREEN, &err);
  if (err) g_error_free(err);
  g_object_unref(comp);
  return in;
}

static bool isShowing(AtspiAccessible* acc) {
  AtspiStateSet* states = atspi_accessible_get_state_set(acc);
  if (!states) return false;
  const bool showing = atspi_state_set_contains(states, ATSPI_STATE_SHOWING) &&
                       atspi_state_set_contains(states, ATSPI_STATE_VISIBLE);
  g_object_unref(states);
  return showing;
}

/** Deepest accessible under (x, y), searching visible top-level frames. Caller unrefs. */
static AtspiAccessible* accessibleAtPoint(int x, int y) {
  AtspiAccessible* desktop = atspi_get_desktop(0);
  if (!desktop) return nullptr;
  GError* err = nullptr;
  const gint apps = atspi_accessible_get_child_count(desktop, &err);
  if (err) {
    g_error_free(err);
    err = nullptr;
  }
  const pid_t self = getpid();
  AtspiAccessible* hit = nullptr;
  for (gint a = 0; a < apps && !hit; ++a) {
    AtspiAccessible* app = atspi_accessible_get_child_at_index(desktop, a, &err);
    if (err) {
      g_error_free(err);
      err = nullptr;
    }
    if (!app) continue;
    const guint pid = atspi_accessible_get_process_id(app, nullptr);
    if (static_cast<pid_t>(pid) == self) {
      g_object_unref(app);
      continue;
    }
    const gint wins = atspi_accessible_get_child_count(app, nullptr);
    for (gint w = 0; w < wins && !hit; ++w) {
      AtspiAccessible* frame = atspi_accessible_get_child_at_index(app, w, nullptr);
      if (!frame) continue;
      if (isShowing(frame) && containsPoint(frame, x, y)) {
        AtspiAccessible* cur = frame;
        g_object_ref(cur);
        for (int depth = 0; depth < 40; ++depth) {
          AtspiComponent* comp = atspi_accessible_get_component_iface(cur);
          if (!comp) break;
          AtspiAccessible* child =
              atspi_component_get_accessible_at_point(comp, x, y, ATSPI_COORD_TYPE_SCREEN, nullptr);
          g_object_unref(comp);
          if (!child || child == cur) {
            if (child) g_object_unref(child);
            break;
          }
          g_object_unref(cur);
          cur = child;
        }
        hit = cur;
      }
      g_object_unref(frame);
    }
    g_object_unref(app);
  }
  g_object_unref(desktop);
  return hit;
}

struct WordResult {
  std::string text;
  int x = 0, y = 0;
  bool hasBounds = false;
  int bx = 0, by = 0, bw = 0, bh = 0;
};

static WordResult wordAtPoint(int x, int y) {
  WordResult out;
  out.x = x;
  out.y = y;
  if (!ensureAtspi()) return out;
  AtspiAccessible* acc = accessibleAtPoint(x, y);
  if (!acc) return out;

  AtspiRole role = atspi_accessible_get_role(acc, nullptr);
  if (role == ATSPI_ROLE_PASSWORD_TEXT) {
    g_object_unref(acc);
    return out;
  }
  AtspiText* text = atspi_accessible_get_text_iface(acc);
  if (!text) {
    g_object_unref(acc);
    return out;
  }
  GError* err = nullptr;
  const gint offset = atspi_text_get_offset_at_point(text, x, y, ATSPI_COORD_TYPE_SCREEN, &err);
  if (err || offset < 0) {
    if (err) g_error_free(err);
    g_object_unref(text);
    g_object_unref(acc);
    return out;
  }
  AtspiTextRange* range =
      atspi_text_get_string_at_offset(text, offset, ATSPI_TEXT_GRANULARITY_WORD, &err);
  if (err) {
    g_error_free(err);
    err = nullptr;
  }
  if (range && range->content) {
    std::string word(range->content);
    // Trim surrounding whitespace/punctuation the toolkit includes with the word.
    const char* ws = " \t\r\n";
    const size_t b = word.find_first_not_of(ws);
    const size_t e = word.find_last_not_of(ws);
    word = (b == std::string::npos) ? std::string() : word.substr(b, e - b + 1);
    if (g_utf8_strlen(word.c_str(), -1) <= kWordAtPointMaxChars) out.text = word;

    AtspiRect* rect = atspi_text_get_range_extents(text, range->start_offset, range->end_offset,
                                                   ATSPI_COORD_TYPE_SCREEN, &err);
    if (err) {
      g_error_free(err);
      err = nullptr;
    }
    if (rect) {
      if (rect->width > 0 && rect->height > 0) {
        out.hasBounds = true;
        out.bx = rect->x;
        out.by = rect->y;
        out.bw = rect->width;
        out.bh = rect->height;
        out.x = rect->x + rect->width / 2;
        out.y = rect->y + rect->height;
      }
      g_free(rect);
    }
  }
  if (range) {
    g_free(range->content);
    g_free(range);
  }
  g_object_unref(text);
  g_object_unref(acc);
  return out;
}

// ---------------------------------------------------------------- N-API

class LinuxSelectionMonitorWrapper : public Napi::ObjectWrap<LinuxSelectionMonitorWrapper> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "LinuxSelectionMonitor", {
        InstanceMethod("start", &LinuxSelectionMonitorWrapper::Start),
        InstanceMethod("stop", &LinuxSelectionMonitorWrapper::Stop),
        InstanceMethod("getCurrentSelection", &LinuxSelectionMonitorWrapper::GetCurrentSelection),
        InstanceMethod("setCallback", &LinuxSelectionMonitorWrapper::SetCallback),
        InstanceMethod("testFocusedElement", &LinuxSelectionMonitorWrapper::TestFocusedElement),
        InstanceMethod("getWordAtPoint", &LinuxSelectionMonitorWrapper::GetWordAtPoint),
        InstanceMethod("isTrusted", &LinuxSelectionMonitorWrapper::IsTrusted),
        InstanceMethod("getBackend", &LinuxSelectionMonitorWrapper::GetBackend),
        InstanceMethod("getCursorPos", &LinuxSelectionMonitorWrapper::GetCursorPos),
        InstanceMethod("getActiveWindow", &LinuxSelectionMonitorWrapper::GetActiveWindow),
        InstanceMethod("getModulePath", &LinuxSelectionMonitorWrapper::GetModulePath),
        InstanceMethod("watchCursor", &LinuxSelectionMonitorWrapper::WatchCursor),
        InstanceMethod("getWatchedCursor", &LinuxSelectionMonitorWrapper::GetWatchedCursor),
    });
    exports.Set("LinuxSelectionMonitor", func);
    return exports;
  }

  LinuxSelectionMonitorWrapper(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<LinuxSelectionMonitorWrapper>(info), monitor_(new LinuxSelectionMonitor()) {}

  ~LinuxSelectionMonitorWrapper() {
    delete monitor_;
    if (has_tsfn_) callback_tsfn_.Release();
  }

 private:
  LinuxSelectionMonitor* monitor_;
  Napi::ThreadSafeFunction callback_tsfn_;
  bool has_tsfn_ = false;

  Napi::Value Start(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), monitor_->start());
  }

  Napi::Value Stop(const Napi::CallbackInfo& info) {
    monitor_->stop();
    return info.Env().Null();
  }

  Napi::Value GetCurrentSelection(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), monitor_->get_current_selection());
  }

  Napi::Value SetCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
      Napi::Error::New(env, "Function expected").ThrowAsJavaScriptException();
      return env.Null();
    }
    if (has_tsfn_) callback_tsfn_.Release();
    callback_tsfn_ = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "LinuxSelCallback", 0, 1);
    callback_tsfn_.Unref(env);  // never keep Electron alive on our account
    has_tsfn_ = true;
    Napi::ThreadSafeFunction tsfn = callback_tsfn_;
    monitor_->set_callback([tsfn](std::string text, int x, int y, std::string space) mutable {
      auto call = [text, x, y, space](Napi::Env env, Napi::Function jsCallback) {
        jsCallback.Call({Napi::String::New(env, text), Napi::Number::New(env, x), Napi::Number::New(env, y),
                         Napi::String::New(env, space)});
      };
      tsfn.BlockingCall(call);
    });
    return env.Null();
  }

  Napi::Value TestFocusedElement(const Napi::CallbackInfo& info) { return info.Env().Null(); }

  Napi::Value GetBackend(const Napi::CallbackInfo& info) {
    Napi::Object out = Napi::Object::New(info.Env());
    out.Set("backend", Napi::String::New(info.Env(), backendName(monitor_->backend())));
    out.Set("protocol", Napi::String::New(info.Env(), monitor_->protocol()));
    return out;
  }

  // KWin logical (= DIP) pointer on Plasma Wayland; null elsewhere.
  Napi::Value GetCursorPos(const Napi::CallbackInfo& info) {
    int timeout = 150;
    if (info.Length() >= 1 && info[0].IsNumber()) timeout = info[0].As<Napi::Number>().Int32Value();
    int x = 0, y = 0;
    if (!phevere::kwinScriptAvailable() || !phevere::kwinCursorPos(timeout, &x, &y)) return info.Env().Null();
    Napi::Object out = Napi::Object::New(info.Env());
    out.Set("x", Napi::Number::New(info.Env(), x));
    out.Set("y", Napi::Number::New(info.Env(), y));
    return out;
  }

  // Foreground window frame: KWin (DIP, sees Wayland windows) else EWMH (physical).
  Napi::Value GetActiveWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    WindowBox box;
    const char* space = nullptr;
    if (phevere::kwinScriptAvailable() &&
        phevere::kwinActiveWindow(300, &box.x, &box.y, &box.w, &box.h, &box.pid)) {
      space = "dip";
    } else if (x11ActiveWindow(&box)) {
      space = "physical";
    }
    if (!space) return env.Null();
    Napi::Object out = Napi::Object::New(env);
    out.Set("x", Napi::Number::New(env, box.x));
    out.Set("y", Napi::Number::New(env, box.y));
    out.Set("width", Napi::Number::New(env, box.w));
    out.Set("height", Napi::Number::New(env, box.h));
    out.Set("pid", Napi::Number::New(env, box.pid));
    out.Set("space", Napi::String::New(env, space));
    return out;
  }

  Napi::Value WatchCursor(const Napi::CallbackInfo& info) {
    const bool on = info.Length() >= 1 && info[0].ToBoolean().Value();
    if (!phevere::kwinScriptAvailable()) return Napi::Boolean::New(info.Env(), false);
    return Napi::Boolean::New(info.Env(), phevere::kwinWatchCursor(on));
  }

  // Non-blocking: last pointer KWin reported, or null.
  Napi::Value GetWatchedCursor(const Napi::CallbackInfo& info) {
    int x = 0, y = 0;
    if (!phevere::kwinWatchedCursor(&x, &y)) return info.Env().Null();
    Napi::Object out = Napi::Object::New(info.Env());
    out.Set("x", Napi::Number::New(info.Env(), x));
    out.Set("y", Napi::Number::New(info.Env(), y));
    return out;
  }

  // Where this .node lives, so JS can load it again in the AT-SPI helper process.
  Napi::Value GetModulePath(const Napi::CallbackInfo& info) {
    Dl_info dl;
    if (dladdr(reinterpret_cast<void*>(&wordAtPoint), &dl) && dl.dli_fname) {
      return Napi::String::New(info.Env(), dl.dli_fname);
    }
    return info.Env().Null();
  }

  // No TCC on Linux.
  Napi::Value IsTrusted(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), true); }

  Napi::Value GetWordAtPoint(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
      Napi::Error::New(env, "getWordAtPoint(x, y) expects two numbers").ThrowAsJavaScriptException();
      return env.Null();
    }
    const int x = info[0].As<Napi::Number>().Int32Value();
    const int y = info[1].As<Napi::Number>().Int32Value();
    WordResult r = wordAtPoint(x, y);
    Napi::Object out = Napi::Object::New(env);
    out.Set("text", Napi::String::New(env, r.text));
    out.Set("x", Napi::Number::New(env, r.x));
    out.Set("y", Napi::Number::New(env, r.y));
    if (r.hasBounds) {
      Napi::Object b = Napi::Object::New(env);
      b.Set("x", Napi::Number::New(env, r.bx));
      b.Set("y", Napi::Number::New(env, r.by));
      b.Set("width", Napi::Number::New(env, r.bw));
      b.Set("height", Napi::Number::New(env, r.bh));
      out.Set("bounds", b);
    }
    return out;
  }
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return LinuxSelectionMonitorWrapper::Init(env, exports);
}

}  // namespace

NODE_API_MODULE(linux_selection_monitor, Init)
