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
    // Debug flag (enabled via env var PHEVERE_DEBUG_UIA=1)
    static bool debugEnabled;

public:
    UIAutomationSelectionMonitor() {
        instance = this;
        // Enable debug only when explicitly requested
        const char* dbg = std::getenv("PHEVERE_DEBUG_UIA");
        debugEnabled = (dbg && std::string(dbg) == "1");
        // COM will be initialized on the dedicated thread, not here.
        if (debugEnabled) std::cout << "[UIA] Constructor called" << std::endl;
    }

    ~UIAutomationSelectionMonitor() {
        stop();
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
        
        if (debugEnabled) std::cout << "[UIA] Selection monitoring stopped" << std::endl;
    }

    std::string get_current_selection() {
        return last_selection;
    }

    void test_focused_element() {
        // This is tricky because pAutomation lives on another thread.
        // For testing, it's better to rely on the event-driven approach.
        // If you must have this, you'd need to use PostThreadMessage to ask
        // the monitor thread to perform the check and return the result, which is complex.
        if (debugEnabled) std::cout << "[UIA] test_focused_element is best handled by events in a multi-threaded model." << std::endl;
    }

private:
    // This is the main function for our dedicated UIA thread
    void monitorLoop(); 

    // This method is called by the event handler when an event is received
    void handleSelectionChanged(IUIAutomationElement* sender);

    // Debouncing mechanism
    void debounceLoop();
    void updatePendingSelection(const std::string& newSelection, int x, int y);

    std::string getSelectedTextFromElement(IUIAutomationElement* element);
    std::string getSelectedTextFromFocusedOrPoint();
    CComPtr<IUIAutomationElement> findAncestorWithTextPattern(IUIAutomationElement* start);
    bool getSelectionCenter(IUIAutomationElement* element, int& outX, int& outY);
    bool isFromCurrentProcess(IUIAutomationElement* element);

    // Event handler class implementation remains inside the .cpp file
    class UIAutomationEventHandler : public IUIAutomationEventHandler {
    private:
        LONG refCount;
    public:
        UIAutomationEventHandler() : refCount(1) {}
        ~UIAutomationEventHandler() {}

        // IUnknown methods
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

        // The actual event handler callback
        HRESULT STDMETHODCALLTYPE HandleAutomationEvent(IUIAutomationElement* sender, EVENTID eventId) override {
            // Treat multiple text-related events as potential selection changes.
            // Many apps/browsers fire different events; we debounce downstream.
            if (UIAutomationSelectionMonitor::instance && (
                eventId == UIA_Text_TextSelectionChangedEventId ||
                eventId == UIA_Text_TextChangedEventId ||
                eventId == UIA_TextEdit_TextChangedEventId
            )) {
                UIAutomationSelectionMonitor::instance->handleSelectionChanged(sender);
            } else {
                if (UIAutomationSelectionMonitor::debugEnabled) std::cout << "[UIA] ❓ UNKNOWN EVENT: " << eventId << std::endl;
            }
            return S_OK;
        }
    };
};
bool UIAutomationSelectionMonitor::debugEnabled = false;

// Define the static instance pointer
UIAutomationSelectionMonitor* UIAutomationSelectionMonitor::instance = nullptr;

// Implementation of the monitor loop
void UIAutomationSelectionMonitor::monitorLoop() {
    if (debugEnabled) std::cout << "[UIA] THREAD: Starting dedicated UIA monitor thread..." << std::endl;
    
    // Step 1: Initialize COM on this thread
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) {
        std::cerr << "[UIA] THREAD: Failed to initialize COM. HRESULT: " << hr << std::endl;
        return;
    }
    
    monitor_thread_id = GetCurrentThreadId();
    if (debugEnabled) std::cout << "[UIA] THREAD: COM initialized, thread ID: " << monitor_thread_id << std::endl;
    
    // Step 2: Create UIA objects on this thread
    hr = CoCreateInstance(__uuidof(CUIAutomation), NULL, CLSCTX_INPROC_SERVER, __uuidof(IUIAutomation), (void**)&pAutomation);
    if (FAILED(hr) || !pAutomation) {
        std::cerr << "[UIA] THREAD: Failed to create UIA object. HRESULT: " << hr << std::endl;
        CoUninitialize();
        return;
    }
    if (debugEnabled) std::cout << "[UIA] THREAD: UIA object created successfully" << std::endl;

    CComPtr<IUIAutomationElement> pDesktopElement;
    hr = pAutomation->GetRootElement(&pDesktopElement);
    if (FAILED(hr) || !pDesktopElement) {
        std::cerr << "[UIA] THREAD: Failed to get root element. HRESULT: " << hr << std::endl;
        pAutomation.Release();
        CoUninitialize();
        return;
    }
    if (debugEnabled) std::cout << "[UIA] THREAD: Desktop element obtained successfully" << std::endl;

    // Step 3: Create and register the event handler
    CComPtr<IUIAutomationEventHandler> pEventHandler = new UIAutomationEventHandler();
    if (debugEnabled) std::cout << "[UIA] THREAD: Registering text-related event handlers..." << std::endl;
    HRESULT hrSel = pAutomation->AddAutomationEventHandler(
        UIA_Text_TextSelectionChangedEventId,
        pDesktopElement,
        TreeScope_Subtree,
        nullptr,
        pEventHandler
    );

    HRESULT hrChanged = pAutomation->AddAutomationEventHandler(
        UIA_Text_TextChangedEventId,
        pDesktopElement,
        TreeScope_Subtree,
        nullptr,
        pEventHandler
    );

    // TextEdit-specific changes (some providers use this)
    HRESULT hrEditChanged = pAutomation->AddAutomationEventHandler(
        UIA_TextEdit_TextChangedEventId,
        pDesktopElement,
        TreeScope_Subtree,
        nullptr,
        pEventHandler
    );

    if (FAILED(hrSel)) {
        std::cerr << "[UIA] THREAD: Failed to register TextSelectionChanged handler. HRESULT: " << hrSel << std::endl;
    }
    if (FAILED(hrChanged)) {
        if (debugEnabled) std::cout << "[UIA] THREAD: TextChanged handler registration failed (may be unsupported). HRESULT: " << hrChanged << std::endl;
    }
    if (FAILED(hrEditChanged)) {
        if (debugEnabled) std::cout << "[UIA] THREAD: TextEdit_TextChanged handler registration failed (may be unsupported). HRESULT: " << hrEditChanged << std::endl;
    }
    if (SUCCEEDED(hrSel) || SUCCEEDED(hrChanged) || SUCCEEDED(hrEditChanged)) {
        if (debugEnabled) std::cout << "[UIA] THREAD: Event handlers registered. Waiting for events..." << std::endl;
    } else {
        std::cerr << "[UIA] THREAD: No text-related handlers could be registered." << std::endl;
    }

    // Step 4: Run the message loop
    if (debugEnabled) std::cout << "[UIA] THREAD: Entering Windows message loop..." << std::endl;
    MSG msg;
    while (running.load() && GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    
    // Step 5: Clean up
    if (debugEnabled) std::cout << "[UIA] THREAD: Message loop exited. Cleaning up..." << std::endl;
    // Best-effort unregister (ignore failures)
    pAutomation->RemoveAutomationEventHandler(UIA_Text_TextSelectionChangedEventId, pDesktopElement, pEventHandler);
    pAutomation->RemoveAutomationEventHandler(UIA_Text_TextChangedEventId, pDesktopElement, pEventHandler);
    pAutomation->RemoveAutomationEventHandler(UIA_TextEdit_TextChangedEventId, pDesktopElement, pEventHandler);
    pEventHandler.Release();
    pDesktopElement.Release();
    pAutomation.Release();
    CoUninitialize();
    if (debugEnabled) std::cout << "[UIA] THREAD: Cleanup complete." << std::endl;
}

// Implementation of the selection handler (now debounced)
void UIAutomationSelectionMonitor::handleSelectionChanged(IUIAutomationElement* sender) {
    if (!sender) return;

    // Ignore events coming from our own Electron process to avoid self-triggering
    if (isFromCurrentProcess(sender)) {
        if (debugEnabled) std::cout << "[UIA] IGNORE: Selection from current process (popup/app window)" << std::endl;
        return;
    }

    std::string selectedText = getSelectedTextFromElement(sender);
    if (selectedText.empty()) {
        // Fallback: try focused element or element under cursor
        selectedText = getSelectedTextFromFocusedOrPoint();
    }
    int selX = 0, selY = 0;
    if (!getSelectionCenter(sender, selX, selY)) {
        // Fallback to current cursor if we cannot compute the rectangle
        POINT pt; GetCursorPos(&pt); selX = pt.x; selY = pt.y;
    }

    if (!selectedText.empty()) {
        // Only log in debug mode - too verbose for normal operation
        // std::cout << "[UIA] EVENT: Raw selection detected: \"" << selectedText << "\"" << std::endl;
        updatePendingSelection(selectedText, selX, selY);
    }
}

// Debouncing mechanism implementation
void UIAutomationSelectionMonitor::updatePendingSelection(const std::string& newSelection, int x, int y) {
    std::lock_guard<std::mutex> lock(debounce_mutex);
    pending_selection = newSelection;
    pending_x = x;
    pending_y = y;
    last_selection_time = std::chrono::steady_clock::now();
    // Only log in debug mode - too verbose for normal operation
    // std::cout << "[UIA] DEBOUNCE: Updated pending selection: \"" << newSelection << "\"" << std::endl;
}

void UIAutomationSelectionMonitor::debounceLoop() {
    if (debugEnabled) std::cout << "[UIA] DEBOUNCE: Starting debounce thread..." << std::endl;
    
    while (debounce_running.load()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50)); // Check every 50ms
        
        std::lock_guard<std::mutex> lock(debounce_mutex);
        
        if (!pending_selection.empty()) {
            auto now = std::chrono::steady_clock::now();
            auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - last_selection_time);
            
            if (elapsed.count() >= DEBOUNCE_DELAY_MS) {
                // Selection has settled, always notify (even if same text as before)
                // This allows re-triggering the popup when the same word is selected again
                last_selection = pending_selection;
                if (debugEnabled) std::cout << "[UIA] DEBOUNCE: Selection settled after " << elapsed.count() << "ms: \"" << pending_selection << "\"" << std::endl;

                if (callback) {
                    callback(pending_selection, pending_x, pending_y);
                }

                pending_selection.clear(); // Clear pending selection
            }
        }
    }
    
    if (debugEnabled) std::cout << "[UIA] DEBOUNCE: Debounce thread stopped." << std::endl;
}

// Implementation of the text retrieval function
std::string UIAutomationSelectionMonitor::getSelectedTextFromElement(IUIAutomationElement* element) {
    if (!element) return "";

    CComPtr<IUIAutomationTextPattern> pTextPattern;
    HRESULT hr = element->GetCurrentPattern(UIA_TextPatternId, (IUnknown**)&pTextPattern);
    if (FAILED(hr) || !pTextPattern) {
        // Try to find an ancestor that supports TextPattern
        CComPtr<IUIAutomationElement> withText = findAncestorWithTextPattern(element);
        if (withText) {
            element = withText;
            pTextPattern.Release();
            hr = element->GetCurrentPattern(UIA_TextPatternId, (IUnknown**)&pTextPattern);
        }
        if (FAILED(hr) || !pTextPattern) {
            return ""; // No TextPattern available in chain
        }
    }

    CComPtr<IUIAutomationTextRangeArray> pSelection;
    hr = pTextPattern->GetSelection(&pSelection);
    if (FAILED(hr) || !pSelection) {
        return "";
    }

    int selectionLength = 0;
    pSelection->get_Length(&selectionLength);
    if (selectionLength == 0) {
        return "";
    }

    CComPtr<IUIAutomationTextRange> pRange;
    pSelection->GetElement(0, &pRange);
    if (!pRange) return "";

    BSTR bstr = nullptr;
    pRange->GetText(-1, &bstr);
    if (!bstr) return "";

    // Convert BSTR (wide string) to std::string (UTF-8)
    std::wstring_view wsv(bstr, SysStringLen(bstr));
    int size_needed = WideCharToMultiByte(CP_UTF8, 0, &wsv[0], (int)wsv.size(), NULL, 0, NULL, NULL);
    std::string result(size_needed, 0);
    WideCharToMultiByte(CP_UTF8, 0, &wsv[0], (int)wsv.size(), &result[0], size_needed, NULL, NULL);
    
    SysFreeString(bstr);
    return result;
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

// Attempt to retrieve selection text from focused element or element under cursor
std::string UIAutomationSelectionMonitor::getSelectedTextFromFocusedOrPoint() {
    if (!pAutomation) return "";

    // Try focused element first
    CComPtr<IUIAutomationElement> focused;
    if (SUCCEEDED(pAutomation->GetFocusedElement(&focused)) && focused) {
        std::string text = getSelectedTextFromElement(focused);
        if (!text.empty()) return text;
    }

    // Try element under cursor
    POINT pt; GetCursorPos(&pt);
    CComPtr<IUIAutomationElement> atPoint;
    if (SUCCEEDED(pAutomation->ElementFromPoint(pt, &atPoint)) && atPoint) {
        std::string text = getSelectedTextFromElement(atPoint);
        if (!text.empty()) return text;
    }

    return "";
}

// Walk up the tree to find an ancestor that supports TextPattern
CComPtr<IUIAutomationElement> UIAutomationSelectionMonitor::findAncestorWithTextPattern(IUIAutomationElement* start) {
    if (!start || !pAutomation) return nullptr;
    CComPtr<IUIAutomationTreeWalker> walker;
    if (FAILED(pAutomation->get_ControlViewWalker(&walker)) || !walker) return nullptr;

    CComPtr<IUIAutomationElement> current = start;
    for (int i = 0; i < 5 && current; ++i) { // Limit depth to avoid long climbs
        // Check TextPattern on current
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

// Try to compute the geometric center of the selected text using UIA bounding rectangles
bool UIAutomationSelectionMonitor::getSelectionCenter(IUIAutomationElement* element, int& outX, int& outY) {
    outX = 0; outY = 0;
    if (!element) return false;

    CComPtr<IUIAutomationTextPattern> pTextPattern;
    HRESULT hr = element->GetCurrentPattern(UIA_TextPatternId, (IUnknown**)&pTextPattern);
    if (FAILED(hr) || !pTextPattern) {
        return false;
    }

    CComPtr<IUIAutomationTextRangeArray> pSelection;
    hr = pTextPattern->GetSelection(&pSelection);
    if (FAILED(hr) || !pSelection) {
        return false;
    }

    int selectionLength = 0;
    pSelection->get_Length(&selectionLength);
    if (selectionLength == 0) {
        return false;
    }

    CComPtr<IUIAutomationTextRange> pRange;
    pSelection->GetElement(0, &pRange);
    if (!pRange) return false;

    SAFEARRAY* rects = nullptr;
    hr = pRange->GetBoundingRectangles(&rects);
    if (FAILED(hr) || !rects) {
        return false;
    }

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

    // Each rectangle: left, top, width, height
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

    // Prefer left/top anchor for precise popup placement near selection start
    outX = static_cast<int>(minLeft);
    outY = static_cast<int>(minTop);
    return true;
}

// NAPI wrapper class
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