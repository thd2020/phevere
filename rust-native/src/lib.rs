//! Cross-platform text selection monitoring library
//! Main entry point for application integration

pub mod platform;
use neon::prelude::*;
use std::cell::RefCell;
use platform::{create_listener, SelectionListener};

// Wrap the listener with "Finalize"
struct ListenerWrapper(RefCell<Box<dyn SelectionListener>>);
impl Finalize for ListenerWrapper {}

/// **Neon wrapper for `create_listener`**  
fn neon_create_listener(mut cx: FunctionContext) -> JsResult<JsBox<ListenerWrapper>> {
    let listener: Box<dyn SelectionListener> = create_listener();
    Ok(cx.boxed(ListenerWrapper(listener.into())))
}

/// **Neon wrapper for `start()`**
fn neon_start(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let wrapper: Handle<'_, JsBox<ListenerWrapper>> = cx.argument::<JsBox<ListenerWrapper>>(0)?;
    let result: bool = wrapper.0.borrow_mut().start().is_ok();
    Ok(cx.boolean(result))
}

/// **Neon wrapper for `stop()`**
fn neon_stop(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    let wrapper: Handle<'_, JsBox<ListenerWrapper>> = cx.argument::<JsBox<ListenerWrapper>>(0)?;
    let result: bool = wrapper.0.borrow_mut().stop().is_ok();
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