use x11rb::protocol::xproto::*;

pub struct LinuxSelectionListener {
    conn: x11rb::rust_connection::RustConnection,
    window: u32,
}

impl TextSelectionListener for LinuxSelectionListener {
    fn start_listening(&mut self) -> Result<(), String> {
        // 监听SelectionNotify事件[12](@ref)
        self.conn.send_request(&ChangeWindowAttributes {
            window: self.window,
            value_list: vec![EventMask::PROPERTY_CHANGE.into()]
        })
    }
}