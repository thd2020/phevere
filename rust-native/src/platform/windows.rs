use windows::{
    core::*,
    Win32::{
        Foundation::*,
        System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED},
        UI::Accessibility::*,
    },
};
use std::{
    ptr::null_mut,
    sync::{Arc, Mutex},
    thread,
};
use crate::platform::{SelectionError, SelectionListener};

pub struct WindowsListener {
    automation: Option<IUIAutomation>,
    state: Arc<Mutex<Option<String>>>,
    stop_flag: Arc<Mutex<bool>>,
}

impl WindowsListener {
    pub fn new() -> Self {
        Self {
            automation: None,
            state: Arc::new(Mutex::new(None)),
            stop_flag: Arc::new(Mutex::new(false)),
        }
    }

    pub fn start_impl(&mut self) -> Result<(), String> {
        let state = self.state.clone();
        let stop_flag = self.stop_flag.clone();

        thread::spawn(move || {
            unsafe {
                CoInitializeEx(null_mut(), COINIT_MULTITHREADED).ok().unwrap();

                let automation: IUIAutomation = CoCreateInstance(
                    &CUIAutomation::IID,
                    None,
                    CLSCTX_INPROC_SERVER,
                ).unwrap();

                // 🚧 Step 2 will go here: Register event handler

                // Stay alive (for now)
                while !*stop_flag.lock().unwrap() {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }

                CoUninitialize();
            }
        });

        Ok(())
    }

    pub fn stop_impl(&self) {
        *self.stop_flag.lock().unwrap() = true;
    }

    pub fn get_selection(&self) -> Option<String> {
        self.state.lock().unwrap().clone()
    }
}

impl SelectionListener for WindowsListener {
    fn start(&mut self) -> Result<(), SelectionError> {
        self.start_impl()
            .map_err(|e| SelectionError::MonitoringError(e))
    }

    fn stop(&mut self) -> Result<(), SelectionError> {
        self.stop_impl();
        Ok(())
    }

    fn get_selection(&self) -> Option<String> {
        self.get_selection()
    }
}