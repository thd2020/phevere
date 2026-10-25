#include "linux_kwin_script.h"

#include <gio/gio.h>
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>

namespace phevere {

namespace {

constexpr const char* kObjectPath = "/org/phevere/KWin";
constexpr const char* kInterface = "org.phevere.KWin";
constexpr const char* kIntrospection =
    "<node><interface name='org.phevere.KWin'>"
    "<method name='Result'><arg type='s' direction='in'/></method>"
    "<method name='Cursor'><arg type='s' direction='in'/></method>"
    "</interface></node>";

// One D-Bus connection with its own main loop on a private thread: KWin's
// callbacks land there whatever thread (JS or selection worker) asked.
std::once_flag g_once;
bool g_ready = false;
GMainContext* g_context = nullptr;
GDBusConnection* g_conn = nullptr;
std::string g_unique;
std::string g_dir;

std::mutex g_evalMutex;  // one eval script at a time
std::mutex g_resultMutex;
std::condition_variable g_resultCv;
bool g_got = false;
std::string g_result;

std::mutex g_watchMutex;
bool g_watching = false;
std::atomic<bool> g_haveCursor{false};
std::atomic<int> g_cursorX{0};
std::atomic<int> g_cursorY{0};

// Comma-separated numbers. strtod, not sscanf: glibc ≥ 2.38 redirects sscanf
// to __isoc23_sscanf, which would pin the addon to new distros.
int parseNumbers(const std::string& s, double* out, int max) {
  const char* p = s.c_str();
  int n = 0;
  while (n < max && *p) {
    char* end = nullptr;
    const double v = std::strtod(p, &end);
    if (end == p) break;
    out[n++] = v;
    p = (*end == ',') ? end + 1 : end;
  }
  return n;
}

void onMethodCall(GDBusConnection*, const gchar*, const gchar*, const gchar*, const gchar* method,
                  GVariant* params, GDBusMethodInvocation* invocation, gpointer) {
  const gchar* value = nullptr;
  g_variant_get(params, "(&s)", &value);
  if (g_strcmp0(method, "Result") == 0) {
    std::lock_guard<std::mutex> lock(g_resultMutex);
    g_result = value ? value : "";
    g_got = true;
    g_resultCv.notify_all();
  } else if (g_strcmp0(method, "Cursor") == 0 && value) {
    double v[2] = {0, 0};
    if (parseNumbers(value, v, 2) == 2) {
      g_cursorX = static_cast<int>(v[0]);
      g_cursorY = static_cast<int>(v[1]);
      g_haveCursor = true;
    }
  }
  g_dbus_method_invocation_return_value(invocation, nullptr);
}

const GDBusInterfaceVTable kVTable = {onMethodCall, nullptr, nullptr, {nullptr}};

GVariant* callKwin(const char* path, const char* iface, const char* method, GVariant* args,
                   const char* replyType) {
  GError* err = nullptr;
  GVariant* r = g_dbus_connection_call_sync(g_conn, "org.kde.KWin", path, iface, method, args,
                                            replyType ? G_VARIANT_TYPE(replyType) : nullptr,
                                            G_DBUS_CALL_FLAGS_NONE, 500, nullptr, &err);
  if (err) g_error_free(err);
  return r;
}

void init() {
  gchar* address = g_dbus_address_get_for_bus_sync(G_BUS_TYPE_SESSION, nullptr, nullptr);
  if (!address) return;
  std::mutex m;
  std::condition_variable cv;
  bool started = false;
  std::thread([address, &m, &cv, &started] {
    GMainContext* ctx = g_main_context_new();
    g_main_context_push_thread_default(ctx);
    GDBusConnection* conn = g_dbus_connection_new_for_address_sync(
        address,
        static_cast<GDBusConnectionFlags>(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT |
                                          G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION),
        nullptr, nullptr, nullptr);
    g_free(address);
    if (conn) {
      GDBusNodeInfo* node = g_dbus_node_info_new_for_xml(kIntrospection, nullptr);
      g_dbus_connection_register_object(conn, kObjectPath, node->interfaces[0], &kVTable, nullptr, nullptr,
                                        nullptr);
      g_dbus_node_info_unref(node);
    }
    {
      std::lock_guard<std::mutex> lock(m);
      g_context = ctx;
      g_conn = conn;
      started = true;
    }
    cv.notify_all();
    if (!conn) return;
    GMainLoop* loop = g_main_loop_new(ctx, FALSE);
    g_main_loop_run(loop);  // lives for the process
  }).detach();
  std::unique_lock<std::mutex> lock(m);
  cv.wait(lock, [&] { return started; });
  if (!g_conn) return;

  // Scripts call back to our unique bus name, so several instances never clash.
  g_unique = g_dbus_connection_get_unique_name(g_conn);
  const char* runtime = std::getenv("XDG_RUNTIME_DIR");
  g_dir = runtime && *runtime ? runtime : g_get_tmp_dir();
  g_ready = true;
}

bool ready() {
  std::call_once(g_once, init);
  return g_ready;
}

std::string scriptPath(const std::string& plugin) { return g_dir + "/" + plugin + ".js"; }

void unloadScript(const std::string& plugin) {
  GVariant* r = callKwin("/Scripting", "org.kde.kwin.Scripting", "unloadScript",
                         g_variant_new("(s)", plugin.c_str()), nullptr);
  if (r) g_variant_unref(r);
}

/** Load and run a KWin script body under `plugin`. */
bool runScript(const std::string& plugin, const std::string& body) {
  const std::string path = scriptPath(plugin);
  if (!g_file_set_contents(path.c_str(), body.c_str(), -1, nullptr)) return false;
  unloadScript(plugin);
  GVariant* r = callKwin("/Scripting", "org.kde.kwin.Scripting", "loadScript",
                         g_variant_new("(ss)", path.c_str(), plugin.c_str()), "(i)");
  if (!r) return false;
  gint id = -1;
  g_variant_get(r, "(i)", &id);
  g_variant_unref(r);
  if (id < 0) return false;
  const std::string obj = "/Scripting/Script" + std::to_string(id);
  GVariant* run = callKwin(obj.c_str(), "org.kde.kwin.Script", "run", nullptr, nullptr);
  if (!run) return false;
  g_variant_unref(run);
  return true;
}

std::string callback(const char* method, const std::string& valueExpr) {
  return std::string("callDBus(\"") + g_unique + "\", \"" + kObjectPath + "\", \"" + kInterface + "\", \"" + method +
         "\", " + valueExpr + ");";
}

}  // namespace

bool kwinScriptAvailable() {
  const char* desktop = std::getenv("XDG_CURRENT_DESKTOP");
  if (!desktop || !std::strstr(desktop, "KDE")) return false;
  const char* wl = std::getenv("WAYLAND_DISPLAY");
  if (!wl || !*wl) return false;  // X11 sessions read the pointer from X directly
  const char* off = std::getenv("PHEVERE_DISABLE_KWIN_SCRIPT");
  if (off && std::string(off) == "1") return false;
  return ready();
}

bool kwinEval(const std::string& expression, int timeoutMs, std::string* out) {
  if (!ready()) return false;
  std::lock_guard<std::mutex> evalLock(g_evalMutex);
  const std::string plugin = "phevere-query-" + std::to_string(getpid());
  {
    std::lock_guard<std::mutex> lock(g_resultMutex);
    g_got = false;
  }
  bool got = false;
  if (runScript(plugin, callback("Result", "String(" + expression + ")") + "\n")) {
    std::unique_lock<std::mutex> lock(g_resultMutex);
    got = g_resultCv.wait_for(lock, std::chrono::milliseconds(timeoutMs), [] { return g_got; });
    if (got) *out = g_result;
  }
  unloadScript(plugin);
  return got;
}

bool kwinCursorPos(int timeoutMs, int* x, int* y) {
  if (kwinWatchedCursor(x, y)) return true;
  std::string out;
  if (!kwinEval("workspace.cursorPos.x + ',' + workspace.cursorPos.y", timeoutMs, &out)) return false;
  double v[2] = {0, 0};
  if (parseNumbers(out, v, 2) != 2) return false;
  *x = static_cast<int>(v[0]);
  *y = static_cast<int>(v[1]);
  return true;
}

bool kwinWatchCursor(bool on) {
  if (!ready()) return false;
  std::lock_guard<std::mutex> lock(g_watchMutex);
  // Fixed name: a fresh start replaces a watch left behind by a crashed run.
  const std::string plugin = "phevere-cursor-watch";
  if (!on) {
    if (g_watching) unloadScript(plugin);
    g_watching = false;
    g_haveCursor = false;
    return true;
  }
  if (g_watching) return true;
  // One callback per pointer move, while hover lookup runs. Unloaded on stop.
  const std::string body = "function phevereSend() { var p = workspace.cursorPos; " +
                           callback("Cursor", "p.x + ',' + p.y") +
                           " }\nworkspace.cursorPosChanged.connect(phevereSend);\nphevereSend();\n";
  g_watching = runScript(plugin, body);
  return g_watching;
}

bool kwinWatchedCursor(int* x, int* y) {
  if (!g_haveCursor) return false;
  *x = g_cursorX;
  *y = g_cursorY;
  return true;
}

bool kwinActiveWindow(int timeoutMs, int* x, int* y, int* w, int* h, int* pid) {
  std::string out;
  const char* expr =
      "(function () { var c = workspace.activeWindow; if (!c) return ''; var g = c.frameGeometry;"
      " return [g.x, g.y, g.width, g.height, c.pid].join(','); })()";
  if (!kwinEval(expr, timeoutMs, &out) || out.empty()) return false;
  double v[5] = {0, 0, 0, 0, 0};
  if (parseNumbers(out, v, 5) != 5) return false;
  *x = static_cast<int>(v[0]);
  *y = static_cast<int>(v[1]);
  *w = static_cast<int>(v[2]);
  *h = static_cast<int>(v[3]);
  *pid = static_cast<int>(v[4]);
  return true;
}

}  // namespace phevere
