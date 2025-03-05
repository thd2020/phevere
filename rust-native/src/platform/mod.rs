//! Platform-agnostic interface for text selection monitoring
//! Conditionally compiled implementations for each OS

// Platform-specific implementations[4,6](@ref)
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

/// Core trait for selection monitoring[1,3](@ref)
pub trait SelectionListener {
    /// Starts listening for selection changes
    fn start(&mut self) -> Result<(), SelectionError>;
    
    /// Stops active listening
    fn stop(&mut self) -> Result<(), SelectionError>;
    
    /// Retrieves currently selected text
    fn get_selection(&self) -> Option<String>;
}

/// Factory function using conditional compilation[3,6](@ref)
pub fn create_listener() -> Box<dyn SelectionListener> {
    #[cfg(target_os = "windows")]
    return Box::new(windows::WindowsListener::new());
    
    #[cfg(target_os = "macos")]
    return Box::new(macos::MacOSListener::new());
    
    #[cfg(target_os = "linux")]
    return Box::new(linux::LinuxListener::new());
}

#[derive(Debug, thiserror::Error)]
pub enum SelectionError {
    #[error("Platform initialization failed: {0}")]
    InitializationFailure(String),
    
    #[error("Selection monitoring error: {0}")]
    MonitoringError(String),
    
    #[error("Unsupported operation")]
    UnsupportedAction,
}