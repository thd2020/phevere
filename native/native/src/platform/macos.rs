// platform/macos.rs
use core_foundation::{
    base::{CFType, TCFType},
    runloop::{CFRunLoop, CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRun, kCFRunLoopCommonModes},
    string::{CFString, CFStringRef},
};
use core_graphics::event::{CGEventTapLocation, CGEventTapPlacement, CGEventType, CGEventTap};
use objc::{class, msg_send, rc::StrongPtr, sel, sel_impl};
use std::{
    ptr,
    sync::{Arc, Mutex},
};

pub struct MacOSListener {
    // Shared state for thread-safe access
    state: Arc<Mutex<ListenerState>>,
    // Track runloop for cleanup
    runloop: *mut core_foundation::runloop::__CFRunLoop,
}

struct ListenerState {
    selected_text: Option<String>,
    event_tap: Option<CGEventTap<'a>>,
}

unsafe extern "C" {
    unsafe fn AXUIElementCreateSystemWide() -> *const std::ffi::c_void;
    unsafe fn AXUIElementCopyAttributeValue(
        element: *const std::ffi::c_void,
        attribute: *const std::ffi::c_void,
        value: *mut *const std::ffi::c_void,
    ) -> i32;
}

impl MacOSListener {
    pub fn new() -> Self {
        MacOSListener {
            state: Arc::new(Mutex::new(ListenerState {
                selected_text: None,
                event_tap: None,
            })),
            runloop: unsafe { CFRunLoopGetCurrent() },
        }
    }

    fn check_accessibility_permissions(&self) -> Result<(), super::SelectionError> {
        let trusted: bool = unsafe {
            let result: bool = msg_send![class!(AXTrustedCheckPrompt), AXIsProcessTrusted];
            result
        };

        if trusted {
            Ok(())
        } else {
            Err(super::SelectionError::InitializationFailure(
                "Accessibility permissions required".into(),
            ))
        }
    }
}

impl super::SelectionListener for MacOSListener {
    fn start(&mut self) -> Result<(), super::SelectionError> {
        self.check_accessibility_permissions()?;

        let state: Arc<Mutex<ListenerState>> = self.state.clone();
        let event_tap = CGEventTap::new(
            CGEventTapLocation::HID,               // Location
            CGEventTapPlacement::Head,             // Placement (Head or Tail)
            core_graphics::event::CGEventTapOptions::Default,                                  // Enable tapping
            vec![CGEventType::KeyDown, CGEventType::FlagsChanged], // Events to listen for
            move |_proxy: *const std::ffi::c_void, _event_type: CGEventType, _event: &core_graphics::event::CGEvent| {
                let mut state = state.lock().unwrap();
                
                // Get focused element
                let focused_element: Result<StrongPtr, _> = unsafe {
                    let mut focused_ui_element: *mut std::ffi::c_void = ptr::null_mut();
                    let attribute = CFString::new("AXFocusedUIElement");
        
                    let result: i32 = AXUIElementCopyAttributeValue(
                        AXUIElementCreateSystemWide(),
                        attribute.as_concrete_TypeRef() as _,
                        focused_ui_element as *mut *const std::ffi::c_void,
                    );
        
                    if result == 0 && !focused_ui_element.is_null() {
                        Ok(StrongPtr::new(focused_ui_element as *mut objc::runtime::Object))
                    } else {
                        Err(super::SelectionError::MonitoringError(
                            "Failed to get focused element".into(),
                        ))
                    }
                };
        
                if let Ok(element) = focused_element {
                    // Get selected text
                    let selected_text: Result<String, _> = unsafe {
                        let attribute = CFString::new("AXSelectedText");
                        let mut value: *mut std::ffi::c_void = ptr::null_mut();
        
                        let result: i32 = AXUIElementCopyAttributeValue(
                            element.as_raw() as _,
                            attribute.as_concrete_TypeRef() as _,
                            value as *mut *const std::ffi::c_void,
                        );
        
                        if result == 0 && !value.is_null() {
                            let cf_str = CFString::wrap_under_get_rule(value as CFStringRef);
                            Ok(cf_str.to_string())
                        } else {
                            Err("No text selected".into())
                        }
                    };
        
                    if let Ok(text) = selected_text {
                        state.selected_text = Some(text);
                    }
                }
        
                None // Don't modify the original event
            },
        )
        .map_err(|_| super::SelectionError::MonitoringError("Event tap creation failed".into()))?;        

        // Store event tap and start runloop
        {
            let mut state = self.state.lock().unwrap();
            state.event_tap = Some(event_tap);
        }

        unsafe {
            CFRunLoopAddSource(
                self.runloop,
                event_tap.mach_port,
                kCFRunLoopCommonModes,
            );
        }

        // Start monitoring in background thread
        std::thread::spawn(|| {
            unsafe { CFRunLoopRun() };
        });

        Ok(())
    }

    fn stop(&mut self) -> Result<(), super::SelectionError> {
        let mut state = self.state.lock().unwrap();
        if let Some(tap) = state.event_tap.take() {
            tap.disable();
        }
        CFRunLoop::get_current().stop();
        Ok(())
    }

    fn get_selection(&self) -> Option<String> {
        self.state.lock().unwrap().selected_text.clone()
    }
}