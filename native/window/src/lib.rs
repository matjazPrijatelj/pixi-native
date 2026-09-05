use napi::bindgen_prelude::FunctionRef;
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Dwm::{
    DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, KillTimer,
    SetTimer, SetWindowLongPtrW, GWLP_USERDATA, GWLP_WNDPROC,
    WM_ENTERMENULOOP, WM_ENTERSIZEMOVE, WM_EXITMENULOOP, WM_EXITSIZEMOVE, WM_TIMER, WNDPROC,
};

#[cfg(windows)]
fn hwnd_from_native_data(native_data: &[u8]) -> Result<HWND> {
    if native_data.len() < std::mem::size_of::<usize>() {
        return Err(Error::from_reason("native window data is invalid"));
    }
    let hwnd = unsafe { *(native_data.as_ptr() as *const usize) as HWND };
    if hwnd.is_null() {
        return Err(Error::from_reason("native window handle is null"));
    }
    Ok(hwnd)
}

#[napi]
pub fn set_transparent(native_data: Buffer, transparent: bool) -> Result<()> {
    #[cfg(windows)]
    {
        let hwnd = hwnd_from_native_data(&native_data)?;
        configure_dwm_transparency(hwnd, transparent)?;
    }

    #[cfg(not(windows))]
    {
        let _ = (native_data, transparent);
        return Err(Error::from_reason(
            "transparent native windows are supported only on Windows 11",
        ));
    }

    Ok(())
}

#[cfg(windows)]
fn configure_dwm_transparency(hwnd: HWND, transparent: bool) -> Result<()> {
    let region = if transparent {
        unsafe { CreateRectRgn(0, 0, -1, -1) }
    } else {
        std::ptr::null_mut()
    };
    if transparent && region.is_null() {
        return Err(Error::from_reason(
            "could not create DWM transparency region",
        ));
    }

    let blur = DWM_BLURBEHIND {
        dwFlags: if transparent {
            DWM_BB_ENABLE | DWM_BB_BLURREGION
        } else {
            DWM_BB_ENABLE
        },
        fEnable: i32::from(transparent),
        hRgnBlur: region,
        fTransitionOnMaximized: 0,
    };
    let result = unsafe { DwmEnableBlurBehindWindow(hwnd, &blur) };
    if !region.is_null() {
        unsafe {
            DeleteObject(region as _);
        }
    }
    if result < 0 {
        return Err(Error::from_reason(format!(
            "DwmEnableBlurBehindWindow failed with HRESULT 0x{:08x}",
            result as u32,
        )));
    }
    Ok(())
}

#[napi]
pub struct ModalFrameController {
    env: Env,
    frame_callback: FunctionRef<(), ()>,
    state_callback: FunctionRef<(bool,), ()>,
    #[cfg(windows)]
    hwnd: HWND,
    #[cfg(windows)]
    previous_proc: isize,
    #[cfg(windows)]
    previous_userdata: isize,
    #[cfg(windows)]
    attached: bool,
    #[cfg(windows)]
    invoking: bool,
}

#[napi]
impl ModalFrameController {
    #[napi(constructor)]
    pub fn new(
        env: Env,
        native_data: Buffer,
        frame_callback: FunctionRef<(), ()>,
        state_callback: FunctionRef<(bool,), ()>,
    ) -> Result<Self> {
        #[cfg(windows)]
        let hwnd = hwnd_from_native_data(&native_data)?;

        #[cfg(not(windows))]
        let _ = native_data;

        Ok(Self {
            env,
            frame_callback,
            state_callback,
            #[cfg(windows)]
            hwnd,
            #[cfg(windows)]
            previous_proc: 0,
            #[cfg(windows)]
            previous_userdata: 0,
            #[cfg(windows)]
            attached: false,
            #[cfg(windows)]
            invoking: false,
        })
    }

    #[napi]
    pub fn attach(&mut self) -> Result<()> {
        #[cfg(windows)]
        {
            if self.hwnd.is_null() || self.attached {
                return Ok(());
            }
            self.previous_userdata = unsafe { GetWindowLongPtrW(self.hwnd, GWLP_USERDATA) };
            let self_pointer = self as *mut Self as isize;
            let previous_proc =
                unsafe { SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, self_pointer) };
            self.previous_proc = unsafe {
                SetWindowLongPtrW(self.hwnd, GWLP_WNDPROC, modal_window_proc as usize as isize)
            };
            if self.previous_proc == 0 {
                unsafe {
                    SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, self.previous_userdata);
                }
                return Err(Error::from_reason(
                    "could not install Windows modal window hook",
                ));
            }
            let _ = previous_proc;
            self.attached = true;
        }
        Ok(())
    }

    #[napi]
    pub fn detach(&mut self) {
        #[cfg(windows)]
        if self.attached {
            unsafe {
                KillTimer(self.hwnd, MODAL_TIMER_ID);
                SetWindowLongPtrW(self.hwnd, GWLP_WNDPROC, self.previous_proc);
                SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, self.previous_userdata);
            }
            self.attached = false;
        }
    }

    #[cfg(windows)]
    fn invoke_frame(&mut self) {
        if self.invoking {
            return;
        }
        self.invoking = true;
        if let Ok(callback) = self.frame_callback.borrow_back(&self.env) {
            let _ = callback.call(());
        }
        self.invoking = false;
    }

    #[cfg(windows)]
    fn invoke_state(&self, active: bool) {
        if let Ok(callback) = self.state_callback.borrow_back(&self.env) {
            let _ = callback.call((active,));
        }
    }
}

impl Drop for ModalFrameController {
    fn drop(&mut self) {
        self.detach();
    }
}

#[cfg(windows)]
const MODAL_TIMER_ID: usize = 0x5049_5849;

#[cfg(windows)]
unsafe extern "system" fn modal_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let controller = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ModalFrameController;
    if !controller.is_null() {
        let controller = &mut *controller;
        match message {
            WM_ENTERSIZEMOVE | WM_ENTERMENULOOP => {
                controller.invoke_state(true);
                SetTimer(hwnd, MODAL_TIMER_ID, 16, None);
            }
            WM_TIMER if wparam == MODAL_TIMER_ID => {
                controller.invoke_frame();
                return 0;
            }
            WM_EXITSIZEMOVE | WM_EXITMENULOOP => {
                KillTimer(hwnd, MODAL_TIMER_ID);
                controller.invoke_state(false);
            }
            _ => {}
        }
        let previous = std::mem::transmute::<isize, WNDPROC>(controller.previous_proc);
        return match previous {
            Some(proc) => CallWindowProcW(Some(proc), hwnd, message, wparam, lparam),
            None => DefWindowProcW(hwnd, message, wparam, lparam),
        };
    }
    DefWindowProcW(hwnd, message, wparam, lparam)
}
