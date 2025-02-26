use windows::Win32::UI::TextServices::*;
use windows::core::Interface;

pub struct WindowsListener {
    context: ITfContext,
    // 使用COM接口管理文本选择事件[6](@ref)
}

impl SelectionListener for WindowsListener {
    fn start_listening(&mut self) -> Result<(), String> {
        unsafe {
            let source: ITfSource = self.context.cast().map_err(|e| e.to_string())?;
            source.AdviseSink(&ITfSelectionSink::IID, self as *mut _ as *mut _, 0).map_err(|e| e.to_string())?;
            Ok(())
        }
    }
    
    fn get_selected_text(&self) -> Option<String> {
        unsafe {
            let mut selection: [ITfRange; 1] = [std::ptr::null_mut(); 1];
            let mut fetched: u32 = 0;
            self.context.GetSelection(TF_DEFAULT_SELECTION, 1, &mut selection, &mut fetched).ok()?;
            if fetched == 1 {
                let mut text: [u16; 256] = [0; 256];
                let mut fetched_text: u32 = 0;
                selection[0].GetText(TF_TF_MOVESTART, &mut text, 256, &mut fetched_text).ok()?;
                Some(String::from_utf16_lossy(&text[..fetched_text as usize]))
            } else {
                None
            }
        }
    }
}