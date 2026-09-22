#![deny(clippy::all)]

use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Read};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[cfg(all(feature = "native-ffmpeg", target_os = "windows"))]
mod d3d11_shared;
#[cfg(feature = "native-ffmpeg")]
mod native_ffmpeg;

const FILE_FRAME_QUEUE_CAPACITY: usize = 4;
const LIVE_FRAME_QUEUE_CAPACITY: usize = 2;
const HARDWARE_DECODE_ATTEMPTS: usize = 5;
const HARDWARE_RETRY_DELAY: Duration = Duration::from_millis(500);

static ACTIVE_DECODER_WORKERS: AtomicU64 = AtomicU64::new(0);
static PENDING_DECODER_SHUTDOWNS: AtomicU64 = AtomicU64::new(0);
static COMPLETED_DECODER_SHUTDOWNS: AtomicU64 = AtomicU64::new(0);
static MAX_DECODER_SHUTDOWN_MS: AtomicU64 = AtomicU64::new(0);
static NEXT_VIDEO_SESSION_ID: AtomicI64 = AtomicI64::new(1);

#[napi(object)]
pub struct DecoderOptions {
    pub width: i64,
    pub height: i64,
    pub fps: Option<f64>,
    pub start_time: Option<f64>,
    pub ffmpeg_path: Option<String>,
    pub vaapi_device: Option<String>,
    pub playback_rate: Option<f64>,
    pub end_time: Option<f64>,
    pub source_paced: Option<bool>,
    pub input_args: Option<Vec<String>>,
    pub output_args: Option<Vec<String>>,
    pub loop_: Option<bool>,
    pub delivery_path: Option<String>,
}

#[napi(object)]
pub struct VideoFrame {
    pub width: i64,
    pub height: i64,
    pub timestamp_us: i64,
    pub data: Buffer,
}

#[napi(object)]
pub struct VideoFrameInfo {
    pub width: i64,
    pub height: i64,
    pub timestamp_us: i64,
}

#[napi(object)]
pub struct SharedVideoFrame {
    pub width: i64,
    pub height: i64,
    pub timestamp_us: i64,
    pub session_id: i64,
    pub surface_id: i64,
    pub shared_handle: Buffer,
}

#[napi(object)]
pub struct VideoShutdownDiagnostics {
    pub active_decoder_workers: i64,
    pub pending_decoder_shutdowns: i64,
    pub completed_decoder_shutdowns: i64,
    pub max_decoder_shutdown_ms: i64,
}

#[napi]
pub fn video_shutdown_diagnostics() -> VideoShutdownDiagnostics {
    VideoShutdownDiagnostics {
        active_decoder_workers: atomic_i64(&ACTIVE_DECODER_WORKERS),
        pending_decoder_shutdowns: atomic_i64(&PENDING_DECODER_SHUTDOWNS),
        completed_decoder_shutdowns: atomic_i64(&COMPLETED_DECODER_SHUTDOWNS),
        max_decoder_shutdown_ms: atomic_i64(&MAX_DECODER_SHUTDOWN_MS),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DecoderBackend {
    #[cfg(any(target_os = "windows", test))]
    D3d11va,
    #[cfg(any(target_os = "linux", test))]
    Vaapi,
    Cpu,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DecoderImplementation {
    Cli,
    #[cfg(feature = "native-ffmpeg")]
    Native,
}

impl DecoderImplementation {
    fn resolve_from_environment(delivery_path: Option<&str>) -> Result<Self> {
        Self::resolve_configured(
            std::env::var("PIXI_NATIVE_VIDEO_BACKEND").ok().as_deref(),
            delivery_path,
        )
    }

    fn resolve_configured(value: Option<&str>, delivery_path: Option<&str>) -> Result<Self> {
        match value {
            Some("cli") => Ok(Self::Cli),
            Some("lib") | None if delivery_path == Some("gpu-nv12") || value == Some("lib") => {
                #[cfg(feature = "native-ffmpeg")]
                {
                    Ok(Self::Native)
                }
                #[cfg(not(feature = "native-ffmpeg"))]
                {
                    Ok(Self::Cli)
                }
            }
            None => Ok(Self::Cli),
            Some(value) => Err(Error::from_reason(format!(
                "PIXI_NATIVE_VIDEO_BACKEND must be lib or cli; received {value}"
            ))),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Cli => "cli",
            #[cfg(feature = "native-ffmpeg")]
            Self::Native => "native",
        }
    }
}

impl DecoderBackend {
    fn name(self) -> &'static str {
        match self {
            #[cfg(any(target_os = "windows", test))]
            Self::D3d11va => "D3D11VA",
            #[cfg(any(target_os = "linux", test))]
            Self::Vaapi => "VA-API",
            Self::Cpu => "CPU",
        }
    }

    fn hardware() -> Option<Self> {
        #[cfg(target_os = "windows")]
        {
            Some(Self::D3d11va)
        }

        #[cfg(target_os = "linux")]
        {
            Some(Self::Vaapi)
        }

        #[cfg(not(any(target_os = "windows", target_os = "linux")))]
        {
            None
        }
    }
}

fn should_retry_d3d11va_with_cpu_transfer(
    shared_delivery_requested: bool,
    decoded_frames: u64,
    decoder_closed: bool,
) -> bool {
    cfg!(target_os = "windows")
        && shared_delivery_requested
        && decoded_frames == 0
        && !decoder_closed
}

#[derive(Clone)]
struct DecoderState {
    closed: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    frames: Arc<(Mutex<FrameQueue>, Condvar)>,
    catch_up_timestamp_us: Arc<AtomicI64>,
    source_paced: bool,
    error: Arc<Mutex<Option<String>>>,
    decoded_frames: Arc<AtomicU64>,
    dropped_frames: Arc<AtomicU64>,
    skipped_frames: Arc<AtomicU64>,
    frame_buffer_allocations: Arc<AtomicU64>,
    frame_buffer_reuses: Arc<AtomicU64>,
    backend: Arc<Mutex<String>>,
    stderr_workers: Arc<Mutex<Vec<thread::JoinHandle<()>>>>,
    delivery_path: Arc<Mutex<String>>,
    gpu_frame_copies: Arc<AtomicU64>,
    presentation_surface_drops: Arc<AtomicU64>,
    session_id: Arc<AtomicI64>,
    shared_frames: Arc<Mutex<VecDeque<PendingSharedFrame>>>,
    #[cfg(all(feature = "native-ffmpeg", target_os = "windows"))]
    shared_pool: Arc<Mutex<Option<d3d11_shared::SharedSurfacePool>>>,
}

struct PendingFrame {
    timestamp_us: i64,
    data: Vec<u8>,
}

struct PendingSharedFrame {
    timestamp_us: i64,
    surface_id: u32,
    handle: usize,
    width: u32,
    height: u32,
}

struct FrameQueue {
    capacity: usize,
    frames: VecDeque<PendingFrame>,
    recycled: Vec<Vec<u8>>,
}

impl FrameQueue {
    fn new(capacity: usize) -> Self {
        Self {
            capacity,
            frames: VecDeque::new(),
            recycled: Vec::new(),
        }
    }

    fn push_latest(&mut self, frame: PendingFrame) -> Option<Vec<u8>> {
        let recycled = if self.frames.len() >= self.capacity {
            self.frames.pop_front().map(|dropped| dropped.data)
        } else {
            None
        };
        self.frames.push_back(frame);
        recycled
    }

    fn take_recycled(&mut self, frame_bytes: usize) -> Option<Vec<u8>> {
        while let Some(buffer) = self.recycled.pop() {
            if buffer.len() == frame_bytes {
                return Some(buffer);
            }
        }
        None
    }

    fn recycle(&mut self, buffer: Vec<u8>) {
        // A decoder backend must borrow from this pool before allocating a
        // replacement. Keep the pool bounded as a final ownership guard so a
        // producer regression cannot retain one full NV12 allocation per
        // presented frame indefinitely.
        if self.recycled.len() < self.capacity {
            self.recycled.push(buffer);
        }
    }

    fn push_back(&mut self, frame: PendingFrame) {
        self.frames.push_back(frame);
    }

    fn pop_next(&mut self) -> Option<PendingFrame> {
        self.frames.pop_front()
    }

    fn pop_latest(&mut self) -> (Option<PendingFrame>, usize) {
        let latest = self.frames.pop_back();
        let skipped = self.frames.len();
        while let Some(frame) = self.frames.pop_front() {
            self.recycle(frame.data);
        }
        (latest, skipped)
    }

    fn len(&self) -> usize {
        self.frames.len()
    }

    fn recycle_queued(&mut self) {
        while let Some(frame) = self.frames.pop_front() {
            self.recycle(frame.data);
        }
    }

    fn clear(&mut self) {
        self.frames.clear();
        self.recycled.clear();
    }
}

impl Default for FrameQueue {
    fn default() -> Self {
        Self::new(FILE_FRAME_QUEUE_CAPACITY)
    }
}

fn frame_queue_capacity(source_paced: bool) -> usize {
    if source_paced {
        LIVE_FRAME_QUEUE_CAPACITY
    } else {
        FILE_FRAME_QUEUE_CAPACITY
    }
}

struct SpawnedFfmpeg {
    child: Child,
    stdout: ChildStdout,
    stderr_worker: Option<thread::JoinHandle<()>>,
}

#[derive(Clone)]
struct FfmpegRequest {
    ffmpeg_path: String,
    source: String,
    #[cfg(any(target_os = "linux", test))]
    vaapi_device: String,
    width: usize,
    height: usize,
    fps: f64,
    start_time: f64,
    end_time: Option<f64>,
    input_args: Vec<String>,
    output_args: Vec<String>,
    looped: bool,
}

#[napi]
pub struct NativeVideoDecoder {
    options: DecoderOptions,
    state: DecoderState,
    worker: Option<thread::JoinHandle<()>>,
    retired: bool,
}

#[napi]
impl NativeVideoDecoder {
    #[napi(constructor)]
    pub fn new(options: DecoderOptions) -> Result<Self> {
        validate_options(&options)?;
        let source_paced = options.source_paced.unwrap_or(false);

        let backend = DecoderBackend::hardware()
            .map(DecoderBackend::name)
            .unwrap_or("CPU")
            .to_string();

        Ok(Self {
            options,
            worker: None,
            retired: false,
            state: DecoderState {
                closed: Arc::new(AtomicBool::new(true)),
                finished: Arc::new(AtomicBool::new(false)),
                child: Arc::new(Mutex::new(None)),
                frames: Arc::new((
                    Mutex::new(FrameQueue::new(frame_queue_capacity(source_paced))),
                    Condvar::new(),
                )),
                catch_up_timestamp_us: Arc::new(AtomicI64::new(-1)),
                source_paced,
                error: Arc::new(Mutex::new(None)),
                decoded_frames: Arc::new(AtomicU64::new(0)),
                dropped_frames: Arc::new(AtomicU64::new(0)),
                skipped_frames: Arc::new(AtomicU64::new(0)),
                frame_buffer_allocations: Arc::new(AtomicU64::new(0)),
                frame_buffer_reuses: Arc::new(AtomicU64::new(0)),
                backend: Arc::new(Mutex::new(backend)),
                stderr_workers: Arc::new(Mutex::new(Vec::new())),
                delivery_path: Arc::new(Mutex::new("cpu-nv12".to_string())),
                gpu_frame_copies: Arc::new(AtomicU64::new(0)),
                presentation_surface_drops: Arc::new(AtomicU64::new(0)),
                session_id: Arc::new(AtomicI64::new(0)),
                shared_frames: Arc::new(Mutex::new(VecDeque::new())),
                #[cfg(all(feature = "native-ffmpeg", target_os = "windows"))]
                shared_pool: Arc::new(Mutex::new(None)),
            },
        })
    }

    #[napi]
    pub fn open(&mut self, source: String) -> Result<()> {
        if self.retired {
            return Err(Error::from_reason(
                "Video decoder cannot reopen after shutdown",
            ));
        }
        if self.state.closed.load(Ordering::SeqCst) {
            self.join_worker();
        }
        if !self.state.closed.swap(false, Ordering::SeqCst) {
            return Err(Error::from_reason("Video decoder is already open"));
        }

        self.state.finished.store(false, Ordering::SeqCst);
        self.state.decoded_frames.store(0, Ordering::SeqCst);
        self.state.dropped_frames.store(0, Ordering::SeqCst);
        self.state.skipped_frames.store(0, Ordering::SeqCst);
        self.state
            .frame_buffer_allocations
            .store(0, Ordering::SeqCst);
        self.state.frame_buffer_reuses.store(0, Ordering::SeqCst);
        self.state.gpu_frame_copies.store(0, Ordering::SeqCst);
        self.state
            .presentation_surface_drops
            .store(0, Ordering::SeqCst);
        self.state.session_id.store(
            NEXT_VIDEO_SESSION_ID.fetch_add(1, Ordering::SeqCst),
            Ordering::SeqCst,
        );
        set_delivery_path(&self.state, "cpu-nv12");

        if let Ok(mut error) = self.state.error.lock() {
            *error = None;
        }
        let (frames, _) = &*self.state.frames;
        if let Ok(mut frames) = frames.lock() {
            frames.clear();
        }
        clear_shared_frames(&self.state);
        #[cfg(all(feature = "native-ffmpeg", target_os = "windows"))]
        if let Ok(mut pool) = self.state.shared_pool.lock() {
            *pool = None;
        }
        self.state.catch_up_timestamp_us.store(-1, Ordering::SeqCst);

        let width = usize::try_from(self.options.width)
            .map_err(|_| Error::from_reason("Invalid video width"))?;
        let height = usize::try_from(self.options.height)
            .map_err(|_| Error::from_reason("Invalid video height"))?;
        let fps = self.options.fps.unwrap_or(30.0);
        let start_time = self.options.start_time.unwrap_or(0.0);
        let looped = self.options.loop_.unwrap_or(false);
        let implementation =
            DecoderImplementation::resolve_from_environment(self.options.delivery_path.as_deref())?;

        #[cfg(feature = "native-ffmpeg")]
        if implementation == DecoderImplementation::Native {
            set_backend_name(&self.state, "CPU libavcodec");
            let state = self.state.clone();
            let native_source = source.clone();
            let shared_delivery = self.options.delivery_path.as_deref() == Some("gpu-nv12");
            ACTIVE_DECODER_WORKERS.fetch_add(1, Ordering::SeqCst);
            self.worker = Some(thread::spawn(move || {
                let _active_worker = ActiveDecoderWorker;
                let run_decode = |hardware_decode, shared_delivery| {
                    let request = native_ffmpeg::NativeDecodeRequest {
                        source: &native_source,
                        width,
                        height,
                        fps,
                        start_time,
                        looped,
                        hardware_decode,
                        shared_delivery: hardware_decode && shared_delivery,
                    };
                    native_ffmpeg::decode_nv12(
                        &request,
                        &state.closed,
                        #[cfg(target_os = "windows")]
                        &state.shared_pool,
                        |frame_bytes| {
                            acquire_frame_buffer(frame_bytes, &state)
                                .map_err(|error| error.to_string())
                        },
                        |active_hardware_decode, active_shared_delivery| {
                            set_backend_name(
                                &state,
                                if active_shared_delivery {
                                    "D3D11VA libavcodec (GPU NV12)"
                                } else if active_hardware_decode {
                                    "D3D11VA libavcodec (CPU transfer)"
                                } else {
                                    "CPU libavcodec"
                                },
                            );
                            set_delivery_path(
                                &state,
                                if active_shared_delivery {
                                    "gpu-nv12"
                                } else {
                                    "cpu-nv12"
                                },
                            );
                        },
                        |frame| match frame {
                            native_ffmpeg::DecodedVideoFrame::Cpu(frame) => {
                                state.decoded_frames.fetch_add(1, Ordering::SeqCst);
                                enqueue_frame(
                                    PendingFrame {
                                        timestamp_us: frame.timestamp_us,
                                        data: frame.data,
                                    },
                                    &state,
                                )
                                .map_err(|error| error.to_string())
                            }
                            #[cfg(target_os = "windows")]
                            native_ffmpeg::DecodedVideoFrame::Shared {
                                timestamp_us,
                                surface_id,
                                handle,
                                width,
                                height,
                            } => {
                                state.decoded_frames.fetch_add(1, Ordering::SeqCst);
                                state.gpu_frame_copies.fetch_add(1, Ordering::SeqCst);
                                enqueue_shared_frame(
                                    PendingSharedFrame {
                                        timestamp_us,
                                        surface_id,
                                        handle,
                                        width,
                                        height,
                                    },
                                    &state,
                                )
                            }
                        },
                    )
                };
                let mut result = run_decode(cfg!(target_os = "windows"), shared_delivery);
                if result.is_err()
                    && should_retry_d3d11va_with_cpu_transfer(
                        shared_delivery,
                        state.decoded_frames.load(Ordering::SeqCst),
                        state.closed.load(Ordering::SeqCst),
                    )
                {
                    let shared_delivery_error = result
                        .as_ref()
                        .expect_err("failed shared delivery checked above");
                    eprintln!(
                        "Native D3D11VA shared NV12 delivery failed before its first frame: {shared_delivery_error}; retrying D3D11VA with CPU transfer"
                    );
                    #[cfg(target_os = "windows")]
                    if let Ok(mut pool) = state.shared_pool.lock() {
                        *pool = None;
                    }
                    result = run_decode(true, false);
                }
                if result.is_err()
                    && cfg!(target_os = "windows")
                    && state.decoded_frames.load(Ordering::SeqCst) == 0
                    && !state.closed.load(Ordering::SeqCst)
                {
                    let hardware_error = result
                        .as_ref()
                        .expect_err("failed hardware decode checked above");
                    eprintln!(
                        "Native D3D11VA decoder failed before its first frame: {hardware_error}; retrying with CPU libavcodec"
                    );
                    result = run_decode(false, false);
                }
                if let Err(error) = result {
                    if !state.closed.load(Ordering::SeqCst) {
                        store_error(&state, error);
                    }
                }
                if !state.closed.load(Ordering::SeqCst) {
                    state.finished.store(true, Ordering::SeqCst);
                }
                state.closed.store(true, Ordering::SeqCst);
            }));
            return Ok(());
        }

        #[cfg(not(feature = "native-ffmpeg"))]
        let _ = implementation;
        let ffmpeg_path = self
            .options
            .ffmpeg_path
            .clone()
            .unwrap_or_else(|| "ffmpeg".to_string());
        #[cfg(any(target_os = "linux", test))]
        let vaapi_device = self
            .options
            .vaapi_device
            .clone()
            .or_else(|| std::env::var("FFMPEG_VAAPI_DEVICE").ok())
            .unwrap_or_else(|| "/dev/dri/renderD128".to_string());

        let requested_backend = DecoderBackend::hardware().unwrap_or(DecoderBackend::Cpu);
        let request = FfmpegRequest {
            ffmpeg_path,
            source,
            #[cfg(any(target_os = "linux", test))]
            vaapi_device,
            width,
            height,
            fps,
            start_time,
            end_time: self.options.end_time,
            input_args: self.options.input_args.clone().unwrap_or_default(),
            output_args: self.options.output_args.clone().unwrap_or_default(),
            looped: self.options.loop_.unwrap_or(false),
        };
        let (spawned, active_backend) = match spawn_ffmpeg(&request, requested_backend) {
            Ok(spawned) => (spawned, requested_backend),
            Err(hardware_error) if requested_backend != DecoderBackend::Cpu => {
                eprintln!(
                    "FFmpeg {} process failed to start; retrying with CPU decoder: {hardware_error}",
                    requested_backend.name()
                );
                let spawned = spawn_ffmpeg(&request, DecoderBackend::Cpu)
                    .map_err(|error| Error::from_reason(error.to_string()))?;
                (spawned, DecoderBackend::Cpu)
            }
            Err(error) => {
                self.state.closed.store(true, Ordering::SeqCst);
                return Err(Error::from_reason(error.to_string()));
            }
        };

        set_backend_name(
            &self.state,
            if active_backend == DecoderBackend::Cpu && requested_backend != DecoderBackend::Cpu {
                "CPU fallback"
            } else {
                active_backend.name()
            },
        );

        let state = self.state.clone();
        let initial_stdout = install_child(&state, spawned)
            .map_err(|error| Error::from_reason(error.to_string()))?;

        ACTIVE_DECODER_WORKERS.fetch_add(1, Ordering::SeqCst);
        self.worker = Some(thread::spawn(move || {
            let _active_worker = ActiveDecoderWorker;
            let mut result =
                consume_decoder_attempt(initial_stdout, width, height, fps, start_time, &state);

            if active_backend != DecoderBackend::Cpu {
                for attempt in 2..=HARDWARE_DECODE_ATTEMPTS {
                    if result.is_ok() || !should_retry_hardware(attempt - 1, &state) {
                        break;
                    }
                    let error = result
                        .as_ref()
                        .expect_err("failed hardware attempt checked above");
                    eprintln!(
                        "FFmpeg {} decoder attempt {}/{} failed: {error}; retrying in {} ms",
                        active_backend.name(),
                        attempt - 1,
                        HARDWARE_DECODE_ATTEMPTS,
                        HARDWARE_RETRY_DELAY.as_millis(),
                    );
                    match wait_for_hardware_retry(&state) {
                        Ok(true) => {}
                        Ok(false) => break,
                        Err(wait_error) => {
                            result = Err(wait_error);
                            break;
                        }
                    }
                    result = spawn_ffmpeg(&request, active_backend)
                        .and_then(|spawned| install_child(&state, spawned))
                        .and_then(|stdout| {
                            consume_decoder_attempt(stdout, width, height, fps, start_time, &state)
                        });
                }
            }

            if let Err(error) = result {
                let has_frames = state.decoded_frames.load(Ordering::SeqCst) > 0;
                if active_backend != DecoderBackend::Cpu
                    && !has_frames
                    && !state.closed.load(Ordering::SeqCst)
                {
                    eprintln!(
                        "FFmpeg {} decoder failed after {} attempts; retrying with CPU decoder: {error}",
                        active_backend.name(),
                        HARDWARE_DECODE_ATTEMPTS,
                    );
                    set_backend_name(&state, "CPU fallback");

                    let fallback_result = spawn_ffmpeg(&request, DecoderBackend::Cpu)
                        .and_then(|spawned| install_child(&state, spawned))
                        .and_then(|stdout| {
                            consume_decoder_attempt(stdout, width, height, fps, start_time, &state)
                        });

                    if let Err(fallback_error) = fallback_result {
                        store_error(&state, fallback_error.to_string());
                    }
                } else if !state.closed.load(Ordering::SeqCst) {
                    store_error(&state, error.to_string());
                }
            }

            if !state.closed.load(Ordering::SeqCst) {
                state.finished.store(true, Ordering::SeqCst);
            }
            state.closed.store(true, Ordering::SeqCst);
        }));

        Ok(())
    }

    #[napi]
    pub fn poll_latest(&self) -> Option<VideoFrame> {
        let (frames, available) = &*self.state.frames;
        let (pending, skipped) = frames.lock().ok()?.pop_latest();
        available.notify_all();
        if skipped > 0 {
            self.state
                .skipped_frames
                .fetch_add(skipped as u64, Ordering::SeqCst);
        }
        self.to_video_frame(pending?)
    }

    #[napi]
    pub fn poll_next(&self) -> Option<VideoFrame> {
        let (frames, available) = &*self.state.frames;
        let pending = frames.lock().ok()?.pop_next()?;
        available.notify_one();
        self.to_video_frame(pending)
    }

    #[napi]
    pub fn poll_latest_shared(&self) -> Option<SharedVideoFrame> {
        let mut frames = self.state.shared_frames.lock().ok()?;
        let latest = frames.pop_back();
        let skipped = frames.len();
        while let Some(frame) = frames.pop_front() {
            release_shared_surface(&self.state, frame.surface_id);
        }
        drop(frames);
        if skipped > 0 {
            self.state
                .skipped_frames
                .fetch_add(skipped as u64, Ordering::SeqCst);
        }
        self.to_shared_video_frame(latest?)
    }

    #[napi]
    pub fn poll_next_shared(&self) -> Option<SharedVideoFrame> {
        let pending = self.state.shared_frames.lock().ok()?.pop_front()?;
        self.to_shared_video_frame(pending)
    }

    #[napi]
    pub fn release_shared_frame(&self, session_id: i64, surface_id: i64) -> bool {
        if session_id != self.state.session_id.load(Ordering::SeqCst) || surface_id < 0 {
            return false;
        }
        release_shared_surface(&self.state, surface_id as u32)
    }

    #[napi]
    pub fn poll_latest_into(&self, mut target: BufferSlice) -> Result<Option<VideoFrameInfo>> {
        let (frames, available) = &*self.state.frames;
        let (pending, skipped) = frames
            .lock()
            .map_err(|_| Error::from_reason("Video frame queue lock poisoned"))?
            .pop_latest();
        if skipped > 0 {
            self.state
                .skipped_frames
                .fetch_add(skipped as u64, Ordering::SeqCst);
        }
        let result = pending
            .map(|pending| self.copy_video_frame_into(pending, &mut target))
            .transpose();
        available.notify_all();
        result
    }

    #[napi]
    pub fn poll_next_into(&self, mut target: BufferSlice) -> Result<Option<VideoFrameInfo>> {
        let (frames, available) = &*self.state.frames;
        let pending = frames
            .lock()
            .map_err(|_| Error::from_reason("Video frame queue lock poisoned"))?
            .pop_next();
        let result = pending
            .map(|pending| self.copy_video_frame_into(pending, &mut target))
            .transpose();
        if result.as_ref().is_ok_and(Option::is_some) {
            available.notify_one();
        }
        result
    }

    #[napi]
    pub fn queued_frames(&self) -> i64 {
        if self.delivery_path() == "gpu-nv12" {
            return self
                .state
                .shared_frames
                .lock()
                .map(|frames| i64::try_from(frames.len()).unwrap_or(i64::MAX))
                .unwrap_or(0);
        }
        let (frames, _) = &*self.state.frames;
        frames
            .lock()
            .map(|frames| i64::try_from(frames.len()).unwrap_or(i64::MAX))
            .unwrap_or(0)
    }

    #[napi]
    pub fn catch_up_to(&self, timestamp_us: i64) -> Result<()> {
        if timestamp_us < 0 {
            return Err(Error::from_reason(
                "Catch-up timestamp must be non-negative",
            ));
        }

        self.state
            .catch_up_timestamp_us
            .store(timestamp_us, Ordering::SeqCst);
        let (frames, available) = &*self.state.frames;
        if let Ok(mut frames) = frames.lock() {
            let skipped = frames.len();
            frames.recycle_queued();
            self.state
                .skipped_frames
                .fetch_add(skipped as u64, Ordering::SeqCst);
        }
        clear_shared_frames(&self.state);
        available.notify_all();
        Ok(())
    }

    fn to_video_frame(&self, pending: PendingFrame) -> Option<VideoFrame> {
        Some(VideoFrame {
            width: self.options.width,
            height: self.options.height,
            timestamp_us: pending.timestamp_us,
            data: Buffer::from(pending.data),
        })
    }

    fn to_shared_video_frame(&self, pending: PendingSharedFrame) -> Option<SharedVideoFrame> {
        Some(SharedVideoFrame {
            width: i64::from(pending.width),
            height: i64::from(pending.height),
            timestamp_us: pending.timestamp_us,
            session_id: self.state.session_id.load(Ordering::SeqCst),
            surface_id: pending.surface_id as i64,
            shared_handle: Buffer::from(pending.handle.to_ne_bytes().to_vec()),
        })
    }

    #[napi]
    pub fn poll_error(&self) -> Option<String> {
        self.state.error.lock().ok()?.take()
    }

    #[napi]
    pub fn backend(&self) -> String {
        self.state
            .backend
            .lock()
            .map(|backend| backend.clone())
            .unwrap_or_else(|_| "unknown".to_string())
    }

    #[napi]
    pub fn decoded_frames(&self) -> i64 {
        i64::try_from(self.state.decoded_frames.load(Ordering::SeqCst)).unwrap_or(i64::MAX)
    }

    #[napi]
    pub fn dropped_frames(&self) -> i64 {
        i64::try_from(self.state.dropped_frames.load(Ordering::SeqCst)).unwrap_or(i64::MAX)
    }

    #[napi]
    pub fn skipped_frames(&self) -> i64 {
        i64::try_from(self.state.skipped_frames.load(Ordering::SeqCst)).unwrap_or(i64::MAX)
    }

    #[napi]
    pub fn frame_buffer_allocations(&self) -> i64 {
        i64::try_from(self.state.frame_buffer_allocations.load(Ordering::SeqCst))
            .unwrap_or(i64::MAX)
    }

    #[napi]
    pub fn frame_buffer_reuses(&self) -> i64 {
        i64::try_from(self.state.frame_buffer_reuses.load(Ordering::SeqCst)).unwrap_or(i64::MAX)
    }

    #[napi]
    pub fn recycled_frame_buffers(&self) -> i64 {
        let (frames, _) = &*self.state.frames;
        frames
            .lock()
            .map(|frames| i64::try_from(frames.recycled.len()).unwrap_or(i64::MAX))
            .unwrap_or(0)
    }

    #[napi]
    pub fn delivery_path(&self) -> String {
        self.state
            .delivery_path
            .lock()
            .map(|path| path.clone())
            .unwrap_or_else(|_| "cpu-nv12".to_string())
    }

    #[napi]
    pub fn implementation_backend(&self) -> String {
        DecoderImplementation::resolve_from_environment(self.options.delivery_path.as_deref())
            .unwrap_or(DecoderImplementation::Cli)
            .name()
            .to_string()
    }

    #[napi]
    pub fn gpu_frame_copies(&self) -> i64 {
        atomic_i64(&self.state.gpu_frame_copies)
    }

    #[napi]
    pub fn cpu_frame_bytes(&self) -> i64 {
        if self.delivery_path() == "gpu-nv12" {
            return 0;
        }
        let frame_bytes = nv12_frame_bytes(
            usize::try_from(self.options.width).unwrap_or(0),
            usize::try_from(self.options.height).unwrap_or(0),
        )
        .unwrap_or(0) as u64;
        let bytes = self
            .state
            .decoded_frames
            .load(Ordering::SeqCst)
            .saturating_mul(frame_bytes);
        i64::try_from(bytes).unwrap_or(i64::MAX)
    }

    #[napi]
    pub fn presentation_surface_drops(&self) -> i64 {
        atomic_i64(&self.state.presentation_surface_drops)
    }

    #[napi]
    pub fn is_finished(&self) -> bool {
        self.state.finished.load(Ordering::SeqCst)
    }

    #[napi]
    pub fn close(&mut self) {
        self.begin_shutdown();
    }

    fn begin_shutdown(&mut self) {
        if self.retired {
            return;
        }
        self.retired = true;
        let child = request_close_state(&self.state);
        retire_decoder_cleanup(self.worker.take(), child);
    }

    fn join_worker(&mut self) {
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }

    fn copy_video_frame_into(
        &self,
        pending: PendingFrame,
        target: &mut [u8],
    ) -> Result<VideoFrameInfo> {
        if target.len() != pending.data.len() {
            let actual = target.len();
            let expected = pending.data.len();
            if let Ok(mut frames) = self.state.frames.0.lock() {
                frames.recycle(pending.data);
            }
            return Err(Error::from_reason(format!(
                "NV12 target has {actual} bytes; expected {expected}"
            )));
        }
        target.copy_from_slice(&pending.data);
        if let Ok(mut frames) = self.state.frames.0.lock() {
            frames.recycle(pending.data);
        }
        Ok(VideoFrameInfo {
            width: self.options.width,
            height: self.options.height,
            timestamp_us: pending.timestamp_us,
        })
    }
}

impl Drop for NativeVideoDecoder {
    fn drop(&mut self) {
        self.begin_shutdown();
    }
}

fn validate_options(options: &DecoderOptions) -> Result<()> {
    if options
        .delivery_path
        .as_deref()
        .is_some_and(|path| path != "cpu-nv12" && path != "gpu-nv12")
    {
        return Err(Error::from_reason(
            "Video deliveryPath must be cpu-nv12 or gpu-nv12",
        ));
    }
    let implementation =
        DecoderImplementation::resolve_from_environment(options.delivery_path.as_deref())?;
    #[cfg(feature = "native-ffmpeg")]
    if implementation == DecoderImplementation::Native {
        if options.end_time.is_some()
            || options.source_paced.unwrap_or(false)
            || options.playback_rate.is_some_and(|rate| rate != 1.0)
            || options
                .input_args
                .as_ref()
                .is_some_and(|args| !args.is_empty())
            || options
                .output_args
                .as_ref()
                .is_some_and(|args| !args.is_empty())
        {
            return Err(Error::from_reason(
                "Native libav video backend currently supports unbounded file playback at rate 1 without custom FFmpeg arguments",
            ));
        }
    }
    #[cfg(not(feature = "native-ffmpeg"))]
    let _ = implementation;
    if options.width <= 0 || options.height <= 0 {
        return Err(Error::from_reason("Video dimensions must be positive"));
    }
    if options.width % 2 != 0 || options.height % 2 != 0 {
        return Err(Error::from_reason("NV12 video dimensions must be even"));
    }

    let fps = options.fps.unwrap_or(30.0);
    if !fps.is_finite() || fps <= 0.0 {
        return Err(Error::from_reason("Video FPS must be positive and finite"));
    }

    let start_time = options.start_time.unwrap_or(0.0);
    if !start_time.is_finite() || start_time < 0.0 {
        return Err(Error::from_reason(
            "Video start time must be non-negative and finite",
        ));
    }

    let playback_rate = options.playback_rate.unwrap_or(1.0);
    if !playback_rate.is_finite() || playback_rate <= 0.0 {
        return Err(Error::from_reason(
            "Video playback rate must be positive and finite",
        ));
    }

    if let Some(end_time) = options.end_time {
        if !end_time.is_finite() || end_time <= start_time {
            return Err(Error::from_reason(
                "Video end time must be finite and greater than start time",
            ));
        }
    }
    Ok(())
}

fn nv12_frame_bytes(width: usize, height: usize) -> io::Result<usize> {
    let y_bytes = width
        .checked_mul(height)
        .ok_or_else(|| io::Error::other("Video frame size overflow"))?;
    y_bytes
        .checked_add(y_bytes / 2)
        .ok_or_else(|| io::Error::other("Video frame size overflow"))
}

fn ffmpeg_args(request: &FfmpegRequest, backend: DecoderBackend) -> Vec<String> {
    let mut args = vec![
        "-hide_banner".to_string(),
        "-loglevel".to_string(),
        "error".to_string(),
        "-nostdin".to_string(),
    ];

    match backend {
        #[cfg(any(target_os = "windows", test))]
        DecoderBackend::D3d11va => {
            args.extend(["-hwaccel".to_string(), "d3d11va".to_string()]);
        }
        #[cfg(any(target_os = "linux", test))]
        DecoderBackend::Vaapi => {
            args.extend([
                "-hwaccel".to_string(),
                "vaapi".to_string(),
                "-hwaccel_device".to_string(),
                request.vaapi_device.clone(),
                "-hwaccel_output_format".to_string(),
                "vaapi".to_string(),
            ]);
        }
        DecoderBackend::Cpu => {}
    }

    if request.start_time > 0.0 {
        args.extend(["-ss".to_string(), request.start_time.to_string()]);
    }
    args.extend(request.input_args.iter().cloned());
    if request.looped {
        args.extend(["-stream_loop".to_string(), "-1".to_string()]);
    }
    args.extend(["-i".to_string(), request.source.clone(), "-an".to_string()]);
    if let Some(end_time) = request.end_time.filter(|_| !request.looped) {
        args.extend([
            "-t".to_string(),
            (end_time - request.start_time).to_string(),
        ]);
    }
    args.extend(request.output_args.iter().cloned());

    let scale = format!(
        "fps={},scale={}:{}:flags=fast_bilinear:in_range=auto:out_range=tv:in_color_matrix=auto:out_color_matrix=bt709,format=nv12",
        request.fps, request.width, request.height
    );
    let filter = match backend {
        #[cfg(any(target_os = "linux", test))]
        DecoderBackend::Vaapi => format!("hwdownload,format=nv12,{scale}"),
        #[cfg(any(target_os = "windows", test))]
        DecoderBackend::D3d11va => scale,
        // Keep the CPU fallback independent from the color-negotiation path
        // used after VA-API download. Some FFmpeg builds fail to initialize
        // auto_scale when that path is reused for software yuv420p frames.
        DecoderBackend::Cpu => format!(
            "fps={},scale={}:{}:flags=fast_bilinear,format=nv12",
            request.fps, request.width, request.height
        ),
    };

    if backend == DecoderBackend::Cpu {
        // The bundled/minimal FFmpeg builds can fail filter negotiation when
        // multiple filter workers initialize the software graph concurrently.
        args.extend([
            "-filter_threads".to_string(),
            "1".to_string(),
            "-filter_complex_threads".to_string(),
            "1".to_string(),
        ]);
    }

    args.extend([
        "-vf".to_string(),
        filter,
        "-f".to_string(),
        "rawvideo".to_string(),
        "-pix_fmt".to_string(),
        "nv12".to_string(),
        "pipe:1".to_string(),
    ]);
    args
}

fn spawn_ffmpeg(request: &FfmpegRequest, backend: DecoderBackend) -> io::Result<SpawnedFfmpeg> {
    let mut child = Command::new(&request.ffmpeg_path)
        .args(ffmpeg_args(request, backend))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("FFmpeg stdout unavailable"))?;
    let stderr_worker = child.stderr.take().map(|stderr| {
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(|line| line.ok()) {
                eprintln!("{}", redact_url_credentials(&line));
            }
        })
    });
    Ok(SpawnedFfmpeg {
        child,
        stdout,
        stderr_worker,
    })
}

fn redact_url_credentials(value: &str) -> String {
    let mut result = value.to_string();
    let mut search_from = 0;
    while let Some(relative_scheme) = result[search_from..].find("://") {
        let authority_start = search_from + relative_scheme + 3;
        let authority_end = result[authority_start..]
            .find(|character: char| character == '/' || character.is_whitespace())
            .map(|offset| authority_start + offset)
            .unwrap_or(result.len());
        let Some(relative_at) = result[authority_start..authority_end].find('@') else {
            search_from = authority_end.min(result.len());
            continue;
        };
        let at = authority_start + relative_at;
        result.replace_range(authority_start..at, "***:***");
        search_from = authority_start + "***:***@".len();
    }
    result
}

fn install_child(state: &DecoderState, mut spawned: SpawnedFfmpeg) -> io::Result<ChildStdout> {
    let mut child = state
        .child
        .lock()
        .map_err(|_| io::Error::other("FFmpeg process lock poisoned"))?;
    if state.closed.load(Ordering::SeqCst) {
        drop(child);
        let _ = spawned.child.kill();
        let _ = spawned.child.wait();
        if let Some(worker) = spawned.stderr_worker {
            let _ = worker.join();
        }
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "Video decoder closed before FFmpeg startup completed",
        ));
    }
    *child = Some(spawned.child);
    drop(child);
    if let Some(worker) = spawned.stderr_worker {
        state
            .stderr_workers
            .lock()
            .map_err(|_| io::Error::other("FFmpeg stderr worker lock poisoned"))?
            .push(worker);
    }
    Ok(spawned.stdout)
}

fn consume_ffmpeg_output(
    mut stdout: ChildStdout,
    width: usize,
    height: usize,
    fps: f64,
    start_time: f64,
    state: &DecoderState,
) -> io::Result<()> {
    let frame_bytes = nv12_frame_bytes(width, height)?;
    let start_timestamp_us = (start_time * 1_000_000.0).round() as i64;
    let mut frame_index = 0_i64;
    let mut data = acquire_frame_buffer(frame_bytes, state)?;
    let read_result = loop {
        if state.closed.load(Ordering::SeqCst) {
            break Ok(());
        }

        match stdout.read_exact(&mut data) {
            Ok(()) => {
                let timestamp_us =
                    start_timestamp_us + (frame_index as f64 * 1_000_000.0 / fps).round() as i64;
                frame_index += 1;
                state.decoded_frames.fetch_add(1, Ordering::SeqCst);

                enqueue_frame(PendingFrame { timestamp_us, data }, state)?;
                data = acquire_frame_buffer(frame_bytes, state)?;
            }
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break Ok(()),
            Err(error) => break Err(error),
        }
    };

    let status = wait_for_child_exit(state)?;
    join_stderr_workers(state);

    read_result?;
    if !state.closed.load(Ordering::SeqCst) && status.is_some_and(|status| !status.success()) {
        return Err(io::Error::other(format!(
            "FFmpeg exited with status {}",
            status.expect("status checked above")
        )));
    }
    Ok(())
}

fn consume_decoder_attempt(
    stdout: ChildStdout,
    width: usize,
    height: usize,
    fps: f64,
    start_time: f64,
    state: &DecoderState,
) -> io::Result<()> {
    let result = consume_ffmpeg_output(stdout, width, height, fps, start_time, state);
    result?;
    if !state.closed.load(Ordering::SeqCst) && state.decoded_frames.load(Ordering::SeqCst) == 0 {
        return Err(io::Error::other(
            "FFmpeg ended before producing its first video frame",
        ));
    }
    Ok(())
}

fn should_retry_hardware(completed_attempts: usize, state: &DecoderState) -> bool {
    completed_attempts < HARDWARE_DECODE_ATTEMPTS
        && state.decoded_frames.load(Ordering::SeqCst) == 0
        && !state.closed.load(Ordering::SeqCst)
}

fn wait_for_hardware_retry(state: &DecoderState) -> io::Result<bool> {
    if state.closed.load(Ordering::SeqCst) {
        return Ok(false);
    }
    let (frames, available) = &*state.frames;
    let frames = frames
        .lock()
        .map_err(|_| io::Error::other("Video frame queue lock poisoned"))?;
    let (_frames, _) = available
        .wait_timeout_while(frames, HARDWARE_RETRY_DELAY, |_| {
            !state.closed.load(Ordering::SeqCst)
        })
        .map_err(|_| io::Error::other("Video frame queue lock poisoned"))?;
    Ok(!state.closed.load(Ordering::SeqCst))
}

fn enqueue_frame(frame: PendingFrame, state: &DecoderState) -> io::Result<()> {
    let catch_up_timestamp_us = state.catch_up_timestamp_us.load(Ordering::SeqCst);
    if catch_up_timestamp_us >= 0 && frame.timestamp_us < catch_up_timestamp_us {
        state.skipped_frames.fetch_add(1, Ordering::SeqCst);
        let (frames, _) = &*state.frames;
        frames
            .lock()
            .map_err(|_| io::Error::other("Video frame queue lock poisoned"))?
            .recycle(frame.data);
        return Ok(());
    }
    if catch_up_timestamp_us >= 0 {
        state.catch_up_timestamp_us.store(-1, Ordering::SeqCst);
    }

    let (frames, available) = &*state.frames;
    let mut frames = frames
        .lock()
        .map_err(|_| io::Error::other("Video frame queue lock poisoned"))?;

    if state.source_paced {
        if let Some(recycled) = frames.push_latest(frame) {
            state.dropped_frames.fetch_add(1, Ordering::SeqCst);
            frames.recycle(recycled);
        }
    } else {
        while frames.len() >= frames.capacity
            && !state.closed.load(Ordering::SeqCst)
            && state.catch_up_timestamp_us.load(Ordering::SeqCst) < 0
        {
            frames = available
                .wait(frames)
                .map_err(|_| io::Error::other("Video frame queue lock poisoned"))?;
        }
        if state.closed.load(Ordering::SeqCst) {
            frames.recycle(frame.data);
            return Ok(());
        }
        let target = state.catch_up_timestamp_us.load(Ordering::SeqCst);
        if target >= 0 && frame.timestamp_us < target {
            state.skipped_frames.fetch_add(1, Ordering::SeqCst);
            frames.recycle(frame.data);
            return Ok(());
        }
        if target >= 0 {
            state.catch_up_timestamp_us.store(-1, Ordering::SeqCst);
        }
        frames.push_back(frame);
    }

    Ok(())
}

fn enqueue_shared_frame(
    frame: PendingSharedFrame,
    state: &DecoderState,
) -> std::result::Result<(), String> {
    let catch_up_timestamp_us = state.catch_up_timestamp_us.load(Ordering::SeqCst);
    if catch_up_timestamp_us >= 0 && frame.timestamp_us < catch_up_timestamp_us {
        state.skipped_frames.fetch_add(1, Ordering::SeqCst);
        release_shared_surface(state, frame.surface_id);
        return Ok(());
    }
    if catch_up_timestamp_us >= 0 {
        state.catch_up_timestamp_us.store(-1, Ordering::SeqCst);
    }
    let mut frames = state
        .shared_frames
        .lock()
        .map_err(|_| "Shared video frame queue lock poisoned".to_string())?;
    if frames.len() >= frame_queue_capacity(state.source_paced) {
        if let Some(dropped) = frames.pop_front() {
            release_shared_surface(state, dropped.surface_id);
            state.dropped_frames.fetch_add(1, Ordering::SeqCst);
        }
    }
    frames.push_back(frame);
    Ok(())
}

fn clear_shared_frames(state: &DecoderState) {
    let Ok(mut frames) = state.shared_frames.lock() else {
        return;
    };
    while let Some(frame) = frames.pop_front() {
        release_shared_surface(state, frame.surface_id);
    }
}

fn release_shared_surface(state: &DecoderState, surface_id: u32) -> bool {
    #[cfg(all(feature = "native-ffmpeg", target_os = "windows"))]
    {
        return state
            .shared_pool
            .lock()
            .ok()
            .and_then(|pool| pool.as_ref().map(|pool| pool.release(surface_id)))
            .unwrap_or(false);
    }
    #[cfg(not(all(feature = "native-ffmpeg", target_os = "windows")))]
    {
        let _ = (state, surface_id);
        false
    }
}

fn acquire_frame_buffer(frame_bytes: usize, state: &DecoderState) -> io::Result<Vec<u8>> {
    let (frames, _) = &*state.frames;
    if let Some(buffer) = frames
        .lock()
        .map_err(|_| io::Error::other("Video frame queue lock poisoned"))?
        .take_recycled(frame_bytes)
    {
        state.frame_buffer_reuses.fetch_add(1, Ordering::SeqCst);
        return Ok(buffer);
    }
    state
        .frame_buffer_allocations
        .fetch_add(1, Ordering::SeqCst);
    Ok(vec![0_u8; frame_bytes])
}

fn join_stderr_workers(state: &DecoderState) {
    let workers = state
        .stderr_workers
        .lock()
        .map(|mut workers| workers.drain(..).collect::<Vec<_>>())
        .unwrap_or_default();
    for worker in workers {
        let _ = worker.join();
    }
}

fn set_backend_name(state: &DecoderState, name: &str) {
    if let Ok(mut backend) = state.backend.lock() {
        *backend = name.to_string();
    }
}

fn set_delivery_path(state: &DecoderState, path: &str) {
    if let Ok(mut delivery_path) = state.delivery_path.lock() {
        *delivery_path = path.to_string();
    }
}

fn store_error(state: &DecoderState, message: String) {
    eprintln!("FFmpeg decoder failed: {message}");
    if let Ok(mut error) = state.error.lock() {
        *error = Some(message);
    }
}

/** Polls without holding the child mutex while the FFmpeg process exits. */
fn wait_for_child_exit(state: &DecoderState) -> io::Result<Option<std::process::ExitStatus>> {
    loop {
        let status = {
            let mut child = state
                .child
                .lock()
                .map_err(|_| io::Error::other("FFmpeg process lock poisoned"))?;
            match child.as_mut() {
                Some(process) => process.try_wait()?,
                None => return Ok(None),
            }
        };
        if let Some(status) = status {
            if let Ok(mut child) = state.child.lock() {
                child.take();
            }
            return Ok(Some(status));
        }
        if state.closed.load(Ordering::SeqCst) {
            return Ok(None);
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/** Signals decoder shutdown without waiting on FFmpeg or worker threads. */
fn request_close_state(state: &DecoderState) -> Option<Child> {
    state.closed.store(true, Ordering::SeqCst);
    let (frames, available) = &*state.frames;
    available.notify_all();
    let mut child = state.child.lock().ok().and_then(|mut child| child.take());
    if let Some(process) = child.as_mut() {
        let _ = process.kill();
    }
    if let Ok(mut frames) = frames.lock() {
        frames.clear();
    }
    clear_shared_frames(state);
    child
}

/** Reaps the killed process and joins workers away from the N-API thread. */
fn retire_decoder_cleanup(worker: Option<thread::JoinHandle<()>>, child: Option<Child>) {
    if worker.is_none() && child.is_none() {
        return;
    }
    PENDING_DECODER_SHUTDOWNS.fetch_add(1, Ordering::SeqCst);
    thread::spawn(move || {
        let started = Instant::now();
        if let Some(mut process) = child {
            let _ = process.wait();
        }
        if let Some(worker) = worker {
            let _ = worker.join();
        }
        let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        MAX_DECODER_SHUTDOWN_MS.fetch_max(elapsed_ms, Ordering::SeqCst);
        COMPLETED_DECODER_SHUTDOWNS.fetch_add(1, Ordering::SeqCst);
        PENDING_DECODER_SHUTDOWNS.fetch_sub(1, Ordering::SeqCst);
    });
}

fn atomic_i64(value: &AtomicU64) -> i64 {
    i64::try_from(value.load(Ordering::SeqCst)).unwrap_or(i64::MAX)
}

struct ActiveDecoderWorker;

impl Drop for ActiveDecoderWorker {
    fn drop(&mut self) {
        ACTIVE_DECODER_WORKERS.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decoder_implementation_uses_cli_for_cpu_delivery_and_lib_for_gpu_delivery() {
        assert_eq!(
            DecoderImplementation::resolve_configured(Some("cli"), Some("gpu-nv12")).unwrap(),
            DecoderImplementation::Cli
        );
        assert_eq!(
            DecoderImplementation::resolve_configured(None, Some("cpu-nv12")).unwrap(),
            DecoderImplementation::Cli
        );
        #[cfg(feature = "native-ffmpeg")]
        assert_eq!(
            DecoderImplementation::resolve_configured(None, Some("gpu-nv12")).unwrap(),
            DecoderImplementation::Native
        );
        #[cfg(not(feature = "native-ffmpeg"))]
        assert_eq!(
            DecoderImplementation::resolve_configured(None, Some("gpu-nv12")).unwrap(),
            DecoderImplementation::Cli
        );
        assert!(DecoderImplementation::resolve_configured(Some("native"), None).is_err());
    }
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn calculates_nv12_frame_size() {
        assert_eq!(nv12_frame_bytes(1280, 720).unwrap(), 1_382_400);
        assert_eq!(nv12_frame_bytes(1920, 1080).unwrap(), 3_110_400);
    }

    #[test]
    fn shared_frames_keep_the_decoded_dimensions() {
        let decoder = test_decoder();
        let frame = decoder
            .to_shared_video_frame(PendingSharedFrame {
                timestamp_us: 1_000,
                surface_id: 3,
                handle: 0x1234,
                width: 3_840,
                height: 2_160,
            })
            .expect("shared frame metadata");

        assert_eq!(frame.width, 3_840);
        assert_eq!(frame.height, 2_160);
        assert_eq!(frame.timestamp_us, 1_000);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn retries_failed_shared_delivery_through_d3d11va_cpu_transfer() {
        assert!(should_retry_d3d11va_with_cpu_transfer(true, 0, false));
        assert!(!should_retry_d3d11va_with_cpu_transfer(false, 0, false));
        assert!(!should_retry_d3d11va_with_cpu_transfer(true, 1, false));
        assert!(!should_retry_d3d11va_with_cpu_transfer(true, 0, true));
    }

    #[test]
    fn builds_windows_nv12_seek_args() {
        let args = ffmpeg_args(&request(24.0, 12.5), DecoderBackend::D3d11va);
        assert!(args.windows(2).any(|pair| pair == ["-hwaccel", "d3d11va"]));
        assert!(args.windows(2).any(|pair| pair == ["-ss", "12.5"]));
        assert!(args
            .iter()
            .any(|arg| arg.contains("out_color_matrix=bt709")));
        assert_eq!(args[args.len() - 3..], ["-pix_fmt", "nv12", "pipe:1"]);
    }

    #[test]
    fn builds_linux_vaapi_download_filter() {
        let args = ffmpeg_args(&request(30.0, 0.0), DecoderBackend::Vaapi);
        assert!(args.iter().any(|arg| arg == "/dev/dri/test"));
        assert!(args
            .iter()
            .any(|arg| arg.starts_with("hwdownload,format=nv12,fps=")));
        assert!(!args.iter().any(|arg| arg == "-ss"));
    }

    #[test]
    fn builds_custom_arguments_without_readrate() {
        let mut request = request(25.0, 0.0);
        request.input_args = vec!["-fflags".to_string(), "nobuffer".to_string()];
        request.output_args = vec!["-threads".to_string(), "1".to_string()];
        let args = ffmpeg_args(&request, DecoderBackend::Cpu);
        assert!(!args.iter().any(|arg| arg == "-readrate" || arg == "-re"));
        let input_index = args.iter().position(|arg| arg == "-i").unwrap();
        let fflags_index = args.iter().position(|arg| arg == "-fflags").unwrap();
        let threads_index = args.iter().position(|arg| arg == "-threads").unwrap();
        let pipe_index = args.iter().position(|arg| arg == "pipe:1").unwrap();
        assert!(fflags_index < input_index);
        assert!(threads_index > input_index && threads_index < pipe_index);
    }

    #[test]
    fn loops_full_file_input_without_a_duration_limit() {
        let mut request = request(30.0, 0.0);
        request.looped = true;
        request.end_time = Some(2.0);
        let args = ffmpeg_args(&request, DecoderBackend::Cpu);
        let loop_index = args.iter().position(|arg| arg == "-stream_loop").unwrap();
        let input_index = args.iter().position(|arg| arg == "-i").unwrap();
        assert_eq!(args[loop_index + 1], "-1");
        assert!(loop_index < input_index);
        assert!(!args.iter().any(|arg| arg == "-t"));
    }

    #[test]
    fn builds_serial_software_fallback_filter() {
        let args = ffmpeg_args(&request(30.0, 0.0), DecoderBackend::Cpu);
        assert!(args.windows(2).any(|pair| pair == ["-filter_threads", "1"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-filter_complex_threads", "1"]));
        assert!(args
            .iter()
            .any(|arg| arg == "fps=30,scale=1280:720:flags=fast_bilinear,format=nv12"));
        assert!(!args.iter().any(|arg| arg.contains("in_color_matrix=auto")));
    }

    #[test]
    fn redacts_url_credentials_from_ffmpeg_errors() {
        assert_eq!(
            redact_url_credentials("failed http://root:secret@10.1.2.3/live.sdp"),
            "failed http://***:***@10.1.2.3/live.sdp"
        );
    }

    #[test]
    fn rejects_odd_nv12_dimensions() {
        let result = validate_options(&DecoderOptions {
            width: 1279,
            height: 720,
            fps: Some(24.0),
            start_time: None,
            ffmpeg_path: None,
            vaapi_device: None,
            playback_rate: None,
            end_time: None,
            source_paced: None,
            input_args: None,
            output_args: None,
            loop_: None,
            delivery_path: None,
        });
        assert!(result.is_err());
    }

    #[test]
    fn frame_queue_preserves_order_and_drops_oldest_on_overflow() {
        let mut queue = FrameQueue::default();
        for timestamp_us in 0..FILE_FRAME_QUEUE_CAPACITY as i64 {
            assert!(queue.push_latest(pending(timestamp_us)).is_none());
        }

        let recycled = queue
            .push_latest(pending(FILE_FRAME_QUEUE_CAPACITY as i64))
            .expect("oldest frame should be recycled");
        assert_eq!(recycled, vec![0]);
        assert_eq!(queue.len(), FILE_FRAME_QUEUE_CAPACITY);
        assert_eq!(queue.pop_next().unwrap().timestamp_us, 1);
        assert_eq!(queue.pop_next().unwrap().timestamp_us, 2);
    }

    #[test]
    fn frame_queue_can_take_latest_and_reports_skipped_frames() {
        let mut queue = FrameQueue::default();
        queue.push_latest(pending(10));
        queue.push_latest(pending(20));
        queue.push_latest(pending(30));

        let (latest, skipped) = queue.pop_latest();
        assert_eq!(latest.unwrap().timestamp_us, 30);
        assert_eq!(skipped, 2);
        assert_eq!(queue.len(), 0);
    }

    #[test]
    fn recycled_frame_pool_is_bounded() {
        let mut queue = FrameQueue::default();
        for value in 0..(FILE_FRAME_QUEUE_CAPACITY * 3) {
            queue.recycle(vec![value as u8]);
        }

        assert_eq!(queue.recycled.len(), FILE_FRAME_QUEUE_CAPACITY);
    }

    #[test]
    fn live_playback_keeps_two_queued_frames() {
        assert_eq!(frame_queue_capacity(false), FILE_FRAME_QUEUE_CAPACITY);
        assert_eq!(frame_queue_capacity(true), LIVE_FRAME_QUEUE_CAPACITY);
    }

    #[test]
    fn file_queue_applies_backpressure_until_a_frame_is_consumed() {
        let state = decoder_state(false);
        for timestamp_us in 0..FILE_FRAME_QUEUE_CAPACITY as i64 {
            enqueue_frame(pending(timestamp_us), &state).unwrap();
        }

        let producer_state = state.clone();
        let (sent, received) = mpsc::channel();
        thread::spawn(move || {
            let result = enqueue_frame(pending(99), &producer_state);
            sent.send(result.is_ok()).unwrap();
        });

        assert!(received.recv_timeout(Duration::from_millis(25)).is_err());
        let (frames, available) = &*state.frames;
        frames.lock().unwrap().pop_next();
        available.notify_one();
        assert!(received.recv_timeout(Duration::from_secs(1)).unwrap());
    }

    #[test]
    fn catch_up_discards_obsolete_file_frames_before_rebuffering() {
        let state = decoder_state(false);
        state.catch_up_timestamp_us.store(30, Ordering::SeqCst);

        enqueue_frame(pending(10), &state).unwrap();
        enqueue_frame(pending(20), &state).unwrap();
        enqueue_frame(pending(30), &state).unwrap();

        assert_eq!(state.skipped_frames.load(Ordering::SeqCst), 2);
        let (frames, _) = &*state.frames;
        let mut frames = frames.lock().unwrap();
        assert_eq!(frames.pop_next().unwrap().timestamp_us, 30);
        assert_eq!(frames.recycled.len(), 2);
    }

    #[test]
    fn copies_frame_into_caller_buffer_and_recycles_native_storage() {
        let decoder = NativeVideoDecoder::new(DecoderOptions {
            width: 2,
            height: 2,
            fps: Some(30.0),
            start_time: None,
            ffmpeg_path: None,
            vaapi_device: None,
            playback_rate: None,
            end_time: None,
            source_paced: None,
            input_args: None,
            output_args: None,
            loop_: None,
            delivery_path: None,
        })
        .unwrap();
        let mut target = vec![0; 6];
        let info = decoder
            .copy_video_frame_into(
                PendingFrame {
                    timestamp_us: 42,
                    data: vec![1, 2, 3, 4, 5, 6],
                },
                &mut target,
            )
            .unwrap();

        assert_eq!(target, vec![1, 2, 3, 4, 5, 6]);
        assert_eq!(info.timestamp_us, 42);
        assert_eq!(decoder.state.frames.0.lock().unwrap().recycled.len(), 1);
    }

    #[test]
    fn rejects_wrong_caller_buffer_size_without_losing_native_storage() {
        let decoder = NativeVideoDecoder::new(DecoderOptions {
            width: 2,
            height: 2,
            fps: Some(30.0),
            start_time: None,
            ffmpeg_path: None,
            vaapi_device: None,
            playback_rate: None,
            end_time: None,
            source_paced: None,
            input_args: None,
            output_args: None,
            loop_: None,
            delivery_path: None,
        })
        .unwrap();
        let mut target = vec![0; 5];
        let result = decoder.copy_video_frame_into(
            PendingFrame {
                timestamp_us: 42,
                data: vec![1, 2, 3, 4, 5, 6],
            },
            &mut target,
        );

        assert!(result.is_err());
        assert_eq!(decoder.state.frames.0.lock().unwrap().recycled.len(), 1);
    }

    #[test]
    fn close_retires_a_blocked_worker_without_waiting_for_it() {
        let mut decoder = test_decoder();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        decoder.worker = Some(thread::spawn(move || {
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        }));
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let completed_before = COMPLETED_DECODER_SHUTDOWNS.load(Ordering::SeqCst);

        let started = Instant::now();
        decoder.close();
        assert!(started.elapsed() < Duration::from_millis(100));
        assert!(PENDING_DECODER_SHUTDOWNS.load(Ordering::SeqCst) >= 1);

        release_tx.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        while COMPLETED_DECODER_SHUTDOWNS.load(Ordering::SeqCst) == completed_before {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn explicit_close_makes_the_decoder_terminal_without_blocking_reopen() {
        let mut decoder = test_decoder();
        decoder.close();

        let error = decoder.open("unused.mp4".to_string()).unwrap_err();
        assert!(error.to_string().contains("cannot reopen after shutdown"));
    }

    #[test]
    fn hardware_retry_stops_after_five_attempts_or_first_frame() {
        let state = decoder_state(false);
        for completed_attempts in 1..HARDWARE_DECODE_ATTEMPTS {
            assert!(should_retry_hardware(completed_attempts, &state));
        }
        assert!(!should_retry_hardware(HARDWARE_DECODE_ATTEMPTS, &state));

        state.decoded_frames.store(1, Ordering::SeqCst);
        assert!(!should_retry_hardware(1, &state));

        state.decoded_frames.store(0, Ordering::SeqCst);
        state.closed.store(true, Ordering::SeqCst);
        assert!(!should_retry_hardware(1, &state));
    }

    fn pending(timestamp_us: i64) -> PendingFrame {
        PendingFrame {
            timestamp_us,
            data: vec![timestamp_us as u8],
        }
    }

    fn test_decoder() -> NativeVideoDecoder {
        NativeVideoDecoder::new(DecoderOptions {
            width: 2,
            height: 2,
            fps: Some(30.0),
            start_time: None,
            ffmpeg_path: None,
            vaapi_device: None,
            playback_rate: None,
            end_time: None,
            source_paced: None,
            input_args: None,
            output_args: None,
            loop_: None,
            delivery_path: None,
        })
        .unwrap()
    }

    fn decoder_state(source_paced: bool) -> DecoderState {
        DecoderState {
            closed: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
            child: Arc::new(Mutex::new(None)),
            frames: Arc::new((
                Mutex::new(FrameQueue::new(frame_queue_capacity(source_paced))),
                Condvar::new(),
            )),
            catch_up_timestamp_us: Arc::new(AtomicI64::new(-1)),
            source_paced,
            error: Arc::new(Mutex::new(None)),
            decoded_frames: Arc::new(AtomicU64::new(0)),
            dropped_frames: Arc::new(AtomicU64::new(0)),
            skipped_frames: Arc::new(AtomicU64::new(0)),
            frame_buffer_allocations: Arc::new(AtomicU64::new(0)),
            frame_buffer_reuses: Arc::new(AtomicU64::new(0)),
            backend: Arc::new(Mutex::new("test".to_string())),
            stderr_workers: Arc::new(Mutex::new(Vec::new())),
            delivery_path: Arc::new(Mutex::new("cpu-nv12".to_string())),
            gpu_frame_copies: Arc::new(AtomicU64::new(0)),
            presentation_surface_drops: Arc::new(AtomicU64::new(0)),
            session_id: Arc::new(AtomicI64::new(1)),
            shared_frames: Arc::new(Mutex::new(VecDeque::new())),
            #[cfg(all(feature = "native-ffmpeg", target_os = "windows"))]
            shared_pool: Arc::new(Mutex::new(None)),
        }
    }

    fn request(fps: f64, start_time: f64) -> FfmpegRequest {
        FfmpegRequest {
            ffmpeg_path: "ffmpeg".to_string(),
            source: "video.mp4".to_string(),
            vaapi_device: "/dev/dri/test".to_string(),
            width: 1280,
            height: 720,
            fps,
            start_time,
            end_time: None,
            input_args: Vec::new(),
            output_args: Vec::new(),
            looped: false,
        }
    }
}
