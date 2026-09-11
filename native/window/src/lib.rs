use std::ffi::{CStr, CString};
use std::sync::atomic::{AtomicUsize, Ordering};

use napi::bindgen_prelude::FunctionRef;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use sdl3_sys::everything::*;

#[cfg(windows)]
use windows_sys::Win32::Foundation::FreeLibrary;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Dwm::{
    DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
};
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject};
#[cfg(windows)]
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, KillTimer, SetTimer, SetWindowLongPtrW,
    GWLP_USERDATA, GWLP_WNDPROC, WM_ENTERMENULOOP, WM_ENTERSIZEMOVE, WM_EXITMENULOOP,
    WM_EXITSIZEMOVE, WM_TIMER, WNDPROC,
};

static WINDOW_COUNT: AtomicUsize = AtomicUsize::new(0);
const DEFAULT_COMPOSITOR_WAIT_MS: u32 = 1_000;

#[napi(object)]
pub struct NativeWindowOptions {
    pub title: String,
    pub width: i32,
    pub height: i32,
    pub resizable: bool,
    pub borderless: bool,
    pub transparent: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub graphics: String,
}

#[napi(object)]
pub struct NativeSurfaceDescriptor {
    pub version: u32,
    pub api: String,
    pub window: Buffer,
    pub display: Option<Buffer>,
    pub instance: Option<Buffer>,
    pub egl_window: Option<Buffer>,
}

#[napi(object)]
pub struct NativeWindowEvent {
    pub kind: String,
    pub window_id: u32,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub dx: Option<f64>,
    pub dy: Option<f64>,
    pub button: Option<u32>,
    pub key: Option<String>,
    pub scancode: Option<u32>,
    pub repeat: Option<bool>,
    pub shift: Option<bool>,
    pub ctrl: Option<bool>,
    pub alt: Option<bool>,
    pub super_key: Option<bool>,
    pub flipped: Option<bool>,
}

fn sdl_error(context: &str) -> Error {
    let message = unsafe {
        let error = SDL_GetError();
        if error.is_null() {
            "unknown SDL error".to_owned()
        } else {
            CStr::from_ptr(error).to_string_lossy().into_owned()
        }
    };
    Error::from_reason(format!("{context}: {message}"))
}

fn pointer_buffer(pointer: usize) -> Buffer {
    Buffer::from(pointer.to_ne_bytes().to_vec())
}

#[cfg(windows)]
fn hwnd_from_native_data(native_data: &[u8]) -> Result<HWND> {
    if native_data.len() < std::mem::size_of::<usize>() {
        return Err(Error::from_reason("native window data is invalid"));
    }
    let mut bytes = [0_u8; std::mem::size_of::<usize>()];
    bytes.copy_from_slice(&native_data[..std::mem::size_of::<usize>()]);
    let hwnd = usize::from_ne_bytes(bytes) as HWND;
    if hwnd.is_null() {
        return Err(Error::from_reason("native window handle is null"));
    }
    Ok(hwnd)
}

fn current_video_driver() -> String {
    unsafe {
        let driver = SDL_GetCurrentVideoDriver();
        if driver.is_null() {
            "unknown".to_owned()
        } else {
            CStr::from_ptr(driver).to_string_lossy().into_owned()
        }
    }
}

fn set_bool_property(properties: SDL_PropertiesID, name: *const i8, value: bool) -> Result<()> {
    if unsafe { SDL_SetBooleanProperty(properties, name, value) } {
        Ok(())
    } else {
        Err(sdl_error("could not set SDL window property"))
    }
}

fn set_number_property(properties: SDL_PropertiesID, name: *const i8, value: i64) -> Result<()> {
    if unsafe { SDL_SetNumberProperty(properties, name, value) } {
        Ok(())
    } else {
        Err(sdl_error("could not set SDL window property"))
    }
}

#[napi]
pub struct NativeSdlWindow {
    window: usize,
    gl_context: usize,
    id: u32,
    transparent: bool,
}

#[napi]
impl NativeSdlWindow {
    #[napi(constructor)]
    pub fn new(options: NativeWindowOptions) -> Result<Self> {
        if options.width <= 0 || options.height <= 0 {
            return Err(Error::from_reason(
                "window width and height must be positive",
            ));
        }
        if options.graphics != "webgpu" && options.graphics != "webgl" {
            return Err(Error::from_reason("graphics must be webgpu or webgl"));
        }
        let use_webgl = options.graphics == "webgl";
        if use_webgl {
            // Keep SDL's context on the same GLES/EGL implementation as the
            // generated native-gles call table (ANGLE on Windows).
            unsafe {
                SDL_SetHint(SDL_HINT_OPENGL_ES_DRIVER, c"1".as_ptr());
                SDL_SetHint(SDL_HINT_VIDEO_FORCE_EGL, c"1".as_ptr());
            }
        }
        if WINDOW_COUNT.load(Ordering::SeqCst) == 0 && !unsafe { SDL_Init(SDL_INIT_VIDEO) } {
            return Err(sdl_error("could not initialize SDL3 video"));
        }
        if use_webgl {
            for (attribute, value) in [
                (SDL_GL_CONTEXT_MAJOR_VERSION, 3),
                (SDL_GL_CONTEXT_MINOR_VERSION, 0),
                (
                    SDL_GL_CONTEXT_PROFILE_MASK,
                    SDL_GL_CONTEXT_PROFILE_ES.0 as i32,
                ),
                (SDL_GL_ALPHA_SIZE, 8),
                (SDL_GL_DEPTH_SIZE, 24),
                (SDL_GL_STENCIL_SIZE, 8),
                (SDL_GL_DOUBLEBUFFER, 1),
                (SDL_GL_EGL_PLATFORM, 1),
            ] {
                if !unsafe { SDL_GL_SetAttribute(attribute, value) } {
                    return Err(sdl_error("could not configure the SDL3 OpenGL ES context"));
                }
            }
        }

        let properties = unsafe { SDL_CreateProperties() };
        if properties == 0 {
            return Err(sdl_error("could not allocate SDL3 window properties"));
        }
        let title = CString::new(options.title)
            .map_err(|_| Error::from_reason("window title contains a null byte"))?;

        let result = (|| {
            if !unsafe {
                SDL_SetStringProperty(
                    properties,
                    SDL_PROP_WINDOW_CREATE_TITLE_STRING,
                    title.as_ptr(),
                )
            } {
                return Err(sdl_error("could not set SDL window title"));
            }
            set_number_property(
                properties,
                SDL_PROP_WINDOW_CREATE_WIDTH_NUMBER,
                options.width.into(),
            )?;
            set_number_property(
                properties,
                SDL_PROP_WINDOW_CREATE_HEIGHT_NUMBER,
                options.height.into(),
            )?;
            set_bool_property(
                properties,
                SDL_PROP_WINDOW_CREATE_RESIZABLE_BOOLEAN,
                options.resizable,
            )?;
            set_bool_property(
                properties,
                SDL_PROP_WINDOW_CREATE_BORDERLESS_BOOLEAN,
                options.borderless,
            )?;
            set_bool_property(
                properties,
                SDL_PROP_WINDOW_CREATE_TRANSPARENT_BOOLEAN,
                options.transparent,
            )?;
            set_bool_property(
                properties,
                SDL_PROP_WINDOW_CREATE_HIGH_PIXEL_DENSITY_BOOLEAN,
                true,
            )?;
            if use_webgl {
                set_bool_property(properties, SDL_PROP_WINDOW_CREATE_OPENGL_BOOLEAN, true)?;
            } else {
                set_bool_property(
                    properties,
                    SDL_PROP_WINDOW_CREATE_EXTERNAL_GRAPHICS_CONTEXT_BOOLEAN,
                    true,
                )?;
            }
            if let (Some(x), Some(y)) = (options.x, options.y) {
                set_number_property(properties, SDL_PROP_WINDOW_CREATE_X_NUMBER, x.into())?;
                set_number_property(properties, SDL_PROP_WINDOW_CREATE_Y_NUMBER, y.into())?;
            }

            let window = unsafe { SDL_CreateWindowWithProperties(properties) };
            if window.is_null() {
                return Err(sdl_error("could not create SDL3 window"));
            }
            let id = unsafe { SDL_GetWindowID(window) };
            if id == 0 {
                unsafe { SDL_DestroyWindow(window) };
                return Err(sdl_error("SDL3 window has no id"));
            }
            let gl_context = if use_webgl {
                let context = unsafe { SDL_GL_CreateContext(window) };
                if context.is_null() {
                    unsafe { SDL_DestroyWindow(window) };
                    return Err(sdl_error("could not create the SDL3 OpenGL ES context"));
                }
                if !unsafe { SDL_GL_MakeCurrent(window, context) } {
                    unsafe {
                        SDL_GL_DestroyContext(context);
                        SDL_DestroyWindow(window);
                    }
                    return Err(sdl_error(
                        "could not make the SDL3 OpenGL ES context current",
                    ));
                }
                context as usize
            } else {
                0
            };
            let actual_transparent =
                unsafe { (SDL_GetWindowFlags(window).0 & SDL_WINDOW_TRANSPARENT.0) != 0 };
            Ok(Self {
                window: window as usize,
                gl_context,
                id: id.into(),
                transparent: actual_transparent,
            })
        })();
        unsafe { SDL_DestroyProperties(properties) };

        match result {
            Ok(window) => {
                WINDOW_COUNT.fetch_add(1, Ordering::SeqCst);
                Ok(window)
            }
            Err(error) => {
                if WINDOW_COUNT.load(Ordering::SeqCst) == 0 {
                    unsafe { SDL_QuitSubSystem(SDL_INIT_VIDEO) };
                }
                Err(error)
            }
        }
    }

    #[napi(getter)]
    pub fn id(&self) -> u32 {
        self.id
    }

    #[napi(getter)]
    pub fn destroyed(&self) -> bool {
        self.window == 0
    }

    #[napi(getter)]
    pub fn video_driver(&self) -> String {
        current_video_driver()
    }

    #[napi(getter)]
    pub fn transparent(&self) -> bool {
        self.transparent
    }

    #[napi(getter)]
    pub fn x(&self) -> Result<i32> {
        Ok(self.position()?.0)
    }

    #[napi(getter)]
    pub fn y(&self) -> Result<i32> {
        Ok(self.position()?.1)
    }

    #[napi(getter)]
    pub fn pixel_width(&self) -> Result<i32> {
        Ok(self.pixel_size()?.0)
    }

    #[napi(getter)]
    pub fn pixel_height(&self) -> Result<i32> {
        Ok(self.pixel_size()?.1)
    }

    #[napi(getter)]
    pub fn refresh_rate(&self) -> f64 {
        let window = self.window_pointer();
        if window.is_null() {
            return 60.0;
        }
        unsafe {
            let mode = SDL_GetCurrentDisplayMode(SDL_GetDisplayForWindow(window));
            if mode.is_null() || (*mode).refresh_rate <= 0.0 {
                60.0
            } else {
                (*mode).refresh_rate.into()
            }
        }
    }

    #[napi(getter)]
    pub fn surface(&self) -> Result<NativeSurfaceDescriptor> {
        let properties = unsafe { SDL_GetWindowProperties(self.require_window()?) };
        if properties == 0 {
            return Err(sdl_error("could not read SDL3 window properties"));
        }
        let driver = current_video_driver();
        let pointer = |name| unsafe {
            SDL_GetPointerProperty(properties, name, std::ptr::null_mut()) as usize
        };
        let number = |name| unsafe { SDL_GetNumberProperty(properties, name, 0) as usize };
        match driver.as_str() {
            "windows" => {
                let hwnd = pointer(SDL_PROP_WINDOW_WIN32_HWND_POINTER);
                let instance = pointer(SDL_PROP_WINDOW_WIN32_INSTANCE_POINTER);
                if hwnd == 0 || instance == 0 {
                    return Err(sdl_error("SDL3 did not expose Win32 window handles"));
                }
                Ok(NativeSurfaceDescriptor {
                    version: 1,
                    api: "win32".to_owned(),
                    window: pointer_buffer(hwnd),
                    display: None,
                    instance: Some(pointer_buffer(instance)),
                    egl_window: None,
                })
            }
            "x11" => {
                let display = pointer(SDL_PROP_WINDOW_X11_DISPLAY_POINTER);
                let xwindow = number(SDL_PROP_WINDOW_X11_WINDOW_NUMBER);
                if display == 0 || xwindow == 0 {
                    return Err(sdl_error("SDL3 did not expose X11 window handles"));
                }
                Ok(NativeSurfaceDescriptor {
                    version: 1,
                    api: "x11".to_owned(),
                    window: pointer_buffer(xwindow),
                    display: Some(pointer_buffer(display)),
                    instance: None,
                    egl_window: None,
                })
            }
            "wayland" => {
                let display = pointer(SDL_PROP_WINDOW_WAYLAND_DISPLAY_POINTER);
                let surface = pointer(SDL_PROP_WINDOW_WAYLAND_SURFACE_POINTER);
                let egl_window = pointer(SDL_PROP_WINDOW_WAYLAND_EGL_WINDOW_POINTER);
                if display == 0 || surface == 0 {
                    return Err(sdl_error("SDL3 did not expose Wayland window handles"));
                }
                Ok(NativeSurfaceDescriptor {
                    version: 1,
                    api: "wayland".to_owned(),
                    window: pointer_buffer(surface),
                    display: Some(pointer_buffer(display)),
                    instance: None,
                    egl_window: (egl_window != 0).then(|| pointer_buffer(egl_window)),
                })
            }
            _ => Err(Error::from_reason(format!(
                "unsupported SDL3 video driver: {driver}"
            ))),
        }
    }

    #[napi]
    pub fn set_position(&self, x: i32, y: i32) -> Result<bool> {
        if current_video_driver() == "wayland" {
            return Ok(false);
        }
        if unsafe { SDL_SetWindowPosition(self.require_window()?, x, y) } {
            Ok(true)
        } else {
            Err(sdl_error("could not move SDL3 window"))
        }
    }

    #[napi]
    pub fn minimize(&self) -> Result<()> {
        self.window_action(SDL_MinimizeWindow, "could not minimize SDL3 window")
    }

    #[napi]
    pub fn maximize(&self) -> Result<()> {
        self.window_action(SDL_MaximizeWindow, "could not maximize SDL3 window")
    }

    #[napi]
    pub fn restore(&self) -> Result<()> {
        self.window_action(SDL_RestoreWindow, "could not restore SDL3 window")
    }

    #[napi]
    pub fn make_gl_current(&self) -> Result<bool> {
        if self.gl_context == 0 {
            return Err(Error::from_reason("window has no SDL3 OpenGL context"));
        }
        Ok(unsafe { SDL_GL_MakeCurrent(self.require_window()?, self.gl_context as SDL_GLContext) })
    }

    #[napi]
    pub fn set_gl_swap_interval(&self, interval: i32) -> Result<bool> {
        self.make_gl_current()?;
        Ok(unsafe { SDL_GL_SetSwapInterval(interval) })
    }

    #[napi]
    pub fn swap_gl(&self) -> Result<bool> {
        self.make_gl_current()?;
        Ok(unsafe { SDL_GL_SwapWindow(self.require_window()?) })
    }

    #[napi]
    pub fn gl_version(&self) -> Result<String> {
        self.make_gl_current()?;
        type GetString = unsafe extern "C" fn(u32) -> *const u8;
        let name = c"glGetString";
        let procedure = unsafe { SDL_GL_GetProcAddress(name.as_ptr()) }
            .ok_or_else(|| Error::from_reason("SDL3 did not load glGetString"))?;
        let get_string =
            unsafe { std::mem::transmute::<unsafe extern "C" fn(), GetString>(procedure) };
        let version = unsafe { get_string(0x1F02) };
        if version.is_null() {
            return Err(Error::from_reason("SDL3 glGetString returned null"));
        }
        Ok(unsafe { CStr::from_ptr(version.cast()) }
            .to_string_lossy()
            .into_owned())
    }

    #[napi]
    pub fn destroy(&mut self) {
        self.destroy_inner();
    }

    fn window_pointer(&self) -> *mut SDL_Window {
        self.window as *mut SDL_Window
    }

    fn require_window(&self) -> Result<*mut SDL_Window> {
        let window = self.window_pointer();
        if window.is_null() {
            Err(Error::from_reason("native window is destroyed"))
        } else {
            Ok(window)
        }
    }

    fn position(&self) -> Result<(i32, i32)> {
        let (mut x, mut y) = (0, 0);
        if unsafe { SDL_GetWindowPosition(self.require_window()?, &mut x, &mut y) } {
            Ok((x, y))
        } else {
            Err(sdl_error("could not query SDL3 window position"))
        }
    }

    fn pixel_size(&self) -> Result<(i32, i32)> {
        let (mut width, mut height) = (0, 0);
        if unsafe { SDL_GetWindowSizeInPixels(self.require_window()?, &mut width, &mut height) } {
            Ok((width, height))
        } else {
            Err(sdl_error("could not query SDL3 window pixel size"))
        }
    }

    fn window_action(
        &self,
        action: unsafe extern "C" fn(*mut SDL_Window) -> bool,
        context: &str,
    ) -> Result<()> {
        if unsafe { action(self.require_window()?) } {
            Ok(())
        } else {
            Err(sdl_error(context))
        }
    }

    fn destroy_inner(&mut self) {
        if self.window == 0 {
            return;
        }
        if self.gl_context != 0 {
            unsafe { SDL_GL_DestroyContext(self.gl_context as SDL_GLContext) };
            self.gl_context = 0;
        }
        unsafe { SDL_DestroyWindow(self.window_pointer()) };
        self.window = 0;
        if WINDOW_COUNT.fetch_sub(1, Ordering::SeqCst) == 1 {
            unsafe { SDL_QuitSubSystem(SDL_INIT_VIDEO) };
        }
    }
}

impl Drop for NativeSdlWindow {
    fn drop(&mut self) {
        self.destroy_inner();
    }
}

fn empty_event(kind: &str, window_id: u32) -> NativeWindowEvent {
    NativeWindowEvent {
        kind: kind.to_owned(),
        window_id,
        x: None,
        y: None,
        dx: None,
        dy: None,
        button: None,
        key: None,
        scancode: None,
        repeat: None,
        shift: None,
        ctrl: None,
        alt: None,
        super_key: None,
        flipped: None,
    }
}

/// Drains SDL's process-wide queue. JavaScript routes each event by window id.
#[napi]
pub fn poll_events() -> Vec<NativeWindowEvent> {
    let mut events = Vec::new();
    let mut raw = SDL_Event::default();
    while unsafe { SDL_PollEvent(&mut raw) } {
        let event_type = unsafe { raw.r#type };
        if event_type == SDL_EVENT_QUIT.0 {
            events.push(empty_event("quit", 0));
        } else if event_type == SDL_EVENT_WINDOW_CLOSE_REQUESTED.0 {
            events.push(empty_event("close", unsafe { raw.window.windowID.into() }));
        } else if event_type == SDL_EVENT_WINDOW_RESIZED.0
            || event_type == SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED.0
        {
            events.push(empty_event("resize", unsafe { raw.window.windowID.into() }));
        } else if event_type == SDL_EVENT_WINDOW_MOVED.0 {
            let raw = unsafe { raw.window };
            let mut event = empty_event("move", raw.windowID.into());
            event.x = Some(raw.data1.into());
            event.y = Some(raw.data2.into());
            events.push(event);
        } else if event_type == SDL_EVENT_WINDOW_MINIMIZED.0 {
            events.push(empty_event("minimize", unsafe {
                raw.window.windowID.into()
            }));
        } else if event_type == SDL_EVENT_WINDOW_MAXIMIZED.0 {
            events.push(empty_event("maximize", unsafe {
                raw.window.windowID.into()
            }));
        } else if event_type == SDL_EVENT_WINDOW_RESTORED.0 {
            events.push(empty_event("restore", unsafe {
                raw.window.windowID.into()
            }));
        } else if event_type == SDL_EVENT_MOUSE_MOTION.0 {
            let raw = unsafe { raw.motion };
            let mut event = empty_event("mouseMove", raw.windowID.into());
            event.x = Some(raw.x.into());
            event.y = Some(raw.y.into());
            events.push(event);
        } else if event_type == SDL_EVENT_MOUSE_BUTTON_DOWN.0
            || event_type == SDL_EVENT_MOUSE_BUTTON_UP.0
        {
            let raw = unsafe { raw.button };
            let mut event = empty_event(
                if event_type == SDL_EVENT_MOUSE_BUTTON_DOWN.0 {
                    "mouseButtonDown"
                } else {
                    "mouseButtonUp"
                },
                raw.windowID.into(),
            );
            event.x = Some(raw.x.into());
            event.y = Some(raw.y.into());
            event.button = Some(raw.button.into());
            events.push(event);
        } else if event_type == SDL_EVENT_MOUSE_WHEEL.0 {
            let raw = unsafe { raw.wheel };
            let mut event = empty_event("mouseWheel", raw.windowID.into());
            event.x = Some(raw.mouse_x.into());
            event.y = Some(raw.mouse_y.into());
            event.dx = Some(raw.x.into());
            event.dy = Some(raw.y.into());
            event.flipped = Some(raw.direction == SDL_MOUSEWHEEL_FLIPPED);
            events.push(event);
        } else if event_type == SDL_EVENT_KEY_DOWN.0 || event_type == SDL_EVENT_KEY_UP.0 {
            let raw = unsafe { raw.key };
            let mut event = empty_event(
                if event_type == SDL_EVENT_KEY_DOWN.0 {
                    "keyDown"
                } else {
                    "keyUp"
                },
                raw.windowID.into(),
            );
            let key_name = unsafe { SDL_GetKeyName(raw.key) };
            event.key = (!key_name.is_null())
                .then(|| unsafe { CStr::from_ptr(key_name).to_string_lossy().into_owned() });
            event.scancode = Some(raw.scancode.0 as u32);
            event.repeat = Some(raw.repeat);
            event.shift = Some((raw.r#mod.0 & SDL_KMOD_SHIFT.0) != 0);
            event.ctrl = Some((raw.r#mod.0 & SDL_KMOD_CTRL.0) != 0);
            event.alt = Some((raw.r#mod.0 & SDL_KMOD_ALT.0) != 0);
            event.super_key = Some((raw.r#mod.0 & SDL_KMOD_GUI.0) != 0);
            events.push(event);
        }
    }
    events
}

pub struct CompositorFrameTask {
    timeout_ms: u32,
}

impl Task for CompositorFrameTask {
    type Output = bool;
    type JsValue = bool;

    fn compute(&mut self) -> Result<Self::Output> {
        #[cfg(windows)]
        {
            return Ok(wait_for_windows_compositor(self.timeout_ms));
        }
        #[cfg(not(windows))]
        Ok(false)
    }

    fn resolve(&mut self, _env: Env, signaled: Self::Output) -> Result<Self::JsValue> {
        Ok(signaled)
    }
}

#[napi]
pub fn wait_for_compositor_frame(timeout_ms: Option<u32>) -> AsyncTask<CompositorFrameTask> {
    AsyncTask::new(CompositorFrameTask {
        timeout_ms: timeout_ms.unwrap_or(DEFAULT_COMPOSITOR_WAIT_MS).max(1),
    })
}

#[cfg(windows)]
fn wait_for_windows_compositor(timeout_ms: u32) -> bool {
    type WaitForCompositorClock = unsafe extern "system" fn(u32, *const HANDLE, u32) -> u32;
    let library_name: Vec<u16> = "dcomp.dll\0".encode_utf16().collect();
    let module = unsafe { LoadLibraryW(library_name.as_ptr()) };
    if module.is_null() {
        return false;
    }
    let procedure =
        unsafe { GetProcAddress(module, b"DCompositionWaitForCompositorClock\0".as_ptr()) };
    let signaled = match procedure {
        Some(procedure) => {
            let wait = unsafe {
                std::mem::transmute::<unsafe extern "system" fn() -> isize, WaitForCompositorClock>(
                    procedure,
                )
            };
            unsafe { wait(0, std::ptr::null(), timeout_ms) == 0 }
        }
        None => false,
    };
    unsafe { FreeLibrary(module) };
    signaled
}

#[napi]
pub fn set_transparent(native_data: Buffer, transparent: bool) -> Result<()> {
    #[cfg(windows)]
    configure_dwm_transparency(hwnd_from_native_data(&native_data)?, transparent)?;
    #[cfg(not(windows))]
    let _ = (native_data, transparent);
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
        unsafe { DeleteObject(region as _) };
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
            unsafe { SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, self as *mut Self as isize) };
            self.previous_proc = unsafe {
                SetWindowLongPtrW(
                    self.hwnd,
                    GWLP_WNDPROC,
                    modal_window_proc as *const () as usize as isize,
                )
            };
            if self.previous_proc == 0 {
                unsafe { SetWindowLongPtrW(self.hwnd, GWLP_USERDATA, self.previous_userdata) };
                return Err(Error::from_reason(
                    "could not install Windows modal window hook",
                ));
            }
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
    let controller = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut ModalFrameController;
    if !controller.is_null() {
        let controller = unsafe { &mut *controller };
        match message {
            WM_ENTERSIZEMOVE | WM_ENTERMENULOOP => {
                controller.invoke_state(true);
                unsafe { SetTimer(hwnd, MODAL_TIMER_ID, 16, None) };
            }
            WM_TIMER if wparam == MODAL_TIMER_ID => {
                controller.invoke_frame();
                return 0;
            }
            WM_EXITSIZEMOVE | WM_EXITMENULOOP => {
                unsafe { KillTimer(hwnd, MODAL_TIMER_ID) };
                controller.invoke_state(false);
            }
            _ => {}
        }
        let previous = unsafe { std::mem::transmute::<isize, WNDPROC>(controller.previous_proc) };
        return match previous {
            Some(proc) => unsafe { CallWindowProcW(Some(proc), hwnd, message, wparam, lparam) },
            None => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
        };
    }
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}
