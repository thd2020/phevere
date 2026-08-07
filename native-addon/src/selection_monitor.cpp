#include <napi.h>
#include <windows.h>
#include <UIAutomation.h>
#include <atlbase.h>
#include <string>
#include <thread>
#include <atomic>
#include <functional>
#include <iostream>
#include <chrono>
#include <mutex>

// Forward declaration of the handler class
class UIAutomationEventHandler;

class UIAutomationSelectionMonitor {
private:
    std::atomic<bool> running{false};
    std::thread monitor_thread;
    DWORD monitor_thread_id = 0; // Store thread ID to post messages to it
    std::function<void(std::string, int, int)> callback;
    std::string last_selection;
    
    // UIA object (will be created and used only on the monitor thread)
    CComPtr<IUIAutomation> pAutomation;

    // Static instance pointer for the event handler to call back into the class
    static UIAutomationSelectionMonitor* instance;

    // Debouncing mechanism
    std::thread debounce_thread;
    std::atomic<bool> debounce_running{false};
    std::mutex debounce_mutex;
    std::string pending_selection;
    int pending_x = 0;
    int pending_y = 0;
    std::chrono::steady_clock::time_point last_selection_time;
    static constexpr int DEBOUNCE_DELAY_MS = 500; // 500ms delay like Youdao Dictionary
    // Reject absurdly large payloads (a whole document is never a lookup query)
    static constexpr size_t MAX_SELECTION_BYTES = 8000;
    // Debug flag (enabled via env var PHEVERE_DEBUG_UIA=1)
    static bool debugEnabled;

    // Mouse hook and fallback tracking
    HHOOK hMouseHook = nullptr;
    HHOOK hKeyboardHook = nullptr;
    static POINT mouseDownPt;
    static std::chrono::steady_clock::time_point lastUiaEventTime;
    
    // Double-click detection and thread synchronization
    static POINT lastClickPt;
    static std::chrono::steady_clock::time_point lastClickTime;
    static std::atomic<int> active_fallback_threads;

    // Input gate: a UIA selection event is only trusted when the user actually
    // performed a selection gesture, and is not in the middle of typing.
    static constexpr long long USER_GESTURE_WINDOW_MS = 1500;
    static constexpr long long TYPING_QUIET_MS = 700;
    static std::atomic<long long> lastSelectGestureMs;
    static std::atomic<long long> lastTypingMs;
    static std::atomic<bool> leftButtonDown;
    static bool inputGateDisabled;

    static long long nowMs();
    static bool isUserSelectionGesture();
    
    void triggerSyntheticCopyFallback(int x, int y);
    static LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam);
    static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam);

public:
    UIAutomationSelectionMonitor() {
        instance = this;
        // Enable debug only when explicitly requested
        const char* dbg = std::getenv("PHEVERE_DEBUG_UIA");
        debugEnabled = (dbg && std::string(dbg) == "1");
        const char* gateOff = std::getenv("PHEVERE_DISABLE_INPUT_GATE");
        inputGateDisabled = (gateOff && std::string(gateOff) == "1");
        // COM will be initialized on the dedicated thread, not here.
        if (debugEnabled) std::cout << "[UIA] Constructor called" << std::endl;
    }

    ~UIAutomationSelectionMonitor() {
        stop();
        if (instance == this) {
            instance = nullptr;
        }
        if (debugEnabled) std::cout << "[UIA] Destructor called" << std::endl;
    }

    void set_callback(std::function<void(std::string, int, int)> cb) {
        callback = cb;
        if (debugEnabled) std::cout << "[UIA] Callback set successfully" << std::endl;
    }

    bool start() {
        if (running.load()) {
            if (debugEnabled) std::cout << "[UIA] Already running" << std::endl;
            return true;
        }

        if (debugEnabled) std::cout << "[UIA] Starting UIAutomation selection monitoring..." << std::endl;
        running.store(true);
        debounce_running.store(true);
        
        // Start the dedicated monitor thread
        monitor_thread = std::thread(&UIAutomationSelectionMonitor::monitorLoop, this);
        
        // Start the debounce thread
        debounce_thread = std::thread(&UIAutomationSelectionMonitor::debounceLoop, this);
        
        return true;
    }

    void stop() {
        if (!running.exchange(false)) {
            return; // Already stopped or stopping
        }

        if (debugEnabled) std::cout << "[UIA] Stopping UIAutomation selection monitoring..." << std::endl;
        
        // Stop debounce thread first
        debounce_running.store(false);
        if (debounce_thread.joinable()) {
            debounce_thread.join();
        }
        
        // Post a WM_QUIT message to the monitor thread to break its message loop
        if (monitor_thread_id != 0) {
            PostThreadMessage(monitor_thread_id, WM_QUIT, 0, 0);
        }
        
        // Wait for the thread to finish
        if (monitor_thread.joinable()) {
            monitor_thread.join();
        }
        monitor_thread_id = 0;

        // Wait for detached fallback threads so they never touch a destroyed instance
        for (int i = 0; i < 50 && active_fallback_threads.load() > 0; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        
        if (debugEnabled) std::cout << "[UIA] Selection monitoring stopped" << std::endl;
    }

    std::string get_current_selection() {
        return last_selection;
    }

    void test_focused_element() {
        if (debugEnabled) std::cout << "[UIA] test_focused_element is best handled by events in a multi-threaded model." << std::endl;
    }

private:
    void monitorLoop(); 
    void handleSelectionChanged(IUIAutomationElement* sender);
    void debounceLoop();
    void updatePendingSelection(const std::string& newSelection, int x, int y);

    std::string getSelectedTextFromElement(IUIAutomationElement* element);
    std::string getSelectedTextFromFocusedOrPoint();
    CComPtr<IUIAutomationElement> findAncestorWithTextPattern(IUIAutomationElement* start);
    bool getSelectionCenter(IUIAutomationElement* element, int& outX, int& outY);
    bool isFromCurrentProcess(IUIAutomationElement* element);

    class UIAutomationEventHandler : public IUIAutomationEventHandler {
    private:
        LONG refCount;
    public:
        UIAutomationEventHandler() : refCount(1) {}
        ~UIAutomationEventHandler() {}

        ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount); }
        ULONG STDMETHODCALLTYPE Release() override {
            LONG newCount = InterlockedDecrement(&refCount);
            if (newCount == 0) delete this;
            return newCount;
        }
        HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppvObject) override {
            if (riid == IID_IUnknown || riid == IID_IUIAutomationEventHandler) {
                *ppvObject = this;
                AddRef();
                return S_OK;
            }
            *ppvObject = nullptr;
            return E_NOINTERFACE;
        }

        HRESULT STDMETHODCALLTYPE HandleAutomationEvent(IUIAutomationElement* sender, EVENTID eventId) override {
            // Only TextSelectionChanged is a selection signal. TextChanged /
            // TextEdit_TextChanged fire on every keystroke and on any control
            // whose text is repainted (status bars, progress labels), which is
            // the main source of spurious popups.
            if (UIAutomationSelectionMonitor::instance && eventId == UIA_Text_TextSelectionChangedEventId) {
                UIAutomationSelectionMonitor::instance->handleSelectionChanged(sender);
            } else {
                if (UIAutomationSelectionMonitor::debugEnabled) std::cout << "[UIA] [?] UNKNOWN EVENT: " << eventId << std::endl;
            }
            return S_OK;
        }
    };
};
bool UIAutomationSelectionMonitor::debugEnabled = false;
bool UIAutomationSelectionMonitor::inputGateDisabled = false;

// Define static variables
UIAutomationSelectionMonitor* UIAutomationSelectionMonitor::instance = nullptr;
POINT UIAutomationSelectionMonitor::mouseDownPt = {0, 0};
std::chrono::steady_clock::time_point UIAutomationSelectionMonitor::lastUiaEventTime{};
POINT UIAutomationSelectionMonitor::lastClickPt = {0, 0};
std::chrono::steady_clock::time_point UIAutomationSelectionMonitor::lastClickTime = std::chrono::steady_clock::now();
std::atomic<int> UIAutomationSelectionMonitor::active_fallback_threads{0};
std::atomic<long long> UIAutomationSelectionMonitor::lastSelectGestureMs{0};
std::atomic<long long> UIAutomationSelectionMonitor::lastTypingMs{0};
std::atomic<bool> UIAutomationSelectionMonitor::leftButtonDown{false};

long long UIAutomationSelectionMonitor::nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
}

// A selection event is trusted only if the user made a selection gesture
// recently and is not mid-typing. Without this, background UI repaints and
// caret movement both look identical to a real selection.
bool UIAutomationSelectionMonitor::isUserSelectionGesture() {
    if (inputGateDisabled) return true;

    if (leftButtonDown.load()) {
        if (debugEnabled) std::cout << "[GATE] REJECT: drag still in progress" << std::endl;
        return false;
    }

    const long long now = nowMs();
    const long long gestureAge = now - lastSelectGestureMs.load();
    if (lastSelectGestureMs.load() == 0 || gestureAge > USER_GESTURE_WINDOW_MS) {
        if (debugEnabled) std::cout << "[GATE] REJECT: no selection gesture within " << USER_GESTURE_WINDOW_MS << "ms (age=" << gestureAge << ")" << std::endl;
        return false;
    }

    const long long typingAge = now - lastTypingMs.load();
    if (lastTypingMs.load() != 0 && typingAge < TYPING_QUIET_MS && typingAge < gestureAge) {
        if (debugEnabled) std::cout << "[GATE] REJECT: user is typing (typingAge=" << typingAge << ")" << std::endl;
        return false;
    }

    return true;
}

// Implementation of the monitor loop
void UIAutomationSelectionMonitor::monitorLoop() {
    if (debugEnabled) std::cout << "[UIA] THREAD: Starting dedicated UIA monitor thread..." << std::endl;

    lastUiaEventTime = std::chrono::steady_clock::time_point{};

    bool comInitialized = false;
    bool handlersRegistered = false;
    CComPtr<IUIAutomationElement> pDesktopElement;
    CComPtr<IUIAutomationEventHandler> pEventHandler;

    auto cleanupMonitorResources = [&]() {
        if (hMouseHook) {
            UnhookWindowsHookEx(hMouseHook);
            hMouseHook = nullptr;
        }
        if (hKeyboardHook) {
            UnhookWindowsHookEx(hKeyboardHook);
            hKeyboardHook = nullptr;
        }
        if (handlersRegistered && pAutomation && pDesktopElement && pEventHandler) {
            pAutomation->RemoveAutomationEventHandler(
                UIA_Text_TextSelectionChangedEventId, pDesktopElement, pEventHandler);
            handlersRegistered = false;
        }
        pEventHandler.Release();
        pDesktopElement.Release();
        pAutomation.Release();
        if (comInitialized) {
            CoUninitialize();
            comInitialized = false;
        }
    };

    struct MonitorLoopGuard {
        std::function<void()> cleanup;
        ~MonitorLoopGuard() { if (cleanup) cleanup(); }
    } guard{cleanupMonitorResources};
    
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        std::cerr << "[UIA] THREAD: Failed to initialize COM. HRESULT: " << hr << std::endl;
        return;
    }
    comInitialized = true;
    
    monitor_thread_id = GetCurrentThreadId();
    if (debugEnabled) std::cout << "[UIA] THREAD: COM initialized, thread ID: " << monitor_thread_id << std::endl;
    
    hr = CoCreateInstance(__uuidof(CUIAutomation), NULL, CLSCTX_INPROC_SERVER, __uuidof(IUIAutomation), (void**)&pAutomation);
    if (FAILED(hr) || !pAutomation) {
        std::cerr << "[UIA] THREAD: Failed to create UIA object. HRESULT: " << hr << std::endl;
        return;
    }
    if (debugEnabled) std::cout << "[UIA] THREAD: UIA object created successfully" << std::endl;

    hr = pAutomation->GetRootElement(&pDesktopElement);
    if (FAILED(hr) || !pDesktopElement) {
        std::cerr << "[UIA] THREAD: Failed to get root element. HRESULT: " << hr << std::endl;
        return;
    }
    if (debugEnabled) std::cout << "[UIA] THREAD: Desktop element obtained successfully" << std::endl;

    pEventHandler = new UIAutomationEventHandler();
    if (debugEnabled) std::cout << "[UIA] THREAD: Registering TextSelectionChanged event handler..." << std::endl;
    HRESULT hrSel = pAutomation->AddAutomationEventHandler(
        UIA_Text_TextSelectionChangedEventId,
        pDesktopElement,
        TreeScope_Subtree,
        nullptr,
        pEventHandler
    );

    if (SUCCEEDED(hrSel)) {
        handlersRegistered = true;
        if (debugEnabled) std::cout << "[UIA] THREAD: Event handler registered. Waiting for events..." << std::endl;
    } else {
        std::cerr << "[UIA] THREAD: Failed to register TextSelectionChanged handler. HRESULT: " << hrSel << std::endl;
    }

    if (debugEnabled) std::cout << "[UIA] THREAD: Installing input hooks and entering message loop..." << std::endl;
    
    hMouseHook = SetWindowsHookEx(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandle(nullptr), 0);
    if (!hMouseHook) {
        std::cerr << "[UIA] THREAD: Failed to install low-level mouse hook." << std::endl;
    }

    hKeyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandle(nullptr), 0);
    if (!hKeyboardHook) {
        std::cerr << "[UIA] THREAD: Failed to install low-level keyboard hook." << std::endl;
    }

    MSG msg;
    while (running.load() && GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    if (debugEnabled) std::cout << "[UIA] THREAD: Message loop exited. Cleaning up..." << std::endl;
}

void UIAutomationSelectionMonitor::handleSelectionChanged(IUIAutomationElement* sender) {
    if (!sender) return;

    lastUiaEventTime = std::chrono::steady_clock::now();

    if (isFromCurrentProcess(sender)) {
        if (debugEnabled) std::cout << "[UIA] IGNORE: Selection from current process (popup/app window)" << std::endl;
        return;
    }

    if (!isUserSelectionGesture()) {
        return;
    }

    std::string selectedText = getSelectedTextFromElement(sender);
    if (selectedText.empty()) {
        selectedText = getSelectedTextFromFocusedOrPoint();
    }
    int selX = 0, selY = 0;
    if (!getSelectionCenter(sender, selX, selY)) {
        POINT pt; GetCursorPos(&pt); selX = pt.x; selY = pt.y;
    }

    if (!selectedText.empty()) {
        updatePendingSelection(selectedText, selX, selY);
    }
}

void UIAutomationSelectionMonitor::updatePendingSelection(const std::string& newSelection, int x, int y) {
    std::lock_guard<std::mutex> lock(debounce_mutex);
    pending_selection = newSelection;
    pending_x = x;
    pending_y = y;
    last_selection_time = std::chrono::steady_clock::now();
}

void UIAutomationSelectionMonitor::debounceLoop() {
    if (debugEnabled) std::cout << "[UIA] DEBOUNCE: Starting debounce thread..." << std::endl;
    
    while (debounce_running.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        
        std::lock_guard<std::mutex> lock(debounce_mutex);
        
        if (!pending_selection.empty()) {
            auto now = std::chrono::steady_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_selection_time);
            
            if (elapsed.count() >= DEBOUNCE_DELAY_MS) {
                last_selection = pending_selection;
                if (debugEnabled) std::cout << "[UIA] DEBOUNCE: Selection settled after " << elapsed.count() << "ms: \"" << pending_selection << "\"" << std::endl;

                if (callback) {
                    callback(pending_selection, pending_x, pending_y);
                }

                pending_selection.clear();
            }
        }
    }
    
    if (debugEnabled) std::cout << "[UIA] DEBOUNCE: Debounce thread stopped." << std::endl;
}

static std::string bstrToUtf8(BSTR bstr) {
    if (!bstr) return "";
    int len = SysStringLen(bstr);
    if (len == 0) return "";
    
    std::wstring_view wsv(bstr, len);
    int size_needed = WideCharToMultiByte(CP_UTF8, 0, &wsv[0], (int)wsv.size(), NULL, 0, NULL, NULL);
    if (size_needed <= 0) return "";
    
    std::string result(size_needed, 0);
    WideCharToMultiByte(CP_UTF8, 0, &wsv[0], (int)wsv.size(), &result[0], size_needed, NULL, NULL);
    return result;
}

// Only a real, non-degenerate TextPattern selection counts. ValuePattern and
// LegacyIAccessible return the whole control's text even when nothing is
// selected, which turns a bare caret click or a repainted status label into a
// "selection".
std::string UIAutomationSelectionMonitor::getSelectedTextFromElement(IUIAutomationElement* element) {
    if (!element) return "";

    CComPtr<IUIAutomationTextPattern> pTextPattern;
    HRESULT hr = element->GetCurrentPattern(UIA_TextPatternId, (IUnknown**)&pTextPattern);
    if (FAILED(hr) || !pTextPattern) {
        CComPtr<IUIAutomationElement> withText = findAncestorWithTextPattern(element);
        if (!withText) return "";
        pTextPattern.Release();
        if (FAILED(withText->GetCurrentPattern(UIA_TextPatternId, (IUnknown**)&pTextPattern)) || !pTextPattern) {
            return "";
        }
    }

    CComPtr<IUIAutomationTextRangeArray> pSelection;
    if (FAILED(pTextPattern->GetSelection(&pSelection)) || !pSelection) return "";

    int len = 0;
    pSelection->get_Length(&len);
    if (len <= 0) return "";

    CComPtr<IUIAutomationTextRange> pRange;
    pSelection->GetElement(0, &pRange);
    if (!pRange) return "";

    BSTR bstr = nullptr;
    pRange->GetText(-1, &bstr);
    std::string res;
    if (bstr) {
        if (SysStringLen(bstr) > 0) res = bstrToUtf8(bstr);
        SysFreeString(bstr);
    }

    // A degenerate range (caret with no selection) yields empty/whitespace text.
    if (res.find_first_not_of(" \t\r\n\f\v") == std::string::npos) return "";
    if (res.size() > MAX_SELECTION_BYTES) {
        if (debugEnabled) std::cout << "[UIA] IGNORE: selection too large (" << res.size() << " bytes)" << std::endl;
        return "";
    }

    return res;
}

bool UIAutomationSelectionMonitor::isFromCurrentProcess(IUIAutomationElement* element) {
    if (!element) return false;
    VARIANT v; VariantInit(&v);
    HRESULT hr = element->GetCurrentPropertyValue(UIA_ProcessIdPropertyId, &v);
    if (FAILED(hr)) { VariantClear(&v); return false; }
    bool isCurrent = false;
    if (v.vt == VT_I4 || v.vt == VT_INT) {
        DWORD pid = (v.vt == VT_I4) ? (DWORD)v.lVal : (DWORD)v.intVal;
        isCurrent = (pid == GetCurrentProcessId());
    }
    VariantClear(&v);
    return isCurrent;
}

std::string UIAutomationSelectionMonitor::getSelectedTextFromFocusedOrPoint() {
    if (!pAutomation) return "";

    CComPtr<IUIAutomationElement> focused;
    if (SUCCEEDED(pAutomation->GetFocusedElement(&focused)) && focused) {
        std::string text = getSelectedTextFromElement(focused);
        if (!text.empty()) return text;
    }

    POINT pt; GetCursorPos(&pt);
    CComPtr<IUIAutomationElement> atPoint;
    if (SUCCEEDED(pAutomation->ElementFromPoint(pt, &atPoint)) && atPoint) {
        std::string text = getSelectedTextFromElement(atPoint);
        if (!text.empty()) return text;
    }

    return "";
}

CComPtr<IUIAutomationElement> UIAutomationSelectionMonitor::findAncestorWithTextPattern(IUIAutomationElement* start) {
    if (!start || !pAutomation) return nullptr;
    CComPtr<IUIAutomationTreeWalker> walker;
    if (FAILED(pAutomation->get_ControlViewWalker(&walker)) || !walker) return nullptr;

    CComPtr<IUIAutomationElement> current = start;
    for (int i = 0; i < 5 && current; ++i) {
        VARIANT v;
        VariantInit(&v);
        if (SUCCEEDED(current->GetCurrentPropertyValue(UIA_IsTextPatternAvailablePropertyId, &v))) {
            if (v.vt == VT_BOOL && v.boolVal == VARIANT_TRUE) {
                VariantClear(&v);
                return current;
            }
        }
        VariantClear(&v);
        CComPtr<IUIAutomationElement> parent;
        if (FAILED(walker->GetParentElement(current, &parent)) || !parent) break;
        current = parent;
    }
    return nullptr;
}

bool UIAutomationSelectionMonitor::getSelectionCenter(IUIAutomationElement* element, int& outX, int& outY) {
    outX = 0; outY = 0;
    if (!element) return false;

    CComPtr<IUIAutomationTextPattern> pTextPattern;
    HRESULT hr = element->GetCurrentPattern(UIA_TextPatternId, (IUnknown**)&pTextPattern);
    if (FAILED(hr) || !pTextPattern) return false;

    CComPtr<IUIAutomationTextRangeArray> pSelection;
    hr = pTextPattern->GetSelection(&pSelection);
    if (FAILED(hr) || !pSelection) return false;

    int selectionLength = 0;
    pSelection->get_Length(&selectionLength);
    if (selectionLength == 0) return false;

    CComPtr<IUIAutomationTextRange> pRange;
    pSelection->GetElement(0, &pRange);
    if (!pRange) return false;

    SAFEARRAY* rects = nullptr;
    hr = pRange->GetBoundingRectangles(&rects);
    if (FAILED(hr) || !rects) return false;

    LONG lBound = 0, uBound = -1;
    SafeArrayGetLBound(rects, 1, &lBound);
    SafeArrayGetUBound(rects, 1, &uBound);
    LONG count = (uBound >= lBound) ? (uBound - lBound + 1) : 0;
    if (count < 4) {
        SafeArrayDestroy(rects);
        return false;
    }

    double* data = nullptr;
    hr = SafeArrayAccessData(rects, (void**)&data);
    if (FAILED(hr) || !data) {
        SafeArrayDestroy(rects);
        return false;
    }

    double sumX = 0.0, sumY = 0.0; int rectCount = 0;
    double minLeft = 1e12, minTop = 1e12;
    for (LONG i = 0; i + 3 < count; i += 4) {
        double left = data[i];
        double top = data[i+1];
        double width = data[i+2];
        double height = data[i+3];
        if (width <= 0 || height <= 0) continue;
        sumX += (left + width / 2.0);
        sumY += (top + height / 2.0);
        rectCount++;
        if (left < minLeft) minLeft = left;
        if (top < minTop) minTop = top;
    }

    SafeArrayUnaccessData(rects);
    SafeArrayDestroy(rects);

    if (rectCount == 0) return false;

    outX = static_cast<int>(minLeft);
    outY = static_cast<int>(minTop);
    return true;
}

void UIAutomationSelectionMonitor::triggerSyntheticCopyFallback(int x, int y) {
    auto now = std::chrono::steady_clock::now();
    auto elapsedSinceUia = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastUiaEventTime).count();
    if (elapsedSinceUia < 150) {
        if (debugEnabled) std::cout << "[FALLBACK] UIA already handled this selection. Aborting fallback." << std::endl;
        return;
    }

    if (debugEnabled) std::cout << "[FALLBACK] No UIA event detected. Triggering synthetic Ctrl+C..." << std::endl;

    const DWORD clipboardSeqBefore = GetClipboardSequenceNumber();

    std::wstring backupText;
    if (OpenClipboard(nullptr)) {
        HANDLE hData = GetClipboardData(CF_UNICODETEXT);
        if (hData) {
            wchar_t* pszText = static_cast<wchar_t*>(GlobalLock(hData));
            if (pszText) {
                backupText = pszText;
                GlobalUnlock(hData);
            }
        }
        CloseClipboard();
    }

    auto fillKeyEvent = [](INPUT& input, WORD vk, DWORD flags) {
        input.type = INPUT_KEYBOARD;
        input.ki.wVk = vk;
        input.ki.wScan = static_cast<WORD>(MapVirtualKey(vk, MAPVK_VK_TO_VSC));
        input.ki.dwFlags = flags;
    };
    INPUT inputs[4] = {};
    fillKeyEvent(inputs[0], VK_CONTROL, 0);
    fillKeyEvent(inputs[1], static_cast<WORD>('C'), 0);
    fillKeyEvent(inputs[2], static_cast<WORD>('C'), KEYEVENTF_KEYUP);
    fillKeyEvent(inputs[3], VK_CONTROL, KEYEVENTF_KEYUP);

    SendInput(4, inputs, sizeof(INPUT));

    std::this_thread::sleep_for(std::chrono::milliseconds(120));

    // If the clipboard never changed, the Ctrl+C hit something with no
    // selection (a scrollbar drag, a slider, an empty canvas). Reading it
    // anyway would resurface whatever the user copied earlier.
    if (GetClipboardSequenceNumber() == clipboardSeqBefore) {
        if (debugEnabled) std::cout << "[FALLBACK] Clipboard unchanged; no selection to capture." << std::endl;
        return;
    }

    std::string capturedText = "";
    if (OpenClipboard(nullptr)) {
        HANDLE hData = GetClipboardData(CF_UNICODETEXT);
        if (hData) {
            wchar_t* pszText = static_cast<wchar_t*>(GlobalLock(hData));
            if (pszText && wcslen(pszText) > 0) {
                std::wstring_view wsv(pszText);
                int size_needed = WideCharToMultiByte(CP_UTF8, 0, &wsv[0], (int)wsv.size(), NULL, 0, NULL, NULL);
                if (size_needed > 0) {
                    capturedText.resize(size_needed, 0);
                    WideCharToMultiByte(CP_UTF8, 0, &wsv[0], (int)wsv.size(), &capturedText[0], size_needed, NULL, NULL);
                }
                GlobalUnlock(hData);
            }
        }
        CloseClipboard();
    }

    if (OpenClipboard(nullptr)) {
        EmptyClipboard();
        if (!backupText.empty()) {
            size_t sizeInBytes = (backupText.size() + 1) * sizeof(wchar_t);
            HGLOBAL hGlobal = GlobalAlloc(GMEM_MOVEABLE, sizeInBytes);
            if (hGlobal) {
                void* locked = GlobalLock(hGlobal);
                if (locked) {
                    memcpy(locked, backupText.c_str(), sizeInBytes);
                    GlobalUnlock(hGlobal);
                    SetClipboardData(CF_UNICODETEXT, hGlobal);
                } else {
                    GlobalFree(hGlobal);
                }
            }
        }
        CloseClipboard();
    }

    if (!capturedText.empty() && capturedText.size() <= MAX_SELECTION_BYTES) {
        if (debugEnabled) std::cout << "[FALLBACK] Captured text: \"" << capturedText << "\"" << std::endl;
        updatePendingSelection(capturedText, x, y);
    }
}

LRESULT CALLBACK UIAutomationSelectionMonitor::LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && instance) {
        MSLLHOOKSTRUCT* pMouseStruct = reinterpret_cast<MSLLHOOKSTRUCT*>(lParam);

        if (wParam == WM_LBUTTONDOWN) {
            mouseDownPt = pMouseStruct->pt;
            leftButtonDown.store(true);
        } 
        else if (wParam == WM_LBUTTONUP) {
            leftButtonDown.store(false);

            int dx = std::abs(pMouseStruct->pt.x - mouseDownPt.x);
            int dy = std::abs(pMouseStruct->pt.y - mouseDownPt.y);

            auto now = std::chrono::steady_clock::now();
            auto elapsedClickMs = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastClickTime).count();
            int clickDx = std::abs(pMouseStruct->pt.x - lastClickPt.x);
            int clickDy = std::abs(pMouseStruct->pt.y - lastClickPt.y);

            bool isDoubleClick = (elapsedClickMs <= GetDoubleClickTime()) && (clickDx <= 5 && clickDy <= 5);

            lastClickTime = now;
            lastClickPt = pMouseStruct->pt;

            if (dx > 15 || dy > 15 || isDoubleClick) {
                // A drag or multi-click is the only mouse gesture that selects text.
                // A plain click just moves the caret and must not arm the monitor.
                lastSelectGestureMs.store(nowMs());

                int dropX = pMouseStruct->pt.x;
                int dropY = pMouseStruct->pt.y;
                
                std::thread([dropX, dropY]() {
                    active_fallback_threads.fetch_add(1);
                    std::this_thread::sleep_for(std::chrono::milliseconds(100));
                    if (instance && instance->running.load()) {
                        instance->triggerSyntheticCopyFallback(dropX, dropY);
                    }
                    active_fallback_threads.fetch_sub(1);
                }).detach();
            }
        }
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

// Classifies keystrokes so the monitor can tell "the user is selecting" from
// "the user is typing". Nothing is recorded about which keys were pressed.
LRESULT CALLBACK UIAutomationSelectionMonitor::LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION && instance && (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN)) {
        KBDLLHOOKSTRUCT* pKey = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
        const DWORD vk = pKey->vkCode;

        const bool shiftDown = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
        const bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;

        const bool isNavKey =
            vk == VK_LEFT || vk == VK_RIGHT || vk == VK_UP || vk == VK_DOWN ||
            vk == VK_HOME || vk == VK_END || vk == VK_PRIOR || vk == VK_NEXT;

        const bool isModifier =
            vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT ||
            vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL ||
            vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU ||
            vk == VK_LWIN || vk == VK_RWIN || vk == VK_CAPITAL;

        if ((shiftDown && isNavKey) || (ctrlDown && vk == 'A')) {
            lastSelectGestureMs.store(nowMs());
        } else if (!isModifier && !ctrlDown) {
            lastTypingMs.store(nowMs());
        }
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

class UIAutomationSelectionMonitorWrapper : public Napi::ObjectWrap<UIAutomationSelectionMonitorWrapper> {
private:
    UIAutomationSelectionMonitor* monitor;
    Napi::ThreadSafeFunction callback_tsfn;

public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "UIAutomationSelectionMonitor", {
            InstanceMethod("start", &UIAutomationSelectionMonitorWrapper::Start),
            InstanceMethod("stop", &UIAutomationSelectionMonitorWrapper::Stop),
            InstanceMethod("getCurrentSelection", &UIAutomationSelectionMonitorWrapper::GetCurrentSelection),
            InstanceMethod("setCallback", &UIAutomationSelectionMonitorWrapper::SetCallback),
            InstanceMethod("testFocusedElement", &UIAutomationSelectionMonitorWrapper::TestFocusedElement),
        });

        exports.Set("UIAutomationSelectionMonitor", func);
        return exports;
    }

    UIAutomationSelectionMonitorWrapper(const Napi::CallbackInfo& info) 
        : Napi::ObjectWrap<UIAutomationSelectionMonitorWrapper>(info), monitor(nullptr) {
        monitor = new UIAutomationSelectionMonitor();
    }

    ~UIAutomationSelectionMonitorWrapper() {
        if (monitor) {
            delete monitor;
        }
    }

    Napi::Value Start(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!monitor) {
            Napi::Error::New(env, "Monitor not initialized").ThrowAsJavaScriptException();
            return env.Null();
        }

        bool result = monitor->start();
        return Napi::Boolean::New(env, result);
    }

    Napi::Value Stop(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!monitor) {
            return env.Null();
        }

        monitor->stop();
        return env.Null();
    }

    Napi::Value GetCurrentSelection(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!monitor) {
            return Napi::String::New(env, "");
        }

        std::string selection = monitor->get_current_selection();
        return Napi::String::New(env, selection);
    }

    Napi::Value SetCallback(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsFunction()) {
            Napi::Error::New(env, "Function expected").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Function callback = info[0].As<Napi::Function>();
        callback_tsfn = Napi::ThreadSafeFunction::New(env, callback, "UIAutomationCallback", 0, 1);

        monitor->set_callback([this](std::string text, int x, int y) {
            auto callback = [text, x, y](Napi::Env env, Napi::Function jsCallback) {
                jsCallback.Call({
                    Napi::String::New(env, text),
                    Napi::Number::New(env, x),
                    Napi::Number::New(env, y)
                });
            };
            callback_tsfn.BlockingCall(callback);
        });

        return env.Null();
    }

    Napi::Value TestFocusedElement(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (!monitor) {
            Napi::Error::New(env, "Monitor not initialized").ThrowAsJavaScriptException();
            return env.Null();
        }

        monitor->test_focused_element();
        return env.Null();
    }
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return UIAutomationSelectionMonitorWrapper::Init(env, exports);
}

NODE_API_MODULE(uiautomation_selection_monitor, Init)