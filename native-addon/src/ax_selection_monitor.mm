/**
 * macOS selection backend (draft).
 *
 * Windows uses UI Automation. Here the equivalent is the Accessibility (AX) API:
 *   - CGEvent tap: drag / double-click mouse-up (same idea as the Win32 mouse hook)
 *   - AXSelectedText / AXStringForRange on the focused element and nearby AX nodes
 *   - Cmd+C pasteboard fallback when Chromium (Chrome, Cursor, VS Code) exposes no AX text
 *     (same idea as the Windows synthetic Ctrl+C path; clipboard is restored)
 *   - AXObserver for kAXSelectedTextChangedNotification when the app fires it
 *   - 500ms debounce, then N-API ThreadSafeFunction → Electron main
 *
 * Requires System Settings → Privacy & Security → Accessibility for the
 * host binary (Electron.app in `npm start`, Phevere.app when packaged).
 *
 * Build: OS=='mac' target `ax_selection_monitor` in binding.gyp.
 * Env: PHEVERE_DEBUG_AX=1  PHEVERE_DISABLE_INPUT_GATE=1
 */

#include <napi.h>

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <functional>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {

static constexpr int kDebounceDelayMs = 500;
static constexpr size_t kMaxSelectionBytes = 8000;
static constexpr int kDragThresholdPx = 8;
static constexpr int kPostMouseUpSettleMs = 80;
static constexpr int kTypingQuietMs = 700;
static constexpr int kClipboardFallbackDelayMs = 100;
static constexpr int kClipboardPasteboardWaitMs = 120;
static constexpr CGKeyCode kKeyCodeC = 8;        // kVK_ANSI_C
static constexpr CGKeyCode kKeyCodeCommand = 55; // kVK_Command

// Current SDK types kAXValueCG* as UInt32; AXValueCreate/GetValue want AXValueType.
static AXValueType axValueType(UInt32 t) { return static_cast<AXValueType>(t); }
static constexpr int kWordAtPointMaxChars = 64;

static bool debugEnabled() {
  static int cached = -1;
  if (cached < 0) {
    const char* v = std::getenv("PHEVERE_DEBUG_AX");
    cached = (v && std::string(v) == "1") ? 1 : 0;
  }
  return cached == 1;
}

static bool inputGateDisabled() {
  const char* v = std::getenv("PHEVERE_DISABLE_INPUT_GATE");
  return v && std::string(v) == "1";
}

static void axLog(const std::string& msg) {
  if (debugEnabled()) std::cout << "[AX] " << msg << std::endl;
}

static std::string cfStringToUtf8(CFStringRef s) {
  if (!s) return {};
  const CFIndex len = CFStringGetLength(s);
  const CFIndex max = CFStringGetMaximumSizeForEncoding(len, kCFStringEncodingUTF8) + 1;
  std::string out(static_cast<size_t>(max), '\0');
  CFIndex used = 0;
  CFStringGetBytes(s, CFRangeMake(0, len), kCFStringEncodingUTF8, '?', false,
                   reinterpret_cast<UInt8*>(&out[0]), max - 1, &used);
  out.resize(static_cast<size_t>(used));
  return out;
}

static void trimInPlace(std::string& s) {
  const char* ws = " \t\r\n\f\v";
  const size_t a = s.find_first_not_of(ws);
  if (a == std::string::npos) {
    s.clear();
    return;
  }
  const size_t b = s.find_last_not_of(ws);
  s = s.substr(a, b - a + 1);
}

static bool looksLikeTypingGrowth(const std::string& a, const std::string& b) {
  if (a.empty() || b.empty() || b.size() < a.size()) return false;
  const size_t extra = b.size() - a.size();
  if (extra == 0 || extra > 2) return false;
  return b.compare(0, a.size(), a) == 0;
}

/** Electron / CGEvent: origin top-left of the primary display, y down. */
/** Cocoa / most AX geometry: origin bottom-left of the primary display, y up. */
static NSRect primaryScreenFrame() {
  NSScreen* primary = [NSScreen screens].firstObject;
  return primary ? primary.frame : NSMakeRect(0, 0, 1440, 900);
}

static void topLeftToCocoa(int x, int y, CGFloat* outX, CGFloat* outY) {
  const NSRect primary = primaryScreenFrame();
  *outX = static_cast<CGFloat>(x);
  *outY = NSMaxY(primary) - static_cast<CGFloat>(y);
}

static void cocoaRectToTopLeft(CGRect r, int* outX, int* outY) {
  const NSRect primary = primaryScreenFrame();
  *outX = static_cast<int>(r.origin.x);
  *outY = static_cast<int>(NSMaxY(primary) - r.origin.y - r.size.height);
}

static int64_t nowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

static bool isTrusted(bool prompt) {
  NSDictionary* opts = @{
    (__bridge id)kAXTrustedCheckOptionPrompt : prompt ? @YES : @NO,
  };
  return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
}

static pid_t pidOf(AXUIElementRef el) {
  pid_t pid = 0;
  if (el) AXUIElementGetPid(el, &pid);
  return pid;
}

static std::string selectedTextFromElement(AXUIElementRef el) {
  if (!el) return {};
  CFTypeRef value = nullptr;
  const AXError err = AXUIElementCopyAttributeValue(el, kAXSelectedTextAttribute, &value);
  if (err != kAXErrorSuccess || !value) return {};
  std::string text;
  if (CFGetTypeID(value) == CFStringGetTypeID()) {
    text = cfStringToUtf8(static_cast<CFStringRef>(value));
  }
  CFRelease(value);
  trimInPlace(text);
  if (text.size() > kMaxSelectionBytes) text.clear();
  return text;
}

static std::string stringForSelectedRange(AXUIElementRef el) {
  if (!el) return {};
  CFTypeRef rangeVal = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute, &rangeVal) != kAXErrorSuccess ||
      !rangeVal) {
    return {};
  }
  CFTypeRef strVal = nullptr;
  const AXError err = AXUIElementCopyParameterizedAttributeValue(
      el, kAXStringForRangeParameterizedAttribute, rangeVal, &strVal);
  CFRelease(rangeVal);
  if (err != kAXErrorSuccess || !strVal) return {};
  std::string text;
  if (CFGetTypeID(strVal) == CFStringGetTypeID()) {
    text = cfStringToUtf8(static_cast<CFStringRef>(strVal));
  }
  CFRelease(strVal);
  trimInPlace(text);
  if (text.size() > kMaxSelectionBytes) text.clear();
  return text;
}

static std::string oneElementSelection(AXUIElementRef el) {
  std::string t = selectedTextFromElement(el);
  if (!t.empty()) return t;
  return stringForSelectedRange(el);
}

static bool isSecureElement(AXUIElementRef el) {
  if (!el) return false;
  CFTypeRef role = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXRoleAttribute, &role) != kAXErrorSuccess || !role) {
    return false;
  }
  bool secure = false;
  if (CFGetTypeID(role) == CFStringGetTypeID()) {
    secure = [(__bridge NSString*)role isEqualToString:@"AXSecureTextField"];
  }
  CFRelease(role);
  return secure;
}

static AXUIElementRef copyParent(AXUIElementRef el) {
  if (!el) return nullptr;
  AXUIElementRef parent = nullptr;
  AXUIElementCopyAttributeValue(el, kAXParentAttribute, reinterpret_cast<CFTypeRef*>(&parent));
  return parent;
}

static bool isSecureChain(AXUIElementRef start) {
  AXUIElementRef cur = start ? static_cast<AXUIElementRef>(CFRetain(start)) : nullptr;
  for (int i = 0; i < 12 && cur; ++i) {
    if (isSecureElement(cur)) {
      CFRelease(cur);
      return true;
    }
    AXUIElementRef parent = copyParent(cur);
    CFRelease(cur);
    cur = parent;
  }
  if (cur) CFRelease(cur);
  return false;
}

/** Focused node + parents + a shallow child walk (Chromium web areas). */
static std::string selectedTextDeep(AXUIElementRef start) {
  if (!start) return {};
  AXUIElementRef cur = static_cast<AXUIElementRef>(CFRetain(start));
  for (int i = 0; i < 10 && cur; ++i) {
    std::string t = oneElementSelection(cur);
    if (!t.empty()) {
      CFRelease(cur);
      return t;
    }
    AXUIElementRef parent = copyParent(cur);
    CFRelease(cur);
    cur = parent;
  }
  if (cur) CFRelease(cur);

  std::vector<AXUIElementRef> q;
  q.push_back(static_cast<AXUIElementRef>(CFRetain(start)));
  int seen = 0;
  std::string found;
  while (!q.empty() && seen < 48) {
    AXUIElementRef el = q.front();
    q.erase(q.begin());
    ++seen;
    std::string t = oneElementSelection(el);
    if (!t.empty()) {
      found = std::move(t);
      CFRelease(el);
      break;
    }
    CFTypeRef children = nullptr;
    if (AXUIElementCopyAttributeValue(el, kAXChildrenAttribute, &children) == kAXErrorSuccess && children &&
        CFGetTypeID(children) == CFArrayGetTypeID()) {
      const CFArrayRef arr = static_cast<CFArrayRef>(children);
      const CFIndex n = CFArrayGetCount(arr);
      for (CFIndex i = 0; i < n && seen + static_cast<int>(q.size()) < 48; ++i) {
        AXUIElementRef child =
            static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(arr, i)));
        if (child) q.push_back(static_cast<AXUIElementRef>(CFRetain(child)));
      }
    }
    if (children) CFRelease(children);
    CFRelease(el);
  }
  for (AXUIElementRef leftover : q) CFRelease(leftover);
  return found;
}

static void postCommandC() {
  CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  if (!src) src = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!src) return;
  CGEventRef cmdDown = CGEventCreateKeyboardEvent(src, kKeyCodeCommand, true);
  CGEventRef cDown = CGEventCreateKeyboardEvent(src, kKeyCodeC, true);
  CGEventRef cUp = CGEventCreateKeyboardEvent(src, kKeyCodeC, false);
  CGEventRef cmdUp = CGEventCreateKeyboardEvent(src, kKeyCodeCommand, false);
  if (cmdDown) CGEventSetFlags(cmdDown, kCGEventFlagMaskCommand);
  if (cDown) CGEventSetFlags(cDown, kCGEventFlagMaskCommand);
  if (cUp) CGEventSetFlags(cUp, kCGEventFlagMaskCommand);
  if (cmdUp) CGEventSetFlags(cmdUp, kCGEventFlagMaskCommand);
  // Session tap is enough with Accessibility; HID can require Input Monitoring.
  if (cmdDown) CGEventPost(kCGSessionEventTap, cmdDown);
  if (cDown) CGEventPost(kCGSessionEventTap, cDown);
  if (cUp) CGEventPost(kCGSessionEventTap, cUp);
  if (cmdUp) CGEventPost(kCGSessionEventTap, cmdUp);
  if (cmdDown) CFRelease(cmdDown);
  if (cDown) CFRelease(cDown);
  if (cUp) CFRelease(cUp);
  if (cmdUp) CFRelease(cmdUp);
  CFRelease(src);
}

static NSDictionary* snapshotPasteboard() {
  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  NSMutableDictionary* snap = [NSMutableDictionary dictionary];
  snap[@"changeCount"] = @(pb.changeCount);
  for (NSPasteboardType t in pb.types) {
    NSData* data = [pb dataForType:t];
    if (data) snap[t] = data;
  }
  return snap;
}

static void restorePasteboard(NSDictionary* snap) {
  if (!snap) return;
  NSPasteboard* pb = [NSPasteboard generalPasteboard];
  NSMutableArray<NSPasteboardType>* types = [NSMutableArray array];
  NSMutableDictionary* dataByType = [NSMutableDictionary dictionary];
  for (id key in snap) {
    if ([key isEqualToString:@"changeCount"]) continue;
    if ([snap[key] isKindOfClass:[NSData class]]) {
      [types addObject:key];
      dataByType[key] = snap[key];
    }
  }
  [pb clearContents];
  if (types.count == 0) return;
  [pb declareTypes:types owner:nil];
  for (NSPasteboardType t in types) {
    [pb setData:dataByType[t] forType:t];
  }
}

static bool selectionOrigin(AXUIElementRef el, int* outX, int* outY) {
  if (!el || !outX || !outY) return false;
  CFTypeRef rangeVal = nullptr;
  if (AXUIElementCopyAttributeValue(el, kAXSelectedTextRangeAttribute, &rangeVal) != kAXErrorSuccess ||
      !rangeVal) {
    return false;
  }
  CFTypeRef boundsVal = nullptr;
  const AXError err = AXUIElementCopyParameterizedAttributeValue(
      el, kAXBoundsForRangeParameterizedAttribute, rangeVal, &boundsVal);
  CFRelease(rangeVal);
  if (err != kAXErrorSuccess || !boundsVal) return false;

  CGRect rect = CGRectZero;
  const bool ok = AXValueGetValue(
      static_cast<AXValueRef>(boundsVal), axValueType(kAXValueCGRectType), &rect);
  CFRelease(boundsVal);
  if (!ok || CGRectIsEmpty(rect)) return false;
  cocoaRectToTopLeft(rect, outX, outY);
  return true;
}

static AXUIElementRef copyFocusedElement() {
  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (!systemWide) return nullptr;
  AXUIElementRef focused = nullptr;
  AXUIElementCopyAttributeValue(systemWide, kAXFocusedUIElementAttribute, (CFTypeRef*)&focused);
  CFRelease(systemWide);
  return focused;
}

static std::string expandToWord(const std::string& raw) {
  std::string s = raw;
  trimInPlace(s);
  if (s.empty() || s.size() > static_cast<size_t>(kWordAtPointMaxChars)) {
    if (s.size() > static_cast<size_t>(kWordAtPointMaxChars)) s = s.substr(0, kWordAtPointMaxChars);
    trimInPlace(s);
  }
  return s;
}

}  // namespace

class AXSelectionMonitor {
 public:
  AXSelectionMonitor() {
    instance = this;
    axLog("constructor");
  }

  ~AXSelectionMonitor() {
    stop();
    if (instance == this) instance = nullptr;
  }

  void set_callback(std::function<void(std::string, int, int)> cb) { callback = std::move(cb); }

  bool start() {
    if (running.load()) return true;
    if (!isTrusted(false)) {
      axLog("not trusted — Accessibility permission missing");
      return false;
    }

    running.store(true);
    debounce_running.store(true);
    debounce_thread = std::thread(&AXSelectionMonitor::debounceLoop, this);

    // N-API start() runs on Electron's main thread. Installing the tap + AX
    // observer there (not a private CFRunLoop) is what actually delivers events.
    runOnMain(^{ this->installOnMainRunLoop(); });
    axLog("started");
    return true;
  }

  void stop() {
    if (!running.exchange(false)) return;
    debounce_running.store(false);
    if (debounce_thread.joinable()) debounce_thread.join();
    runOnMain(^{ this->teardownOnMainRunLoop(); });
    axLog("stopped");
  }

  std::string get_current_selection() {
    std::lock_guard<std::mutex> lock(debounce_mutex);
    return last_selection;
  }

  static bool trusted(bool prompt) { return isTrusted(prompt); }

  static void wordAtPoint(int x, int y, std::string* text, int* outX, int* outY) {
    *text = "";
    *outX = x;
    *outY = y;
    if (!isTrusted(false)) return;

    CGFloat cx = 0, cy = 0;
    topLeftToCocoa(x, y, &cx, &cy);

    AXUIElementRef systemWide = AXUIElementCreateSystemWide();
    if (!systemWide) return;
    AXUIElementRef el = nullptr;
    AXUIElementCopyElementAtPosition(systemWide, static_cast<float>(cx), static_cast<float>(cy), &el);
    CFRelease(systemWide);
    if (!el) return;

    if (pidOf(el) == getpid()) {
      CFRelease(el);
      return;
    }

    CGPoint cocoaPt = CGPointMake(cx, cy);
    AXValueRef pointVal = AXValueCreate(axValueType(kAXValueCGPointType), &cocoaPt);
    CFTypeRef rangeVal = nullptr;
    AXError err = kAXErrorFailure;
    if (pointVal) {
      err = AXUIElementCopyParameterizedAttributeValue(
          el, kAXRangeForPositionParameterizedAttribute, pointVal, &rangeVal);
      CFRelease(pointVal);
    }

    std::string found;
    if (err == kAXErrorSuccess && rangeVal) {
      CFTypeRef strVal = nullptr;
      if (AXUIElementCopyParameterizedAttributeValue(
              el, kAXStringForRangeParameterizedAttribute, rangeVal, &strVal) == kAXErrorSuccess &&
          strVal && CFGetTypeID(strVal) == CFStringGetTypeID()) {
        found = expandToWord(cfStringToUtf8(static_cast<CFStringRef>(strVal)));
        CFRelease(strVal);
      }
      CFTypeRef boundsVal = nullptr;
      if (AXUIElementCopyParameterizedAttributeValue(
              el, kAXBoundsForRangeParameterizedAttribute, rangeVal, &boundsVal) == kAXErrorSuccess &&
          boundsVal) {
        CGRect rect = CGRectZero;
        if (AXValueGetValue(
                static_cast<AXValueRef>(boundsVal), axValueType(kAXValueCGRectType), &rect) &&
            !CGRectIsEmpty(rect)) {
          cocoaRectToTopLeft(rect, outX, outY);
          *outX = static_cast<int>(rect.origin.x + rect.size.width / 2.0);
          const NSRect primary = primaryScreenFrame();
          *outY = static_cast<int>(NSMaxY(primary) - rect.origin.y);
        }
        CFRelease(boundsVal);
      }
      CFRelease(rangeVal);
    }

    if (found.empty()) {
      found = expandToWord(selectedTextFromElement(el));
    }

    CFRelease(el);
    *text = found;
  }

 private:
  static AXSelectionMonitor* instance;

  std::function<void(std::string, int, int)> callback;
  std::atomic<bool> running{false};
  std::atomic<bool> debounce_running{false};
  std::thread debounce_thread;
  CFRunLoopRef run_loop = nullptr;
  CFMachPortRef event_tap = nullptr;
  CFRunLoopSourceRef tap_source = nullptr;
  id workspace_observer = nil;

  std::mutex debounce_mutex;
  std::string last_selection;
  std::string pending_selection;
  int pending_x = 0;
  int pending_y = 0;
  std::chrono::steady_clock::time_point last_selection_time{};

  CGPoint mouse_down{};
  int64_t last_click_ms = 0;
  CGPoint last_click_pt{};
  std::atomic<int64_t> last_key_ms{0};
  std::atomic<int64_t> last_gesture_ms{0};
  std::atomic<int64_t> last_ax_ok_ms{0};
  std::atomic<int> fallback_inflight{0};

  AXObserverRef ax_observer = nullptr;
  AXUIElementRef observed_app = nullptr;
  pid_t observed_pid = 0;

  void updatePendingSelection(const std::string& newSelection, int x, int y) {
    std::lock_guard<std::mutex> lock(debounce_mutex);
    const bool replacingSettled = pending_selection.empty() && !last_selection.empty() &&
                                  newSelection != last_selection &&
                                  !looksLikeTypingGrowth(last_selection, newSelection);
    pending_selection = newSelection;
    pending_x = x;
    pending_y = y;
    if (replacingSettled) {
      last_selection_time = std::chrono::steady_clock::now() -
                            std::chrono::milliseconds(kDebounceDelayMs);
    } else {
      last_selection_time = std::chrono::steady_clock::now();
    }
  }

  void debounceLoop() {
    while (debounce_running.load()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(50));
      std::string text;
      int x = 0, y = 0;
      {
        std::lock_guard<std::mutex> lock(debounce_mutex);
        if (pending_selection.empty()) continue;
        const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - last_selection_time);
        if (elapsed.count() < kDebounceDelayMs) continue;
        last_selection = pending_selection;
        text = pending_selection;
        x = pending_x;
        y = pending_y;
        pending_selection.clear();
      }
      axLog(std::string("settled: \"") + text + "\"");
      if (callback) callback(text, x, y);
    }
  }

  void runOnMain(void (^block)(void)) {
    if ([NSThread isMainThread]) {
      block();
    } else {
      dispatch_sync(dispatch_get_main_queue(), block);
    }
  }

  bool shouldAcceptAxChange() {
    if (inputGateDisabled()) return true;
    return nowMs() - last_key_ms.load() >= kTypingQuietMs;
  }

  void emitFocusedSelection(bool fromGesture) {
    @autoreleasepool {
      AXUIElementRef focused = copyFocusedElement();
      if (!focused) {
        if (fromGesture) {
          axLog("mouse-up: no focused AX element");
          triggerClipboardFallback(0, 0);
        }
        return;
      }
      if (pidOf(focused) == getpid()) {
        CFRelease(focused);
        return;
      }
      if (isSecureChain(focused)) {
        CFRelease(focused);
        axLog("skip secure field");
        return;
      }
      std::string text = selectedTextDeep(focused);
      int x = 0, y = 0;
      if (!selectionOrigin(focused, &x, &y)) {
        NSPoint mouse = [NSEvent mouseLocation];
        const NSRect primary = primaryScreenFrame();
        x = static_cast<int>(mouse.x);
        y = static_cast<int>(NSMaxY(primary) - mouse.y);
      }
      CFRelease(focused);
      if (!text.empty()) {
        last_ax_ok_ms.store(nowMs());
        updatePendingSelection(text, x, y);
        return;
      }
      if (fromGesture) {
        axLog("AX selected text empty; clipboard fallback");
        triggerClipboardFallback(x, y);
      }
    }
  }

  void triggerClipboardFallback(int x, int y) {
    if (fallback_inflight.exchange(1) != 0) return;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      std::this_thread::sleep_for(std::chrono::milliseconds(kClipboardFallbackDelayMs));
      if (!this->running.load() || nowMs() - this->last_ax_ok_ms.load() < 150) {
        this->fallback_inflight.store(0);
        return;
      }

      __block NSDictionary* snap = nil;
      __block NSInteger countBefore = 0;
      dispatch_sync(dispatch_get_main_queue(), ^{
        @autoreleasepool {
          snap = [snapshotPasteboard() copy];
          countBefore = [NSPasteboard generalPasteboard].changeCount;
        }
      });

      postCommandC();
      std::this_thread::sleep_for(std::chrono::milliseconds(kClipboardPasteboardWaitMs));

      __block std::string captured;
      dispatch_sync(dispatch_get_main_queue(), ^{
        @autoreleasepool {
          NSPasteboard* pb = [NSPasteboard generalPasteboard];
          if (pb.changeCount == countBefore) {
            axLog("clipboard unchanged; no selection to capture");
            return;
          }
          NSString* s = [pb stringForType:NSPasteboardTypeString];
          if (s.length > 0) {
            captured = std::string([s UTF8String] ? [s UTF8String] : "");
            trimInPlace(captured);
            if (captured.size() > kMaxSelectionBytes) captured.clear();
          }
          restorePasteboard(snap);
        }
      });

      if (!captured.empty()) {
        axLog(std::string("clipboard fallback: \"") + captured + "\"");
        this->updatePendingSelection(captured, x, y);
      }
      this->fallback_inflight.store(0);
    });
  }

  void rebindObserverToFrontApp() {
    @autoreleasepool {
      NSRunningApplication* front = [[NSWorkspace sharedWorkspace] frontmostApplication];
      if (!front) return;
      const pid_t pid = front.processIdentifier;
      if (pid == getpid()) return;
      if (pid == observed_pid && ax_observer) return;

      teardownObserver();
      AXUIElementRef app = AXUIElementCreateApplication(pid);
      if (!app) return;

      AXObserverRef observer = nullptr;
      if (AXObserverCreate(pid, &AXSelectionMonitor::axObserverCallback, &observer) != kAXErrorSuccess ||
          !observer) {
        CFRelease(app);
        return;
      }

      AXObserverAddNotification(observer, app, kAXFocusedUIElementChangedNotification, this);
      AXObserverAddNotification(observer, app, kAXSelectedTextChangedNotification, this);
      AXUIElementRef focused = nullptr;
      if (AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, (CFTypeRef*)&focused) ==
              kAXErrorSuccess &&
          focused) {
        AXObserverAddNotification(observer, focused, kAXSelectedTextChangedNotification, this);
        CFRelease(focused);
      }

      CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer),
                         kCFRunLoopCommonModes);
      ax_observer = observer;
      observed_app = app;
      observed_pid = pid;
      const char* name = front.localizedName.UTF8String;
      axLog(std::string("observer bound to ") + (name ? name : "?") + " pid " + std::to_string(pid));
    }
  }

  void teardownObserver() {
    CFRunLoopRef loop = run_loop ? run_loop : CFRunLoopGetMain();
    if (ax_observer && loop) {
      CFRunLoopRemoveSource(loop, AXObserverGetRunLoopSource(ax_observer), kCFRunLoopCommonModes);
    }
    if (ax_observer) {
      CFRelease(ax_observer);
      ax_observer = nullptr;
    }
    if (observed_app) {
      CFRelease(observed_app);
      observed_app = nullptr;
    }
    observed_pid = 0;
  }

  static void axObserverCallback(AXObserverRef /*observer*/, AXUIElementRef /*element*/,
                                 CFStringRef notification, void* refcon) {
    auto* self = static_cast<AXSelectionMonitor*>(refcon);
    if (!self || !self->running.load()) return;
    if (CFEqual(notification, kAXFocusedUIElementChangedNotification)) {
      self->rebindObserverToFrontApp();
      return;
    }
    if (CFEqual(notification, kAXSelectedTextChangedNotification) && self->shouldAcceptAxChange()) {
      self->emitFocusedSelection(false);
    }
  }

  static CGEventRef tapCallback(CGEventTapProxy /*proxy*/, CGEventType type, CGEventRef event,
                                void* refcon) {
    auto* self = static_cast<AXSelectionMonitor*>(refcon);
    if (!self) return event;

    if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
      if (self->event_tap) CGEventTapEnable(self->event_tap, true);
      return event;
    }

    self->onEvent(type, event);
    return event;
  }

  void onEvent(CGEventType type, CGEventRef event) {
    const CGPoint loc = CGEventGetLocation(event);
    if (type == kCGEventLeftMouseDown) {
      mouse_down = loc;
      return;
    }
    if (type != kCGEventLeftMouseUp) return;

    const CGFloat dx = std::fabs(loc.x - mouse_down.x);
    const CGFloat dy = std::fabs(loc.y - mouse_down.y);
    const int64_t now = nowMs();
    const bool isDouble = (now - last_click_ms <= [NSEvent doubleClickInterval] * 1000.0) &&
                          (std::fabs(loc.x - last_click_pt.x) <= 5) &&
                          (std::fabs(loc.y - last_click_pt.y) <= 5);
    last_click_ms = now;
    last_click_pt = loc;

    if (dx < kDragThresholdPx && dy < kDragThresholdPx && !isDouble) {
      return;
    }

    last_gesture_ms.store(now);
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, static_cast<int64_t>(kPostMouseUpSettleMs) * NSEC_PER_MSEC),
        dispatch_get_main_queue(), ^{
          if (!this->running.load()) return;
          this->emitFocusedSelection(true);
          this->rebindObserverToFrontApp();
        });
  }

  void installOnMainRunLoop() {
    @autoreleasepool {
      run_loop = CFRunLoopGetMain();
      const CGEventMask mask =
          CGEventMaskBit(kCGEventLeftMouseDown) | CGEventMaskBit(kCGEventLeftMouseUp);
      event_tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap,
                                   kCGEventTapOptionListenOnly, mask, &AXSelectionMonitor::tapCallback,
                                   this);
      if (!event_tap) {
        event_tap = CGEventTapCreate(kCGHIDEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly,
                                     mask, &AXSelectionMonitor::tapCallback, this);
      }
      if (event_tap) {
        tap_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, event_tap, 0);
        CFRunLoopAddSource(run_loop, tap_source, kCFRunLoopCommonModes);
        CGEventTapEnable(event_tap, true);
        std::cout << "[AX] event tap on main run loop" << std::endl;
      } else {
        std::cout << "[AX] event tap unavailable; AX observer only (drag-select may miss)"
                  << std::endl;
      }

      AXSelectionMonitor* self = this;
      workspace_observer = [[[NSWorkspace sharedWorkspace] notificationCenter]
          addObserverForName:NSWorkspaceDidActivateApplicationNotification
                      object:nil
                       queue:[NSOperationQueue mainQueue]
                  usingBlock:^(NSNotification* /*note*/) {
                    if (!self->running.load()) return;
                    self->rebindObserverToFrontApp();
                  }];

      rebindObserverToFrontApp();
    }
  }

  void teardownOnMainRunLoop() {
    @autoreleasepool {
      if (workspace_observer) {
        [[[NSWorkspace sharedWorkspace] notificationCenter] removeObserver:workspace_observer];
        workspace_observer = nil;
      }
      teardownObserver();
      if (tap_source && run_loop) {
        CFRunLoopRemoveSource(run_loop, tap_source, kCFRunLoopCommonModes);
        CFRelease(tap_source);
        tap_source = nullptr;
      }
      if (event_tap) {
        CGEventTapEnable(event_tap, false);
        CFRelease(event_tap);
        event_tap = nullptr;
      }
      run_loop = nullptr;
    }
  }
};

AXSelectionMonitor* AXSelectionMonitor::instance = nullptr;

class AXSelectionMonitorWrapper : public Napi::ObjectWrap<AXSelectionMonitorWrapper> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "AXSelectionMonitor", {
        InstanceMethod("start", &AXSelectionMonitorWrapper::Start),
        InstanceMethod("stop", &AXSelectionMonitorWrapper::Stop),
        InstanceMethod("getCurrentSelection", &AXSelectionMonitorWrapper::GetCurrentSelection),
        InstanceMethod("setCallback", &AXSelectionMonitorWrapper::SetCallback),
        InstanceMethod("testFocusedElement", &AXSelectionMonitorWrapper::TestFocusedElement),
        InstanceMethod("getWordAtPoint", &AXSelectionMonitorWrapper::GetWordAtPoint),
        InstanceMethod("isTrusted", &AXSelectionMonitorWrapper::IsTrusted),
    });
    exports.Set("AXSelectionMonitor", func);
    return exports;
  }

  AXSelectionMonitorWrapper(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<AXSelectionMonitorWrapper>(info), monitor(new AXSelectionMonitor()) {}

  ~AXSelectionMonitorWrapper() { delete monitor; }

 private:
  AXSelectionMonitor* monitor;
  Napi::ThreadSafeFunction callback_tsfn;

  Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!monitor) {
      Napi::Error::New(env, "Monitor not initialized").ThrowAsJavaScriptException();
      return env.Null();
    }
    return Napi::Boolean::New(env, monitor->start());
  }

  Napi::Value Stop(const Napi::CallbackInfo& info) {
    if (monitor) monitor->stop();
    return info.Env().Null();
  }

  Napi::Value GetCurrentSelection(const Napi::CallbackInfo& info) {
    if (!monitor) return Napi::String::New(info.Env(), "");
    return Napi::String::New(info.Env(), monitor->get_current_selection());
  }

  Napi::Value SetCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
      Napi::Error::New(env, "Function expected").ThrowAsJavaScriptException();
      return env.Null();
    }
    callback_tsfn = Napi::ThreadSafeFunction::New(env, info[0].As<Napi::Function>(), "AXCallback", 0, 1);
    monitor->set_callback([this](std::string text, int x, int y) {
      auto call = [text, x, y](Napi::Env env, Napi::Function jsCallback) {
        jsCallback.Call({Napi::String::New(env, text), Napi::Number::New(env, x),
                         Napi::Number::New(env, y)});
      };
      callback_tsfn.BlockingCall(call);
    });
    return env.Null();
  }

  Napi::Value TestFocusedElement(const Napi::CallbackInfo& info) { return info.Env().Null(); }

  Napi::Value IsTrusted(const Napi::CallbackInfo& info) {
    bool prompt = false;
    if (info.Length() >= 1 && info[0].IsBoolean()) prompt = info[0].As<Napi::Boolean>().Value();
    return Napi::Boolean::New(info.Env(), AXSelectionMonitor::trusted(prompt));
  }

  Napi::Value GetWordAtPoint(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
      Napi::Error::New(env, "getWordAtPoint(x, y) expects two numbers").ThrowAsJavaScriptException();
      return env.Null();
    }
    const int x = info[0].As<Napi::Number>().Int32Value();
    const int y = info[1].As<Napi::Number>().Int32Value();
    std::string text;
    int ox = x, oy = y;
    AXSelectionMonitor::wordAtPoint(x, y, &text, &ox, &oy);
    Napi::Object out = Napi::Object::New(env);
    out.Set("text", Napi::String::New(env, text));
    out.Set("x", Napi::Number::New(env, ox));
    out.Set("y", Napi::Number::New(env, oy));
    return out;
  }
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return AXSelectionMonitorWrapper::Init(env, exports);
}

NODE_API_MODULE(ax_selection_monitor, Init)
