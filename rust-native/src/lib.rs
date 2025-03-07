//! Cross-platform text selection monitoring library
//! Main entry point for application integration

pub mod platform;
use neon::prelude::*;
use platform::{create_listener, SelectionError, SelectionListener};

/// **Neon wrapper for `create_listener`**  
fn neon_create_listener(mut cx: FunctionContext) -> JsResult<JsBox<Box<dyn SelectionListener>>> {
    let listener = create_listener();
    Ok(cx.boxed(listener))
}

/// **Neon wrapper for `start()`**
fn neon_start(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let listener = cx.argument::<JsBox<Box<dyn SelectionListener>>>(0)?;
    let result = listener.start().is_ok();
    Ok(cx.boolean(result))
}

/// **Neon wrapper for `stop()`**
fn neon_stop(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let listener = cx.argument::<JsBox<Box<dyn SelectionListener>>>(0)?;
    let result = listener.stop().is_ok();
    Ok(cx.boolean(result))
}

/// **Neon module entry point**  
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("createListener", neon_create_listener)?;
    cx.export_function("start", neon_start)?;
    cx.export_function("stop", neon_stop)?;
    Ok(())
}

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