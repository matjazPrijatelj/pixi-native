#![deny(clippy::all)]

use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Read};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

use napi::bindgen_prelude::*;
use napi_derive::napi;

const FRAME_QUEUE_CAPACITY: usize = 4;

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
}

#[napi(object)]
pub struct VideoFrame {
    pub width: i64,
    pub height: i64,
    pub timestamp_us: i64,
    pub data: Buffer,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DecoderBackend {
    D3d11va,
    Vaapi,
    Cpu,
}

impl DecoderBackend {
    fn name(self) -> &'static str {
        match self {
            Self::D3d11va => "D3D11VA",
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
    backend: Arc<Mutex<String>>,
}

struct PendingFrame {
    timestamp_us: i64,
    data: Vec<u8>,
}

#[derive(Default)]
struct FrameQueue {
    frames: VecDeque<PendingFrame>,
}

impl FrameQueue {
    fn push_latest(&mut self, frame: PendingFrame) -> Option<Vec<u8>> {
        let recycled = if self.frames.len() >= FRAME_QUEUE_CAPACITY {
            self.frames.pop_front().map(|dropped| dropped.data)
        } else {
            None
        };
        self.frames.push_back(frame);
        recycled
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
        self.frames.clear();
        (latest, skipped)
    }

    fn len(&self) -> usize {
        self.frames.len()
    }

    fn clear(&mut self) {
        self.frames.clear();
    }
}

struct SpawnedFfmpeg {
    child: Child,
    stdout: ChildStdout,
}

#[derive(Clone)]
struct FfmpegRequest {
    ffmpeg_path: String,
    source: String,
    vaapi_device: String,
    width: usize,
    height: usize,
    fps: f64,
    start_time: f64,
    end_time: Option<f64>,
    input_args: Vec<String>,
    output_args: Vec<String>,
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
        validate_options(&options)?;
        let source_paced = options.source_paced.unwrap_or(false);

        let backend = DecoderBackend::hardware()
            .map(DecoderBackend::name)
            .unwrap_or("CPU")
            .to_string();

        Ok(Self {
            options,
            state: DecoderState {
                closed: Arc::new(AtomicBool::new(true)),
                finished: Arc::new(AtomicBool::new(false)),
                child: Arc::new(Mutex::new(None)),
                frames: Arc::new((Mutex::new(FrameQueue::default()), Condvar::new())),
                catch_up_timestamp_us: Arc::new(AtomicI64::new(-1)),
                source_paced,
                error: Arc::new(Mutex::new(None)),
                decoded_frames: Arc::new(AtomicU64::new(0)),
                dropped_frames: Arc::new(AtomicU64::new(0)),
                skipped_frames: Arc::new(AtomicU64::new(0)),
                backend: Arc::new(Mutex::new(backend)),
            },
        })
    }

    #[napi]
    pub fn open(&mut self, source: String) -> Result<()> {
        if !self.state.closed.swap(false, Ordering::SeqCst) {
            return Err(Error::from_reason("Video decoder is already open"));
        }

        self.state.finished.store(false, Ordering::SeqCst);
        self.state.decoded_frames.store(0, Ordering::SeqCst);
        self.state.dropped_frames.store(0, Ordering::SeqCst);
        self.state.skipped_frames.store(0, Ordering::SeqCst);

        if let Ok(mut error) = self.state.error.lock() {
            *error = None;
        }
        let (frames, _) = &*self.state.frames;
        if let Ok(mut frames) = frames.lock() {
            frames.clear();
        }
        self.state.catch_up_timestamp_us.store(-1, Ordering::SeqCst);

        let width = usize::try_from(self.options.width)
            .map_err(|_| Error::from_reason("Invalid video width"))?;
        let height = usize::try_from(self.options.height)
            .map_err(|_| Error::from_reason("Invalid video height"))?;
        let fps = self.options.fps.unwrap_or(30.0);
        let start_time = self.options.start_time.unwrap_or(0.0);
        let ffmpeg_path = self
            .options
            .ffmpeg_path
            .clone()
            .unwrap_or_else(|| "ffmpeg".to_string());
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
            vaapi_device,
            width,
            height,
            fps,
            start_time,
            end_time: self.options.end_time,
            input_args: self.options.input_args.clone().unwrap_or_default(),
            output_args: self.options.output_args.clone().unwrap_or_default(),
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

        thread::spawn(move || {
            let result =
                consume_ffmpeg_output(initial_stdout, width, height, fps, start_time, &state);

            if let Err(error) = result {
                let has_frames = state.decoded_frames.load(Ordering::SeqCst) > 0;
                if active_backend != DecoderBackend::Cpu
                    && !has_frames
                    && !state.closed.load(Ordering::SeqCst)
                {
                    eprintln!(
                        "FFmpeg {} decoder failed; retrying with CPU decoder: {error}",
                        active_backend.name()
                    );
                    set_backend_name(&state, "CPU fallback");

                    let fallback_result = spawn_ffmpeg(&request, DecoderBackend::Cpu)
                        .and_then(|spawned| install_child(&state, spawned))
                        .and_then(|stdout| {
                            consume_ffmpeg_output(stdout, width, height, fps, start_time, &state)
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
        });

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
    pub fn queued_frames(&self) -> i64 {
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
            frames.clear();
            self.state
                .skipped_frames
                .fetch_add(skipped as u64, Ordering::SeqCst);
        }
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
    pub fn is_finished(&self) -> bool {
        self.state.finished.load(Ordering::SeqCst)
    }

    #[napi]
    pub fn close(&mut self) {
        close_state(&self.state);
    }
}

impl Drop for NativeVideoDecoder {
    fn drop(&mut self) {
        close_state(&self.state);
    }
}

fn validate_options(options: &DecoderOptions) -> Result<()> {
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
        DecoderBackend::D3d11va => {
            args.extend(["-hwaccel".to_string(), "d3d11va".to_string()]);
        }
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
    args.extend(["-i".to_string(), request.source.clone(), "-an".to_string()]);
    if let Some(end_time) = request.end_time {
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
    let filter = if backend == DecoderBackend::Vaapi {
        format!("hwdownload,format=nv12,{scale}")
    } else {
        scale
    };

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
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(|line| line.ok()) {
                eprintln!("{}", redact_url_credentials(&line));
            }
        });
    }
    Ok(SpawnedFfmpeg { child, stdout })
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

fn install_child(state: &DecoderState, spawned: SpawnedFfmpeg) -> io::Result<ChildStdout> {
    *state
        .child
        .lock()
        .map_err(|_| io::Error::other("FFmpeg process lock poisoned"))? = Some(spawned.child);
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
    let mut data = vec![0_u8; frame_bytes];
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

                data = enqueue_frame(PendingFrame { timestamp_us, data }, frame_bytes, state)?;
            }
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break Ok(()),
            Err(error) => break Err(error),
        }
    };

    let status = state
        .child
        .lock()
        .map_err(|_| io::Error::other("FFmpeg process lock poisoned"))?
        .take()
        .map(|mut process| process.wait())
        .transpose()?;

    read_result?;
    if !state.closed.load(Ordering::SeqCst) && status.is_some_and(|status| !status.success()) {
        return Err(io::Error::other(format!(
            "FFmpeg exited with status {}",
            status.expect("status checked above")
        )));
    }
    Ok(())
}

fn enqueue_frame(
    frame: PendingFrame,
    frame_bytes: usize,
    state: &DecoderState,
) -> io::Result<Vec<u8>> {
    let catch_up_timestamp_us = state.catch_up_timestamp_us.load(Ordering::SeqCst);
    if catch_up_timestamp_us >= 0 && frame.timestamp_us < catch_up_timestamp_us {
        state.skipped_frames.fetch_add(1, Ordering::SeqCst);
        return Ok(frame.data);
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
            return Ok(recycled);
        }
    } else {
        while frames.len() >= FRAME_QUEUE_CAPACITY
            && !state.closed.load(Ordering::SeqCst)
            && state.catch_up_timestamp_us.load(Ordering::SeqCst) < 0
        {
            frames = available
                .wait(frames)
                .map_err(|_| io::Error::other("Video frame queue lock poisoned"))?;
        }
        if state.closed.load(Ordering::SeqCst) {
            return Ok(frame.data);
        }
        let target = state.catch_up_timestamp_us.load(Ordering::SeqCst);
        if target >= 0 && frame.timestamp_us < target {
            state.skipped_frames.fetch_add(1, Ordering::SeqCst);
            return Ok(frame.data);
        }
        if target >= 0 {
            state.catch_up_timestamp_us.store(-1, Ordering::SeqCst);
        }
        frames.push_back(frame);
    }

    Ok(vec![0_u8; frame_bytes])
}

fn set_backend_name(state: &DecoderState, name: &str) {
    if let Ok(mut backend) = state.backend.lock() {
        *backend = name.to_string();
    }
}

fn store_error(state: &DecoderState, message: String) {
    eprintln!("FFmpeg decoder failed: {message}");
    if let Ok(mut error) = state.error.lock() {
        *error = Some(message);
    }
}

fn close_state(state: &DecoderState) {
    state.closed.store(true, Ordering::SeqCst);
    let (frames, available) = &*state.frames;
    available.notify_all();
    if let Ok(mut child) = state.child.lock() {
        if let Some(mut process) = child.take() {
            let _ = process.kill();
        }
    }
    if let Ok(mut frames) = frames.lock() {
        frames.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn calculates_nv12_frame_size() {
        assert_eq!(nv12_frame_bytes(1280, 720).unwrap(), 1_382_400);
        assert_eq!(nv12_frame_bytes(1920, 1080).unwrap(), 3_110_400);
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
        });
        assert!(result.is_err());
    }

    #[test]
    fn frame_queue_preserves_order_and_drops_oldest_on_overflow() {
        let mut queue = FrameQueue::default();
        for timestamp_us in 0..FRAME_QUEUE_CAPACITY as i64 {
            assert!(queue.push_latest(pending(timestamp_us)).is_none());
        }

        let recycled = queue
            .push_latest(pending(FRAME_QUEUE_CAPACITY as i64))
            .expect("oldest frame should be recycled");
        assert_eq!(recycled, vec![0]);
        assert_eq!(queue.len(), FRAME_QUEUE_CAPACITY);
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
    fn file_queue_applies_backpressure_until_a_frame_is_consumed() {
        let state = decoder_state(false);
        for timestamp_us in 0..FRAME_QUEUE_CAPACITY as i64 {
            enqueue_frame(pending(timestamp_us), 1, &state).unwrap();
        }

        let producer_state = state.clone();
        let (sent, received) = mpsc::channel();
        thread::spawn(move || {
            let result = enqueue_frame(pending(99), 1, &producer_state);
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

        assert_eq!(enqueue_frame(pending(10), 1, &state).unwrap(), vec![10]);
        assert_eq!(enqueue_frame(pending(20), 1, &state).unwrap(), vec![20]);
        enqueue_frame(pending(30), 1, &state).unwrap();

        assert_eq!(state.skipped_frames.load(Ordering::SeqCst), 2);
        let (frames, _) = &*state.frames;
        let mut frames = frames.lock().unwrap();
        assert_eq!(frames.pop_next().unwrap().timestamp_us, 30);
    }

    fn pending(timestamp_us: i64) -> PendingFrame {
        PendingFrame {
            timestamp_us,
            data: vec![timestamp_us as u8],
        }
    }

    fn decoder_state(source_paced: bool) -> DecoderState {
        DecoderState {
            closed: Arc::new(AtomicBool::new(false)),
            finished: Arc::new(AtomicBool::new(false)),
            child: Arc::new(Mutex::new(None)),
            frames: Arc::new((Mutex::new(FrameQueue::default()), Condvar::new())),
            catch_up_timestamp_us: Arc::new(AtomicI64::new(-1)),
            source_paced,
            error: Arc::new(Mutex::new(None)),
            decoded_frames: Arc::new(AtomicU64::new(0)),
            dropped_frames: Arc::new(AtomicU64::new(0)),
            skipped_frames: Arc::new(AtomicU64::new(0)),
            backend: Arc::new(Mutex::new("test".to_string())),
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
        }
    }
}
