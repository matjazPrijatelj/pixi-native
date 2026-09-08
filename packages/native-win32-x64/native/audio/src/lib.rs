#![deny(clippy::all)]

use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, Stream};
use crossbeam_queue::{ArrayQueue, SegQueue};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

const CHANNELS: usize = 2;
const STREAM_CHUNK_FRAMES: usize = 2048;
const STREAM_CHUNK_SAMPLES: usize = STREAM_CHUNK_FRAMES * CHANNELS;
const STREAM_START_CHUNKS: usize = 4;
const STREAM_BUFFER_SECONDS: usize = 2;
type EventNotifier = ThreadsafeFunction<(), (), (), Status, false, true, 1>;

#[napi(object)]
#[derive(Clone)]
pub struct NativeVoiceOptions {
    pub owner_id: u32,
    pub id: u32,
    pub source: String,
    pub ffmpeg_path: String,
    pub offset_seconds: f64,
    pub duration_seconds: Option<f64>,
    pub volume: f64,
    pub muted: bool,
    pub loop_: bool,
    pub streaming: bool,
    pub playback_rate: f64,
    pub input_args: Vec<String>,
    pub output_args: Vec<String>,
}

#[napi(object)]
pub struct NativeCommandOptions {
    pub owner_id: u32,
    pub command: String,
    pub id: Option<u32>,
    pub value: Option<f64>,
    pub bool_value: Option<bool>,
    pub from: Option<f64>,
    pub to: Option<f64>,
    pub duration_ms: Option<f64>,
    pub fade_version: Option<u32>,
}

#[napi(object)]
pub struct NativeAudioEvent {
    pub owner_id: u32,
    pub event: String,
    pub id: Option<u32>,
    pub message: Option<String>,
}

#[napi(object)]
pub struct NativeAudioDiagnostics {
    pub active_voices: u32,
    pub queued_ms: f64,
    pub underruns: u32,
}

struct QueuedEvent {
    owner_id: u32,
    event: &'static str,
    id: Option<u32>,
    message: Option<String>,
    target_frame: u64,
    sequence: u64,
    fade_version: Option<u32>,
}

struct Fade {
    from: f32,
    to: f32,
    start_frame: u64,
    duration_frames: u64,
    version: u32,
}

enum VoiceSource {
    Loading,
    Static(Arc<Vec<f32>>),
    Streaming {
        buffer: Arc<StreamingBuffer>,
        chunk: Option<Box<[f32]>>,
        offset: usize,
    },
}

struct VoiceSnapshot {
    owner_id: u32,
    time_bits: AtomicU64,
    volume_bits: AtomicU32,
    playing: AtomicBool,
    stream: Option<Arc<StreamingBuffer>>,
    current_chunk_samples: AtomicUsize,
}

struct Voice {
    owner_id: u32,
    id: u32,
    source: VoiceSource,
    offset_seconds: f64,
    position_frames: f64,
    rendered_frames: u64,
    volume: f32,
    muted: bool,
    looped: bool,
    playing: bool,
    playback_rate: f64,
    fade: Option<Fade>,
    play_announced: bool,
    finished: bool,
    snapshot: Arc<VoiceSnapshot>,
}

struct StreamingBuffer {
    chunks: ArrayQueue<Box<[f32]>>,
    queued_samples: AtomicUsize,
    produced_chunks: AtomicUsize,
    ready: AtomicBool,
    ended: AtomicBool,
    stopped: AtomicBool,
    producer_waiting: AtomicBool,
    producer_thread: OnceLock<thread::Thread>,
    child: Mutex<Option<Child>>,
}

impl StreamingBuffer {
    fn new(sample_rate: u32) -> Self {
        let capacity = (sample_rate as usize * STREAM_BUFFER_SECONDS).div_ceil(STREAM_CHUNK_FRAMES);
        Self {
            chunks: ArrayQueue::new(capacity),
            queued_samples: AtomicUsize::new(0),
            produced_chunks: AtomicUsize::new(0),
            ready: AtomicBool::new(false),
            ended: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            producer_waiting: AtomicBool::new(false),
            producer_thread: OnceLock::new(),
            child: Mutex::new(None),
        }
    }

    fn push(&self, mut chunk: Box<[f32]>) -> bool {
        let _ = self.producer_thread.set(thread::current());
        loop {
            if self.stopped.load(Ordering::Acquire) {
                return false;
            }
            match self.chunks.push(chunk) {
                Ok(()) => {
                    self.queued_samples
                        .fetch_add(STREAM_CHUNK_SAMPLES, Ordering::Release);
                    self.produced_chunks.fetch_add(1, Ordering::Relaxed);
                    if self.chunks.len() >= STREAM_START_CHUNKS {
                        self.ready.store(true, Ordering::Release);
                    }
                    return true;
                }
                Err(returned) => {
                    chunk = returned;
                    self.producer_waiting.store(true, Ordering::Release);
                    if self.chunks.is_full() {
                        thread::park();
                    }
                    self.producer_waiting.store(false, Ordering::Release);
                }
            }
        }
    }

    fn pop(&self) -> Option<Box<[f32]>> {
        let chunk = self.chunks.pop()?;
        self.queued_samples
            .fetch_sub(chunk.len(), Ordering::Release);
        if self.producer_waiting.swap(false, Ordering::AcqRel) {
            if let Some(producer) = self.producer_thread.get() {
                producer.unpark();
            }
        }
        Some(chunk)
    }

    fn queued_samples(&self) -> usize {
        self.queued_samples.load(Ordering::Acquire)
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Some(producer) = self.producer_thread.get() {
            producer.unpark();
        }
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
    }
}

enum MixerCommand {
    AddVoice(Voice),
    AttachStatic { id: u32, samples: Arc<Vec<f32>> },
    Control(NativeCommandOptions),
    RemoveOwner(u32),
    StopAll,
}

#[derive(Default)]
struct Mixer {
    voices: BTreeMap<u32, Voice>,
}

struct SharedState {
    sample_rate: u32,
    output_channels: usize,
    commands: SegQueue<MixerCommand>,
    snapshots: Mutex<HashMap<u32, Arc<VoiceSnapshot>>>,
    completed_voices: SegQueue<u32>,
    cache: Mutex<HashMap<String, Arc<Vec<f32>>>>,
    events: SegQueue<QueuedEvent>,
    event_notifier: Option<Arc<EventNotifier>>,
    event_sequence: AtomicU64,
    audible_frame: AtomicU64,
    global_volume_bits: AtomicU32,
    global_muted: AtomicBool,
    fade_versions: Mutex<HashMap<u32, u32>>,
    underruns: AtomicU32,
    shutdown: AtomicBool,
}

impl SharedState {
    fn queue_event(
        &self,
        owner_id: u32,
        event: &'static str,
        id: Option<u32>,
        message: Option<String>,
        fade_version: Option<u32>,
    ) {
        self.events.push(QueuedEvent {
            owner_id,
            event,
            id,
            message,
            target_frame: self.audible_frame.load(Ordering::Acquire),
            sequence: self.event_sequence.fetch_add(1, Ordering::Relaxed),
            fade_version,
        });
        if let Some(notifier) = &self.event_notifier {
            notifier.call((), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }

    fn stop_snapshot(snapshot: &VoiceSnapshot) {
        if let Some(stream) = &snapshot.stream {
            stream.stop();
        }
        snapshot.playing.store(false, Ordering::Release);
    }
}

#[napi]
pub struct NativeAudioEngine {
    state: Arc<SharedState>,
    stream: Mutex<Option<Stream>>,
}

#[napi]
impl NativeAudioEngine {
    #[napi(constructor)]
    pub fn new(event_notifier: EventNotifier) -> Result<Self> {
        let host = cpal::default_host();
        let device = host.default_output_device().ok_or_else(|| {
            Error::from_reason("Windows has no default WASAPI audio output device")
        })?;
        let supported = device
            .default_output_config()
            .map_err(|error| Error::from_reason(format!("Cannot query WASAPI output: {error}")))?;
        let sample_format = supported.sample_format();
        let config = supported.config();
        let state = Arc::new(SharedState {
            sample_rate: config.sample_rate.0,
            output_channels: config.channels as usize,
            commands: SegQueue::new(),
            snapshots: Mutex::new(HashMap::new()),
            completed_voices: SegQueue::new(),
            cache: Mutex::new(HashMap::new()),
            events: SegQueue::new(),
            event_notifier: Some(Arc::new(event_notifier)),
            event_sequence: AtomicU64::new(0),
            audible_frame: AtomicU64::new(0),
            global_volume_bits: AtomicU32::new(1.0_f32.to_bits()),
            global_muted: AtomicBool::new(false),
            fade_versions: Mutex::new(HashMap::new()),
            underruns: AtomicU32::new(0),
            shutdown: AtomicBool::new(false),
        });
        let stream_state = Arc::clone(&state);
        let error_state = Arc::clone(&state);
        let error_callback = move |error: cpal::StreamError| {
            error_state.queue_event(0, "playerror", None, Some(error.to_string()), None);
        };
        let stream = match sample_format {
            SampleFormat::F32 => {
                build_stream::<f32>(&device, &config, stream_state, error_callback)
            }
            SampleFormat::I16 => {
                build_stream::<i16>(&device, &config, stream_state, error_callback)
            }
            SampleFormat::U16 => {
                build_stream::<u16>(&device, &config, stream_state, error_callback)
            }
            format => Err(Error::from_reason(format!(
                "Unsupported WASAPI sample format: {format:?}"
            ))),
        }?;
        stream
            .play()
            .map_err(|error| Error::from_reason(format!("Cannot start WASAPI output: {error}")))?;
        Ok(Self {
            state,
            stream: Mutex::new(Some(stream)),
        })
    }

    #[napi]
    pub fn create_voice(&self, options: NativeVoiceOptions) -> Result<()> {
        validate_voice_options(&options)?;
        let id = options.id;
        let owner_id = options.owner_id;
        let stream = options
            .streaming
            .then(|| Arc::new(StreamingBuffer::new(self.state.sample_rate)));
        let snapshot = Arc::new(VoiceSnapshot {
            owner_id,
            time_bits: AtomicU64::new(options.offset_seconds.to_bits()),
            volume_bits: AtomicU32::new((options.volume as f32).to_bits()),
            playing: AtomicBool::new(true),
            stream: stream.clone(),
            current_chunk_samples: AtomicUsize::new(0),
        });
        let voice = Voice {
            owner_id,
            id,
            source: stream
                .as_ref()
                .map_or(VoiceSource::Loading, |buffer| VoiceSource::Streaming {
                    buffer: Arc::clone(buffer),
                    chunk: None,
                    offset: 0,
                }),
            offset_seconds: options.offset_seconds,
            position_frames: 0.0,
            rendered_frames: 0,
            volume: options.volume as f32,
            muted: options.muted,
            looped: options.loop_ && !options.streaming,
            playing: true,
            playback_rate: options.playback_rate,
            fade: None,
            play_announced: false,
            finished: false,
            snapshot: Arc::clone(&snapshot),
        };
        self.state
            .snapshots
            .lock()
            .map_err(|_| Error::from_reason("Audio mixer state is poisoned"))?
            .insert(id, snapshot);
        self.state.commands.push(MixerCommand::AddVoice(voice));

        if let Some(stream) = stream {
            start_streaming_decode(Arc::clone(&self.state), options, stream);
        } else {
            start_static_decode(Arc::clone(&self.state), options, false, None);
        }
        Ok(())
    }

    #[napi]
    pub fn preload(
        &self,
        owner_id: u32,
        request_id: u32,
        source: String,
        ffmpeg_path: String,
        offset_seconds: f64,
        duration_seconds: Option<f64>,
    ) -> Result<()> {
        if offset_seconds < 0.0 || duration_seconds.is_some_and(|value| value <= 0.0) {
            return Err(Error::from_reason("Invalid audio preload range"));
        }
        start_static_decode(
            Arc::clone(&self.state),
            NativeVoiceOptions {
                owner_id,
                id: 0,
                source,
                ffmpeg_path,
                offset_seconds,
                duration_seconds,
                volume: 1.0,
                muted: false,
                loop_: false,
                streaming: false,
                playback_rate: 1.0,
                input_args: Vec::new(),
                output_args: Vec::new(),
            },
            true,
            Some(request_id),
        );
        Ok(())
    }

    #[napi]
    pub fn command(&self, options: NativeCommandOptions) -> Result<()> {
        match options.command.as_str() {
            "play" | "pause" | "mute" | "loop" | "stop" => {}
            "volume" => {
                required_unit_value(options.value, "volume")?;
            }
            "seek" => {
                let seconds = options.value.unwrap_or(0.0);
                if !seconds.is_finite() || seconds < 0.0 {
                    return Err(Error::from_reason(
                        "Audio seek must be non-negative and finite",
                    ));
                }
            }
            "fade" => {
                required_unit_value(options.from, "fade start")?;
                required_unit_value(options.to, "fade target")?;
                let duration_ms = options.duration_ms.unwrap_or(0.0);
                if !duration_ms.is_finite() || duration_ms < 0.0 {
                    return Err(Error::from_reason(
                        "Fade duration must be non-negative and finite",
                    ));
                }
                if let Some(id) = options.id {
                    if let Ok(mut versions) = self.state.fade_versions.lock() {
                        versions.insert(id, options.fade_version.unwrap_or(0));
                    }
                }
            }
            command => {
                return Err(Error::from_reason(format!(
                    "Unknown audio command: {command}"
                )))
            }
        }

        if options.command == "stop" {
            self.remove_snapshots(options.owner_id, options.id);
        }
        self.state.commands.push(MixerCommand::Control(options));
        Ok(())
    }

    #[napi]
    pub fn unload_owner(&self, owner_id: u32) {
        self.remove_snapshots(owner_id, None);
        self.state
            .commands
            .push(MixerCommand::RemoveOwner(owner_id));
    }

    #[napi]
    pub fn current_time(&self, id: u32) -> Option<f64> {
        let snapshot = self.state.snapshots.lock().ok()?.get(&id).cloned()?;
        Some(f64::from_bits(snapshot.time_bits.load(Ordering::Acquire)))
    }

    #[napi]
    pub fn current_volume(&self, id: u32) -> Option<f64> {
        let snapshot = self.state.snapshots.lock().ok()?.get(&id).cloned()?;
        Some(f32::from_bits(snapshot.volume_bits.load(Ordering::Acquire)) as f64)
    }

    #[napi]
    pub fn set_global_volume(&self, value: f64) -> Result<()> {
        let value = required_unit_value(Some(value), "global volume")? as f32;
        self.state
            .global_volume_bits
            .store(value.to_bits(), Ordering::Release);
        Ok(())
    }

    #[napi]
    pub fn set_global_muted(&self, value: bool) {
        self.state.global_muted.store(value, Ordering::Release);
    }

    #[napi]
    pub fn drain_events(&self) -> Vec<NativeAudioEvent> {
        if let Ok(mut snapshots) = self.state.snapshots.lock() {
            while let Some(id) = self.state.completed_voices.pop() {
                snapshots.remove(&id);
            }
        }
        let mut queued = Vec::new();
        while let Some(event) = self.state.events.pop() {
            queued.push(event);
        }
        queued.sort_by_key(|event| (event.target_frame, event.sequence));
        let fade_versions = self.state.fade_versions.lock().ok();
        queued
            .into_iter()
            .filter(|event| {
                let Some(version) = event.fade_version else {
                    return true;
                };
                event.id.is_some_and(|id| {
                    fade_versions
                        .as_ref()
                        .and_then(|versions| versions.get(&id))
                        .is_some_and(|current| *current == version)
                })
            })
            .map(|event| NativeAudioEvent {
                owner_id: event.owner_id,
                event: event.event.to_string(),
                id: event.id,
                message: event.message,
            })
            .collect()
    }

    #[napi]
    pub fn diagnostics(&self) -> NativeAudioDiagnostics {
        let (active_voices, queued_samples) = self
            .state
            .snapshots
            .lock()
            .map(|snapshots| {
                let active = snapshots
                    .values()
                    .filter(|snapshot| snapshot.playing.load(Ordering::Acquire))
                    .count() as u32;
                let queued = snapshots
                    .values()
                    .map(|snapshot| {
                        snapshot
                            .stream
                            .as_ref()
                            .map_or(0, |stream| stream.queued_samples())
                            + snapshot.current_chunk_samples.load(Ordering::Acquire)
                    })
                    .sum::<usize>();
                (active, queued)
            })
            .unwrap_or((0, 0));
        NativeAudioDiagnostics {
            active_voices,
            queued_ms: queued_samples as f64 * 1000.0
                / (self.state.sample_rate as f64 * CHANNELS as f64),
            underruns: self.state.underruns.load(Ordering::Relaxed),
        }
    }

    #[napi]
    pub fn stop_all(&self) {
        if let Ok(mut snapshots) = self.state.snapshots.lock() {
            for snapshot in snapshots.values() {
                SharedState::stop_snapshot(snapshot);
            }
            snapshots.clear();
        }
        self.state.commands.push(MixerCommand::StopAll);
    }

    #[napi]
    pub fn shutdown(&self) {
        self.state.shutdown.store(true, Ordering::Release);
        self.stop_all();
        if let Ok(mut stream) = self.stream.lock() {
            stream.take();
        }
        if let Ok(mut cache) = self.state.cache.lock() {
            cache.clear();
        }
    }

    fn remove_snapshots(&self, owner_id: u32, id: Option<u32>) {
        if let Ok(mut snapshots) = self.state.snapshots.lock() {
            let ids: Vec<u32> = snapshots
                .iter()
                .filter(|(voice_id, snapshot)| {
                    snapshot.owner_id == owner_id && id.is_none_or(|id| id == **voice_id)
                })
                .map(|(id, _)| *id)
                .collect();
            for id in ids {
                if let Some(snapshot) = snapshots.remove(&id) {
                    SharedState::stop_snapshot(&snapshot);
                }
            }
        }
    }
}

impl Drop for NativeAudioEngine {
    fn drop(&mut self) {
        self.state.shutdown.store(true, Ordering::Release);
        if let Ok(snapshots) = self.state.snapshots.lock() {
            for snapshot in snapshots.values() {
                SharedState::stop_snapshot(snapshot);
            }
        }
    }
}

impl Mixer {
    fn apply_commands(&mut self, state: &SharedState) {
        while let Some(command) = state.commands.pop() {
            match command {
                MixerCommand::AddVoice(voice) => {
                    self.voices.insert(voice.id, voice);
                }
                MixerCommand::AttachStatic { id, samples } => {
                    if let Some(voice) = self.voices.get_mut(&id) {
                        voice.source = VoiceSource::Static(samples);
                        voice.play_announced = true;
                        state.queue_event(voice.owner_id, "play", Some(id), None, None);
                    }
                }
                MixerCommand::Control(options) => self.apply_control(state, options),
                MixerCommand::RemoveOwner(owner_id) => {
                    self.voices.retain(|_, voice| voice.owner_id != owner_id);
                }
                MixerCommand::StopAll => {
                    self.voices.clear();
                }
            }
        }
    }

    fn apply_control(&mut self, state: &SharedState, options: NativeCommandOptions) {
        if options.command == "stop" {
            self.voices.retain(|id, voice| {
                let matches = voice.owner_id == options.owner_id
                    && options.id.is_none_or(|requested| requested == *id);
                if matches {
                    state.queue_event(voice.owner_id, "stop", Some(*id), None, None);
                }
                !matches
            });
            return;
        }

        for (id, voice) in &mut self.voices {
            if voice.owner_id != options.owner_id
                || options.id.is_some_and(|requested| requested != *id)
            {
                continue;
            }
            Self::apply_voice_control(state, *id, voice, &options);
        }
    }

    fn apply_voice_control(
        state: &SharedState,
        id: u32,
        voice: &mut Voice,
        options: &NativeCommandOptions,
    ) {
        match options.command.as_str() {
            "play" => {
                voice.playing = true;
                voice.snapshot.playing.store(true, Ordering::Release);
                state.queue_event(voice.owner_id, "play", Some(id), None, None);
            }
            "pause" => {
                voice.playing = false;
                voice.snapshot.playing.store(false, Ordering::Release);
                state.queue_event(voice.owner_id, "pause", Some(id), None, None);
            }
            "volume" => {
                voice.volume = options.value.unwrap_or(1.0) as f32;
                voice.fade = None;
                voice
                    .snapshot
                    .volume_bits
                    .store(voice.volume.to_bits(), Ordering::Release);
                state.queue_event(voice.owner_id, "volume", Some(id), None, None);
            }
            "mute" => {
                voice.muted = options.bool_value.unwrap_or(false);
                state.queue_event(voice.owner_id, "mute", Some(id), None, None);
            }
            "loop" => voice.looped = options.bool_value.unwrap_or(false),
            "seek" => {
                let seconds = options.value.unwrap_or(0.0);
                voice.position_frames = seconds * state.sample_rate as f64;
                voice.rendered_frames = (seconds * state.sample_rate as f64) as u64;
                voice.fade = None;
                state.queue_event(voice.owner_id, "seek", Some(id), None, None);
            }
            "fade" => {
                voice.fade = Some(Fade {
                    from: voice.volume,
                    to: options.to.unwrap_or(1.0) as f32,
                    start_frame: voice.rendered_frames,
                    duration_frames: (options.duration_ms.unwrap_or(0.0) * state.sample_rate as f64
                        / 1000.0) as u64,
                    version: options.fade_version.unwrap_or(0),
                });
            }
            _ => {}
        }
    }
}

enum VoiceFrame {
    Sample(f32, f32, bool),
    Pending,
    Starved,
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    state: Arc<SharedState>,
    error_callback: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<Stream>
where
    T: SizedSample + FromSample<f32>,
{
    let mut mixer = Mixer::default();
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _| render_output(output, &state, &mut mixer),
            error_callback,
            None,
        )
        .map_err(|error| Error::from_reason(format!("Cannot open WASAPI output: {error}")))
}

fn render_output<T>(output: &mut [T], state: &SharedState, mixer: &mut Mixer)
where
    T: SizedSample + FromSample<f32>,
{
    let channels = state.output_channels;
    if state.shutdown.load(Ordering::Acquire) {
        output.fill(T::from_sample(0.0));
        return;
    }
    mixer.apply_commands(state);
    let global_volume = f32::from_bits(state.global_volume_bits.load(Ordering::Acquire));
    let global_muted = state.global_muted.load(Ordering::Acquire);
    let mut starved = false;

    for frame in output.chunks_mut(channels) {
        let mut left = 0.0_f32;
        let mut right = 0.0_f32;
        for voice in mixer.voices.values_mut() {
            if !voice.playing {
                continue;
            }
            if !voice.play_announced
                && matches!(
                    &voice.source,
                    VoiceSource::Streaming { buffer, .. }
                        if buffer.ready.load(Ordering::Acquire)
                )
            {
                voice.play_announced = true;
                state.queue_event(voice.owner_id, "play", Some(voice.id), None, None);
            }
            let (voice_left, voice_right, source_finished) = match next_voice_frame(voice) {
                VoiceFrame::Sample(left, right, finished) => (left, right, finished),
                VoiceFrame::Pending => continue,
                VoiceFrame::Starved => {
                    starved = true;
                    continue;
                }
            };
            update_fade(voice, state);
            let gain = if global_muted || voice.muted {
                0.0
            } else {
                global_volume * voice.volume
            };
            left += voice_left * gain;
            right += voice_right * gain;
            voice.rendered_frames += 1;
            if source_finished {
                state.queue_event(voice.owner_id, "end", Some(voice.id), None, None);
                if voice.looped {
                    voice.position_frames = 0.0;
                } else {
                    voice.finished = true;
                }
            }
        }
        left = left.clamp(-1.0, 1.0);
        right = right.clamp(-1.0, 1.0);
        if let Some(sample) = frame.get_mut(0) {
            *sample = T::from_sample(left);
        }
        if let Some(sample) = frame.get_mut(1) {
            *sample = T::from_sample(right);
        }
        for sample in frame.iter_mut().skip(2) {
            *sample = T::from_sample((left + right) * 0.5);
        }
    }
    if starved {
        state.underruns.fetch_add(1, Ordering::Relaxed);
    }
    state
        .audible_frame
        .fetch_add((output.len() / channels) as u64, Ordering::Release);
    for voice in mixer.voices.values() {
        update_snapshot(voice, state.sample_rate);
    }
    mixer.voices.retain(|id, voice| {
        if voice.finished {
            voice.snapshot.playing.store(false, Ordering::Release);
            state.completed_voices.push(*id);
            false
        } else {
            true
        }
    });
}

fn next_voice_frame(voice: &mut Voice) -> VoiceFrame {
    match &mut voice.source {
        VoiceSource::Loading => VoiceFrame::Pending,
        VoiceSource::Static(samples) => {
            let frame_count = samples.len() / CHANNELS;
            if frame_count == 0 {
                return VoiceFrame::Sample(0.0, 0.0, true);
            }
            let index = voice.position_frames.floor() as usize;
            if index >= frame_count {
                return VoiceFrame::Sample(0.0, 0.0, true);
            }
            let left = samples[index * CHANNELS];
            let right = samples[index * CHANNELS + 1];
            voice.position_frames += voice.playback_rate;
            VoiceFrame::Sample(left, right, voice.position_frames >= frame_count as f64)
        }
        VoiceSource::Streaming {
            buffer,
            chunk,
            offset,
        } => {
            if !buffer.ready.load(Ordering::Acquire) {
                return VoiceFrame::Pending;
            }
            if chunk.is_none() {
                *chunk = buffer.pop();
                *offset = 0;
            }
            let Some(samples) = chunk.as_ref() else {
                return if buffer.ended.load(Ordering::Acquire) {
                    VoiceFrame::Sample(0.0, 0.0, true)
                } else {
                    VoiceFrame::Starved
                };
            };
            let left = samples[*offset];
            let right = samples[*offset + 1];
            *offset += CHANNELS;
            voice.position_frames += 1.0;
            if *offset >= samples.len() {
                *chunk = None;
                *offset = 0;
            }
            VoiceFrame::Sample(left, right, false)
        }
    }
}

fn update_snapshot(voice: &Voice, sample_rate: u32) {
    let media_rate = if matches!(voice.source, VoiceSource::Streaming { .. }) {
        voice.playback_rate
    } else {
        1.0
    };
    let time = voice.offset_seconds + voice.position_frames * media_rate / sample_rate as f64;
    voice
        .snapshot
        .time_bits
        .store(time.to_bits(), Ordering::Release);
    voice
        .snapshot
        .volume_bits
        .store(voice.volume.to_bits(), Ordering::Release);
    let remaining = match &voice.source {
        VoiceSource::Streaming { chunk, offset, .. } => chunk
            .as_ref()
            .map_or(0, |samples| samples.len().saturating_sub(*offset)),
        _ => 0,
    };
    voice
        .snapshot
        .current_chunk_samples
        .store(remaining, Ordering::Release);
}

fn update_fade(voice: &mut Voice, state: &SharedState) {
    let Some(fade) = &voice.fade else { return };
    let elapsed = voice.rendered_frames.saturating_sub(fade.start_frame) + 1;
    let progress = if fade.duration_frames == 0 {
        1.0
    } else {
        (elapsed as f32 / fade.duration_frames as f32).min(1.0)
    };
    voice.volume = fade.from + (fade.to - fade.from) * progress;
    if progress >= 1.0 {
        let version = fade.version;
        voice.fade = None;
        state.queue_event(voice.owner_id, "fade", Some(voice.id), None, Some(version));
    }
}

fn start_static_decode(
    state: Arc<SharedState>,
    options: NativeVoiceOptions,
    preload: bool,
    request_id: Option<u32>,
) {
    thread::spawn(move || {
        let key = cache_key(&options);
        let cached = state
            .cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(&key).cloned());
        let decoded = match cached {
            Some(samples) => Ok(samples),
            None => state
                .cache
                .lock()
                .ok()
                .and_then(|cache| cache.get(&full_source_cache_key(&options.source)).cloned())
                .map_or_else(
                    || decode_static(&options, state.sample_rate).map(Arc::new),
                    |samples| slice_cached_samples(&samples, &options, state.sample_rate),
                ),
        };
        match decoded {
            Ok(samples) => {
                if let Ok(mut cache) = state.cache.lock() {
                    cache.insert(key, Arc::clone(&samples));
                }
                if preload {
                    state.queue_event(options.owner_id, "load", request_id, None, None);
                } else {
                    state.commands.push(MixerCommand::AttachStatic {
                        id: options.id,
                        samples,
                    });
                }
            }
            Err(message) => {
                if !preload {
                    if let Ok(mut snapshots) = state.snapshots.lock() {
                        snapshots.remove(&options.id);
                    }
                    state
                        .commands
                        .push(MixerCommand::Control(NativeCommandOptions {
                            owner_id: options.owner_id,
                            command: "stop".to_string(),
                            id: Some(options.id),
                            value: None,
                            bool_value: None,
                            from: None,
                            to: None,
                            duration_ms: None,
                            fade_version: None,
                        }));
                }
                state.queue_event(
                    options.owner_id,
                    if preload { "loaderror" } else { "playerror" },
                    request_id.or(Some(options.id)),
                    Some(message),
                    None,
                );
            }
        }
    });
}

fn start_streaming_decode(
    state: Arc<SharedState>,
    options: NativeVoiceOptions,
    stream: Arc<StreamingBuffer>,
) {
    thread::spawn(move || {
        if let Err(message) = decode_stream(&state, &options, &stream) {
            if !stream.stopped.load(Ordering::Acquire) {
                if let Ok(mut snapshots) = state.snapshots.lock() {
                    snapshots.remove(&options.id);
                }
                state
                    .commands
                    .push(MixerCommand::Control(NativeCommandOptions {
                        owner_id: options.owner_id,
                        command: "stop".to_string(),
                        id: Some(options.id),
                        value: None,
                        bool_value: None,
                        from: None,
                        to: None,
                        duration_ms: None,
                        fade_version: None,
                    }));
                state.queue_event(
                    options.owner_id,
                    "playerror",
                    Some(options.id),
                    Some(message),
                    None,
                );
            }
        }
        stream.ended.store(true, Ordering::Release);
    });
}

fn decode_static(
    options: &NativeVoiceOptions,
    sample_rate: u32,
) -> std::result::Result<Vec<f32>, String> {
    let mut command = ffmpeg_command(options, sample_rate, false)?;
    let output = command
        .output()
        .map_err(|error| format!("Cannot start FFmpeg audio decoder: {error}"))?;
    if !output.status.success() {
        return Err(redact_credentials(
            String::from_utf8_lossy(&output.stderr).trim(),
        ));
    }
    bytes_to_samples(&output.stdout)
}

fn decode_stream(
    state: &SharedState,
    options: &NativeVoiceOptions,
    stream: &StreamingBuffer,
) -> std::result::Result<(), String> {
    let mut child = ffmpeg_command(options, state.sample_rate, true)?
        .spawn()
        .map_err(|error| format!("Cannot start FFmpeg audio stream: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "FFmpeg audio stdout is unavailable".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "FFmpeg audio stderr is unavailable".to_string())?;
    if let Ok(mut stored_child) = stream.child.lock() {
        *stored_child = Some(child);
    }
    let mut byte_carry = Vec::new();
    let mut sample_carry = Vec::new();
    let mut bytes = vec![0_u8; 32 * 1024];
    loop {
        if stream.stopped.load(Ordering::Acquire) || state.shutdown.load(Ordering::Acquire) {
            return Ok(());
        }
        let read = stdout.read(&mut bytes).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        byte_carry.extend_from_slice(&bytes[..read]);
        let aligned = byte_carry.len() - byte_carry.len() % 4;
        for chunk in byte_carry[..aligned].chunks_exact(4) {
            sample_carry.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        byte_carry.drain(..aligned);
        while sample_carry.len() >= STREAM_CHUNK_SAMPLES {
            let remainder = sample_carry.split_off(STREAM_CHUNK_SAMPLES);
            let chunk = std::mem::replace(&mut sample_carry, remainder).into_boxed_slice();
            if !stream.push(chunk) {
                return Ok(());
            }
        }
    }
    let mut child = stream
        .child
        .lock()
        .map_err(|_| "FFmpeg process state is poisoned".to_string())?
        .take()
        .ok_or_else(|| "FFmpeg process disappeared".to_string())?;
    let status = child.wait().map_err(|error| error.to_string())?;
    if !status.success() {
        let mut error = String::new();
        let _ = stderr.read_to_string(&mut error);
        return Err(redact_credentials(error.trim()));
    }
    if !sample_carry.is_empty() {
        sample_carry.resize(STREAM_CHUNK_SAMPLES, 0.0);
        if !stream.push(sample_carry.into_boxed_slice()) {
            return Ok(());
        }
    }
    if stream.produced_chunks.load(Ordering::Acquire) == 0 {
        return Err("Audio stream contains no decodable samples".to_string());
    }
    stream.ready.store(true, Ordering::Release);
    Ok(())
}

fn ffmpeg_command(
    options: &NativeVoiceOptions,
    sample_rate: u32,
    streaming: bool,
) -> std::result::Result<Command, String> {
    let mut command = Command::new(&options.ffmpeg_path);
    command.args(["-hide_banner", "-loglevel", "error", "-nostdin"]);
    if options.offset_seconds > 0.0 {
        command.args(["-ss", &options.offset_seconds.to_string()]);
    }
    command.args(&options.input_args);
    command.args(["-i", &options.source, "-vn"]);
    if let Some(duration) = options.duration_seconds {
        command.args(["-t", &duration.to_string()]);
    }
    if streaming && (options.playback_rate - 1.0).abs() > f64::EPSILON {
        command.args(["-af", &build_atempo_filter(options.playback_rate)?]);
    }
    command.args(&options.output_args);
    command.args([
        "-ac",
        "2",
        "-ar",
        &sample_rate.to_string(),
        "-f",
        "f32le",
        "pipe:1",
    ]);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    Ok(command)
}

fn build_atempo_filter(rate: f64) -> std::result::Result<String, String> {
    if !rate.is_finite() || rate <= 0.0 {
        return Err("Audio playback rate must be positive and finite".to_string());
    }
    let mut factors = Vec::new();
    let mut remaining = rate;
    while remaining < 0.5 {
        factors.push(0.5);
        remaining /= 0.5;
    }
    while remaining > 2.0 {
        factors.push(2.0);
        remaining /= 2.0;
    }
    factors.push(remaining);
    Ok(factors
        .into_iter()
        .map(|factor| format!("atempo={factor}"))
        .collect::<Vec<_>>()
        .join(","))
}

fn bytes_to_samples(bytes: &[u8]) -> std::result::Result<Vec<f32>, String> {
    if bytes.is_empty() {
        return Err("Audio stream contains no decodable samples".to_string());
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn cache_key(options: &NativeVoiceOptions) -> String {
    format!(
        "{}\0{}\0{}",
        options.source,
        options.offset_seconds,
        options
            .duration_seconds
            .map_or_else(|| "end".to_string(), |value| value.to_string())
    )
}

fn full_source_cache_key(source: &str) -> String {
    format!("{source}\0{}\0end", 0.0)
}

fn slice_cached_samples(
    samples: &[f32],
    options: &NativeVoiceOptions,
    sample_rate: u32,
) -> std::result::Result<Arc<Vec<f32>>, String> {
    let start = (options.offset_seconds * sample_rate as f64) as usize * CHANNELS;
    let requested = options
        .duration_seconds
        .map(|duration| (duration * sample_rate as f64) as usize * CHANNELS)
        .unwrap_or_else(|| samples.len().saturating_sub(start));
    let end = start.saturating_add(requested).min(samples.len());
    if start >= end {
        return Err("Audio sprite is outside the decoded source".to_string());
    }
    Ok(Arc::new(samples[start..end].to_vec()))
}

fn validate_voice_options(options: &NativeVoiceOptions) -> Result<()> {
    if !options.offset_seconds.is_finite() || options.offset_seconds < 0.0 {
        return Err(Error::from_reason(
            "Audio offset must be non-negative and finite",
        ));
    }
    if options
        .duration_seconds
        .is_some_and(|value| !value.is_finite() || value <= 0.0)
    {
        return Err(Error::from_reason(
            "Audio duration must be positive and finite",
        ));
    }
    required_unit_value(Some(options.volume), "volume")?;
    if !options.playback_rate.is_finite() || options.playback_rate <= 0.0 {
        return Err(Error::from_reason(
            "Audio playback rate must be positive and finite",
        ));
    }
    Ok(())
}

fn required_unit_value(value: Option<f64>, name: &str) -> Result<f64> {
    let value = value.ok_or_else(|| Error::from_reason(format!("Missing audio {name}")))?;
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        return Err(Error::from_reason(format!(
            "Audio {name} must be between 0 and 1"
        )));
    }
    Ok(value)
}

fn redact_credentials(message: &str) -> String {
    let mut result = message.to_string();
    let mut start = 0;
    while let Some(scheme) = result[start..].find("://") {
        let authority_start = start + scheme + 3;
        let authority_end = result[authority_start..]
            .find(['/', ' ', '\n', '\r'])
            .map_or(result.len(), |offset| authority_start + offset);
        if let Some(at) = result[authority_start..authority_end].find('@') {
            let credential_end = authority_start + at;
            result.replace_range(authority_start..credential_end, "***:***");
            start = authority_start + 8;
        } else {
            start = authority_end;
        }
    }
    if result.trim().is_empty() {
        "FFmpeg audio decoder failed".to_string()
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state() -> Arc<SharedState> {
        Arc::new(SharedState {
            sample_rate: 48_000,
            output_channels: 2,
            commands: SegQueue::new(),
            snapshots: Mutex::new(HashMap::new()),
            completed_voices: SegQueue::new(),
            cache: Mutex::new(HashMap::new()),
            events: SegQueue::new(),
            event_notifier: None,
            event_sequence: AtomicU64::new(0),
            audible_frame: AtomicU64::new(0),
            global_volume_bits: AtomicU32::new(1.0_f32.to_bits()),
            global_muted: AtomicBool::new(false),
            fade_versions: Mutex::new(HashMap::new()),
            underruns: AtomicU32::new(0),
            shutdown: AtomicBool::new(false),
        })
    }

    fn static_voice(id: u32, samples: Vec<f32>) -> Voice {
        let snapshot = Arc::new(VoiceSnapshot {
            owner_id: 1,
            time_bits: AtomicU64::new(0.0_f64.to_bits()),
            volume_bits: AtomicU32::new(1.0_f32.to_bits()),
            playing: AtomicBool::new(true),
            stream: None,
            current_chunk_samples: AtomicUsize::new(0),
        });
        Voice {
            owner_id: 1,
            id,
            source: VoiceSource::Static(Arc::new(samples)),
            offset_seconds: 0.0,
            position_frames: 0.0,
            rendered_frames: 0,
            volume: 1.0,
            muted: false,
            looped: false,
            playing: true,
            playback_rate: 1.0,
            fade: None,
            play_announced: true,
            finished: false,
            snapshot,
        }
    }

    #[test]
    fn atempo_decomposes_extreme_rates() {
        assert_eq!(build_atempo_filter(4.0).unwrap(), "atempo=2,atempo=2");
        assert_eq!(build_atempo_filter(0.25).unwrap(), "atempo=0.5,atempo=0.5");
    }

    #[test]
    fn bounded_stream_buffer_has_two_seconds_of_capacity() {
        let stream = StreamingBuffer::new(48_000);
        assert_eq!(stream.chunks.capacity(), 47);
    }

    #[test]
    fn overlapping_voices_are_mixed_without_clipping() {
        let state = test_state();
        let mut mixer = Mixer::default();
        mixer
            .voices
            .insert(1, static_voice(1, vec![0.25, 0.25, 0.0, 0.0]));
        mixer
            .voices
            .insert(2, static_voice(2, vec![0.5, -0.5, 0.0, 0.0]));

        let mut output = [0.0_f32; 2];
        render_output(&mut output, &state, &mut mixer);
        assert_eq!(output, [0.75, -0.25]);
    }

    #[test]
    fn looping_voice_emits_ordered_end_events_and_stays_active() {
        let state = test_state();
        let mut mixer = Mixer::default();
        let mut voice = static_voice(7, vec![0.1, 0.1]);
        voice.looped = true;
        mixer.voices.insert(7, voice);

        render_output(&mut [0.0_f32; 6], &state, &mut mixer);
        assert!(mixer.voices.contains_key(&7));
        let mut events = Vec::new();
        while let Some(event) = state.events.pop() {
            events.push((event.target_frame, event.sequence, event.event));
        }
        assert_eq!(events.len(), 3);
        assert!(events.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[test]
    fn fade_uses_rendered_sample_clock_and_fires_once() {
        let state = test_state();
        let mut mixer = Mixer::default();
        let mut voice = static_voice(3, vec![1.0; 16]);
        voice.fade = Some(Fade {
            from: 1.0,
            to: 0.0,
            start_frame: 0,
            duration_frames: 4,
            version: 9,
        });
        state.fade_versions.lock().unwrap().insert(3, 9);
        mixer.voices.insert(3, voice);

        render_output(&mut [0.0_f32; 8], &state, &mut mixer);
        assert_eq!(mixer.voices.get(&3).unwrap().volume, 0.0);
        assert_eq!(state.events.len(), 1);
    }

    #[test]
    fn streaming_underrun_outputs_silence_without_advancing_voice_clock() {
        let state = test_state();
        let mut mixer = Mixer::default();
        let stream = Arc::new(StreamingBuffer::new(48_000));
        stream.ready.store(true, Ordering::Release);
        let mut voice = static_voice(4, Vec::new());
        voice.snapshot = Arc::new(VoiceSnapshot {
            owner_id: 1,
            time_bits: AtomicU64::new(0.0_f64.to_bits()),
            volume_bits: AtomicU32::new(1.0_f32.to_bits()),
            playing: AtomicBool::new(true),
            stream: Some(Arc::clone(&stream)),
            current_chunk_samples: AtomicUsize::new(0),
        });
        voice.source = VoiceSource::Streaming {
            buffer: stream,
            chunk: None,
            offset: 0,
        };
        mixer.voices.insert(4, voice);

        let mut output = [1.0_f32; 4];
        render_output(&mut output, &state, &mut mixer);
        assert_eq!(output, [0.0; 4]);
        assert_eq!(mixer.voices.get(&4).unwrap().position_frames, 0.0);
        assert_eq!(state.underruns.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn render_does_not_touch_js_snapshot_or_cache_locks() {
        let state = test_state();
        let mut mixer = Mixer::default();
        mixer
            .voices
            .insert(1, static_voice(1, vec![0.25, 0.25, 0.0, 0.0]));
        let _snapshots = state.snapshots.lock().unwrap();
        let _cache = state.cache.lock().unwrap();
        let mut output = [0.0_f32; 2];
        render_output(&mut output, &state, &mut mixer);
        assert_eq!(output, [0.25, 0.25]);
    }

    #[test]
    fn sustained_streaming_stays_bounded_without_starvation() {
        let state = test_state();
        let stream = Arc::new(StreamingBuffer::new(48_000));
        let producer_stream = Arc::clone(&stream);
        let producer = thread::spawn(move || {
            for _ in 0..(30 * 48_000 / STREAM_CHUNK_FRAMES) {
                assert!(producer_stream.push(vec![0.1; STREAM_CHUNK_SAMPLES].into_boxed_slice()));
            }
            producer_stream.ended.store(true, Ordering::Release);
        });
        while stream.chunks.len() < STREAM_START_CHUNKS {
            thread::yield_now();
        }
        let mut voice = static_voice(5, Vec::new());
        voice.snapshot = Arc::new(VoiceSnapshot {
            owner_id: 1,
            time_bits: AtomicU64::new(0.0_f64.to_bits()),
            volume_bits: AtomicU32::new(1.0_f32.to_bits()),
            playing: AtomicBool::new(true),
            stream: Some(Arc::clone(&stream)),
            current_chunk_samples: AtomicUsize::new(0),
        });
        voice.source = VoiceSource::Streaming {
            buffer: Arc::clone(&stream),
            chunk: None,
            offset: 0,
        };
        voice.play_announced = false;
        let mut mixer = Mixer::default();
        mixer.voices.insert(5, voice);
        let mut output = vec![0.0_f32; STREAM_CHUNK_SAMPLES];
        for _ in 0..(30 * 48_000 / STREAM_CHUNK_FRAMES) {
            render_output(&mut output, &state, &mut mixer);
            assert!(stream.chunks.len() <= stream.chunks.capacity());
        }
        producer.join().unwrap();
        assert_eq!(state.underruns.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn streaming_teardown_wakes_backpressure_waiters() {
        let stream = StreamingBuffer::new(48_000);
        stream.stop();
        assert!(stream.stopped.load(Ordering::Acquire));
    }

    #[test]
    fn credentials_are_redacted_from_decoder_errors() {
        assert_eq!(
            redact_credentials("https://user:secret@example.test/audio.mp3 failed"),
            "https://***:***@example.test/audio.mp3 failed"
        );
    }

    #[test]
    fn preloaded_source_is_sliced_for_sprite_playback() {
        let options = NativeVoiceOptions {
            owner_id: 1,
            id: 2,
            source: "atlas.wav".to_string(),
            ffmpeg_path: "ffmpeg".to_string(),
            offset_seconds: 0.25,
            duration_seconds: Some(0.5),
            volume: 1.0,
            muted: false,
            loop_: false,
            streaming: false,
            playback_rate: 1.0,
            input_args: Vec::new(),
            output_args: Vec::new(),
        };
        let samples = vec![0.0; 48_000 * CHANNELS];
        let sliced = slice_cached_samples(&samples, &options, 48_000).unwrap();
        assert_eq!(sliced.len(), 24_000 * CHANNELS);
    }
}
