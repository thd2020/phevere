use std::{
    ffi::c_void,
    sync::{Arc, Mutex},
    thread,
};
use objc::{class, msg_send, sel, sel_impl};
use core_foundation::{
    base::{CFTypeRef, TCFType},
    runloop::{kCFRunLoopCommonModes, CFRunLoop, CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRun, CFRunLoopSource,},
    string::{CFString, CFStringRef},
};
use core_graphics::event::{CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType};
use accessibility_sys::AXUIElementRef;
use crate::platform::{SelectionListener, SelectionError};

/// Manages the selection listener on macOS.
pub struct MacOSListener {
    state: Arc<Mutex<Option<String>>>,
    runloop: CFRunLoop,
} impl MacOSListener {
    /// Creates a new selection listener.
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(None)),
            runloop: unsafe { CFRunLoop::wrap_under_get_rule(CFRunLoopGetCurrent()) },
        }
    }

    /// Checks if accessibility permissions are granted.
    fn check_accessibility_permissions() -> Result<(), String> {
        let trusted: bool = unsafe { msg_send![class!(AXTrustedCheckPrompt), AXIsProcessTrusted] };
        if trusted {
            Ok(())
        } else {
            Err("Accessibility permissions required".into())
        }
    }

    /// Starts listening for selection events.
    pub fn start(&self) -> Result<(), String> {
        Self::check_accessibility_permissions()?;

        let state: Arc<Mutex<Option<String>>> = self.state.clone();

        let event_tap: CGEventTap<'_> = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            vec![CGEventType::LeftMouseUp],
            move |_, _, _| {
                if let Some(text) = get_selected_text() {
                    *state.lock().unwrap() = Some(text);
                }
                None
            },
        ).map_err(|e| format!("Failed to create event tap: {:?}", e))?;

        let runloop_source: CFRunLoopSource = event_tap
            .mach_port
            .create_runloop_source(0)
            .expect("Failed to create run loop source");

        unsafe {
            CFRunLoopAddSource(
                self.runloop.as_concrete_TypeRef(),
                runloop_source.as_concrete_TypeRef(),
                kCFRunLoopCommonModes,
            );
            CGEventTap::enable(&event_tap);
        }

        thread::spawn(|| unsafe {
            CFRunLoopRun();
        });

        Ok(())
        
    }

    /// Stops the listener.
    pub fn stop(&self) {
        CFRunLoop::get_current().stop();
    }

    /// Retrieves the last selected text.
    pub fn get_selection(&self) -> Option<String> {
        self.state.lock().unwrap().clone()
    }
}

fn get_selected_text() -> Option<String> {
    unsafe {
        let system_element: *const c_void = AXUIElementCreateSystemWide();
        let focused_element_attr: CFString = CFString::new("AXFocusedUIElement");
        let mut focused_element: CFTypeRef = std::ptr::null_mut();

        // Get the currently focused UI element
        if AXUIElementCopyAttributeValue(
            system_element,
            focused_element_attr.as_concrete_TypeRef() as *const c_void,
            &mut focused_element,
        ) != 0 || focused_element.is_null() {
            return None;
        }

        let selected_text_attr: CFString = CFString::new("AXSelectedText");
        let mut selected_text: CFTypeRef = std::ptr::null_mut();

        // Get the selected text from the focused element
        if AXUIElementCopyAttributeValue(
            focused_element as AXUIElementRef as *const c_void,
            selected_text_attr.as_concrete_TypeRef() as *const c_void,
            &mut selected_text,
        ) != 0 || selected_text.is_null() {
            return None;
        }

        // Convert CFStringRef to Rust String
        let cf_string: CFString = CFString::wrap_under_get_rule(selected_text as CFStringRef);
        Some(cf_string.to_string())
    }
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    unsafe fn AXUIElementCreateSystemWide() -> *const std::ffi::c_void;
    unsafe fn AXUIElementCopyAttributeValue(
        element: *const std::ffi::c_void,
        attribute: *const std::ffi::c_void,
        value: *mut *const std::ffi::c_void,
    ) -> i32;
}

impl SelectionListener for MacOSListener {
    fn start(&mut self) -> Result<(), SelectionError> {
        self.start().map_err(|e: SelectionError| SelectionError::MonitoringError(e.to_string()))
    }

    fn stop(&mut self) -> Result<(), SelectionError> {
        self.stop();
        Ok(())
    }

    fn get_selection(&self) -> Option<String> {
        self.get_selection()
    }
}