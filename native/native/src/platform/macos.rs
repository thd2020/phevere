use core_foundation::{
    base::TCFType,
    runloop::{CFRunLoop, CFRunLoopAddSource, CFRunLoopGetCurrent, CFRunLoopRun, CFRunLoopSource, CFRunLoopSourceCreate, CFRunLoopSourceContext, kCFRunLoopCommonModes},
    string::CFString,
};
use core_graphics::event::{CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType};
use objc::{class, msg_send, sel, sel_impl};
use std::{
    sync::{Arc, Mutex},
    thread,
};
use crate::platform::{SelectionListener, SelectionError};

/// Manages the selection listener on macOS.
pub struct MacOSListener {
    state: Arc<Mutex<Option<String>>>,
    runloop: CFRunLoop,
}

impl MacOSListener {
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

        let state = self.state.clone();
        let event_tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::Default,
            vec![CGEventType::KeyDown, CGEventType::FlagsChanged],
            move |_, _, _| {
                if let Some(text) = get_selected_text() {
                    *state.lock().unwrap() = Some(text);
                }
                None
            },
        ).map_err(|e| format!("Failed to create event tap: {:?}", e))?;
        
        let mut run_loop_source_context = CFRunLoopSourceContext {
            version: 0,
            info: std::ptr::null_mut(),
            retain: None,
            release: None,
            copy_description: None,
            equal: None,
            hash: None,
            schedule: None,
            cancel: None,
            perform: Some(event_tap.perform),
        };

        let run_loop_source_ref = unsafe { CFRunLoopSourceCreate(std::ptr::null_mut(), 0, &mut run_loop_source_context) };

        // Add event source and spawn monitoring thread
        unsafe {
            CFRunLoopAddSource(self.runloop.as_concrete_TypeRef(), run_loop_source_ref, kCFRunLoopCommonModes);
        }

        thread::spawn(|| unsafe { CFRunLoopRun() });

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

/// Retrieves the selected text from the focused UI element.
fn get_selected_text() -> Option<String> {
    unsafe {
        let element = AXUIElementCreateSystemWide();
        let text_attr = CFString::new("AXSelectedText");
        let mut value: *mut *const std::ffi::c_void = std::ptr::null_mut();

        if AXUIElementCopyAttributeValue(element, text_attr.as_concrete_TypeRef() as _, value) == 0 && !value.is_null() {
            Some(CFString::wrap_under_get_rule(value as *const _).to_string())
        } else {
            None
        }
    }
}

extern "C" {
    fn AXUIElementCreateSystemWide() -> *const std::ffi::c_void;
    fn AXUIElementCopyAttributeValue(
        element: *const std::ffi::c_void,
        attribute: *const std::ffi::c_void,
        value: *mut *const std::ffi::c_void,
    ) -> i32;
}

impl SelectionListener for MacOSListener {
    fn start(&mut self) -> Result<(), SelectionError> {
        self.start().map_err(|e| SelectionError::MonitoringError(e.to_string()))
    }

    fn stop(&mut self) -> Result<(), SelectionError> {
        self.stop();
        Ok(())
    }

    fn get_selection(&self) -> Option<String> {
        self.get_selection()
    }
}