#![deny(clippy::all)]

use std::io::{self, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct DecoderOptions {
    pub width: i64,
    pub height: i64,
    pub fps: Option<f64>,
    pub ffmpeg_path: Option<String>,
    pub vaapi_device: Option<String>,
}

#[napi(object)]
pub struct VideoFrame {
    pub width: i64,
    pub height: i64,
    pub timestamp_us: i64,
    pub data: Buffer,
}

#[derive(Clone)]
struct DecoderState {
    closed: Arc<std::sync::atomic::AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    latest: Arc<Mutex<Option<PendingFrame>>>,
    error: Arc<Mutex<Option<String>>>,
    frame_count: Arc<std::sync::atomic::AtomicU64>,
    backend: Arc<Mutex<String>>,
}

struct PendingFrame {
    timestamp_us: i64,
    data: Vec<u8>,
}

#[napi]
pub struct NativeVideoDecoder {
    options: DecoderOptions,
    state: DecoderState,
}

#[napi]
impl NativeVideoDecoder {
    #[napi(constructor)]
    pub fn new(options: DecoderOptions) -> Result<Self> {
        if options.width <= 0 || options.height <= 0 {
            return Err(Error::from_reason("Video dimensions must be positive"));
        }
        if options.fps.unwrap_or(30.0) <= 0.0 {
            return Err(Error::from_reason("Video FPS must be positive"));
        }

        Ok(Self {
            options,
            state: DecoderState {
                closed: Arc::new(std::sync::atomic::AtomicBool::new(true)),
                child: Arc::new(Mutex::new(None)),
                latest: Arc::new(Mutex::new(None)),
                error: Arc::new(Mutex::new(None)),
                frame_count: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                backend: Arc::new(Mutex::new("VA-API".to_string())),
            },
        })
    }

    #[napi]
    pub fn open(&mut self, source: String) -> Result<()> {
        if !self.state.closed.swap(false, std::sync::atomic::Ordering::SeqCst) {
            return Err(Error::from_reason("Video decoder is already open"));
        }

        let width = usize::try_from(self.options.width).map_err(|_| Error::from_reason("Invalid video width"))?;
        let height = usize::try_from(self.options.height).map_err(|_| Error::from_reason("Invalid video height"))?;
        let fps = self.options.fps.unwrap_or(30.0);
        let ffmpeg_path = self.options.ffmpeg_path.clone().unwrap_or_else(|| "ffmpeg".to_string());
        let device = self.options.vaapi_device.clone()
            .or_else(|| std::env::var("FFMPEG_VAAPI_DEVICE").ok())
            .unwrap_or_else(|| "/dev/dri/renderD128".to_string());
        let state = self.state.clone();
        state.frame_count.store(0, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut error) = state.error.lock() { *error = None; }
        if let Ok(mut backend) = state.backend.lock() { *backend = "VA-API".to_string(); }
        thread::spawn(move || {
            let result = run_ffmpeg(
                &ffmpeg_path,
                &source,
                &device,
                width,
                height,
                fps,
                &state,
                true,
            );
            if let Err(error) = result {
                let has_frames = state.frame_count.load(std::sync::atomic::Ordering::SeqCst) > 0;
                if !has_frames && !state.closed.load(std::sync::atomic::Ordering::SeqCst) {
                    eprintln!("FFmpeg VA-API decoder failed; retrying with CPU decoder: {error}");
                    if let Ok(mut backend) = state.backend.lock() { *backend = "CPU fallback".to_string(); }
                    if let Err(fallback_error) = run_ffmpeg(
                        &ffmpeg_path,
                        &source,
                        &device,
                        width,
                        height,
                        fps,
                        &state,
                        false,
                    ) {
                        eprintln!("FFmpeg CPU decoder failed: {fallback_error}");
                        if let Ok(mut slot) = state.error.lock() { *slot = Some(fallback_error.to_string()); }
                    }
                } else if !state.closed.load(std::sync::atomic::Ordering::SeqCst) {
                    eprintln!("FFmpeg VA-API decoder failed: {error}");
                    if let Ok(mut slot) = state.error.lock() { *slot = Some(error.to_string()); }
                }
            }
            state.closed.store(true, std::sync::atomic::Ordering::SeqCst);
        });

        Ok(())
    }

    #[napi]
    pub fn poll_latest(&self) -> Option<VideoFrame> {
        let pending = self.state.latest.lock().ok()?.take()?;
        Some(VideoFrame {
            width: self.options.width,
            height: self.options.height,
            timestamp_us: pending.timestamp_us,
            data: Buffer::from(pending.data),
        })
    }

    #[napi]
    pub fn poll_error(&self) -> Option<String> {
        self.state.error.lock().ok()?.take()
    }

    #[napi]
    pub fn backend(&self) -> String {
        self.state.backend.lock().map(|backend| backend.clone()).unwrap_or_else(|_| "unknown".to_string())
    }

    #[napi]
    pub fn close(&mut self) {
        self.state.closed.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut child) = self.state.child.lock() {
            if let Some(mut process) = child.take() {
                let _ = process.kill();
            }
        }
    }
}

fn run_ffmpeg(
    ffmpeg_path: &str,
    source: &str,
    device: &str,
    width: usize,
    height: usize,
    fps: f64,
    state: &DecoderState,
    use_vaapi: bool,
) -> io::Result<()> {
    let filter = if use_vaapi {
        format!("hwdownload,format=nv12,scale={width}:{height}:flags=fast_bilinear,format=rgba")
    } else {
        format!("scale={width}:{height}:flags=fast_bilinear,format=rgba")
    };
    let fps_arg = fps.to_string();
    let mut command = Command::new(ffmpeg_path);
    command.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    if use_vaapi {
        command.args(["-hwaccel", "vaapi", "-hwaccel_device", device, "-hwaccel_output_format", "vaapi"]);
    }
    let mut child = command
        .args(["-re", "-i", source, "-an", "-vf", &filter, "-r", &fps_arg, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        // Keep FFmpeg diagnostics visible. A piped stderr that is never drained
        // can also stop the child once its pipe fills.
        .stderr(Stdio::inherit())
        .spawn()?;
    let mut stdout = child.stdout.take().ok_or_else(|| io::Error::other("FFmpeg stdout unavailable"))?;
    *state.child.lock().map_err(|_| io::Error::other("FFmpeg process lock poisoned"))? = Some(child);

    let frame_bytes = width.checked_mul(height).and_then(|size| size.checked_mul(4))
        .ok_or_else(|| io::Error::other("Video frame size overflow"))?;
    let mut frame_index = 0_i64;

    loop {
        if state.closed.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }
        let mut data = vec![0_u8; frame_bytes];
        match stdout.read_exact(&mut data) {
            Ok(()) => {
                let timestamp_us = (frame_index as f64 * 1_000_000.0 / fps).round() as i64;
                frame_index += 1;
                state.frame_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if let Ok(mut latest) = state.latest.lock() {
                    *latest = Some(PendingFrame { timestamp_us, data });
                }
            }
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error),
        }
    }

    if let Ok(mut child_slot) = state.child.lock() {
        if let Some(mut process) = child_slot.take() {
            let status = process.wait()?;
            if !state.closed.load(std::sync::atomic::Ordering::SeqCst) && !status.success() {
                return Err(io::Error::other(format!("FFmpeg exited with status {status}")));
            }
        }
    }
    Ok(())
}
