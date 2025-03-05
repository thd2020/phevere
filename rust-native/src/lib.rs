//! Cross-platform text selection monitoring library
//! Main entry point for application integration

pub mod platform;

/// Re-export core functionality[1,3](@ref)
pub use platform::{create_listener, SelectionError, SelectionListener};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_creation() {
        let mut listener: Box<dyn SelectionListener> = create_listener();
        assert!(listener.start().is_ok());
        assert!(listener.stop().is_ok());
    }
}