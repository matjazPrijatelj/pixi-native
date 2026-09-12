use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use maudio::audio::sample_rate::SampleRate;
use maudio::data_source::data_source_builder::DataSourceBuilder;
use maudio::data_source::pcm_source::PcmSource;
use maudio::data_source::sources::pcm_ring_buffer::{PcmRbRecv, PcmRbSend, PcmRingBuffer};
use maudio::data_source::{DataSource, SourceContext};
use maudio::engine::{engine_builder::EngineBuilder, Engine};
use maudio::sound::{notifier::EndNotifier, sound_builder::SoundBuilder, Sound};
use maudio::{ErrorKinds, MaResult, MaudioError};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

const CHANNELS: usize = 2;
const SAMPLE_RATE: u32 = 48_000;
const STREAM_CHUNK_FRAMES: usize = 2048;
const STREAM_CHUNK_SAMPLES: usize = STREAM_CHUNK_FRAMES * CHANNELS;
const STREAM_START_FRAMES: u32 = (STREAM_CHUNK_FRAMES * 4) as u32;
const STREAM_BUFFER_FRAMES: u32 = SAMPLE_RATE * 2;
const CONTROL_INTERVAL: Duration = Duration::from_millis(5);
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
    sequence: u64,
    fade_version: Option<u32>,
}

struct ActiveFade {
    to: f32,
    ends_at: Instant,
    version: u32,
}

struct StreamingControl {
    ready: AtomicBool,
    ended: AtomicBool,
    stopped: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl StreamingControl {
    fn new() -> Self {
        Self {
            ready: AtomicBool::new(false),
            ended: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            child: Mutex::new(None),
        }
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
    }
}

struct SharedPcmSource {
    samples: Arc<Vec<f32>>,
}

impl SharedPcmSource {
    fn new(samples: Arc<Vec<f32>>) -> Self {
        Self { samples }
    }
}

impl PcmSource<f32> for SharedPcmSource {
    fn fill_pcm_frames(
        &mut self,
        output: &mut [f32],
        context: &mut SourceContext,
    ) -> MaResult<usize> {
        let channels = context.data_format.channels as usize;
        let frame_count = self.samples.len() / channels;
        let cursor = usize::try_from(context.cursor).unwrap_or(usize::MAX);
        if cursor >= frame_count {
            return Ok(0);
        }

        let output_frames = output.len() / channels;
        let frames_to_copy = output_frames.min(frame_count - cursor);
        let sample_start = cursor * channels;
        let samples_to_copy = frames_to_copy * channels;
        output[..samples_to_copy]
            .copy_from_slice(&self.samples[sample_start..sample_start + samples_to_copy]);
        context.cursor += frames_to_copy as u64;
        Ok(frames_to_copy)
    }

    fn seek_to_pcm_frame(&mut self, frame_index: u64, context: &mut SourceContext) -> MaResult<()> {
        let frame_count = self.samples.len() / context.data_format.channels as usize;
        if frame_index > frame_count as u64 {
            return Err(MaudioError::new_ma_error(ErrorKinds::InvalidOperation(
                "Audio seek is outside the cached PCM source",
            )));
        }
        context.cursor = frame_index;
        Ok(())
    }

    fn cursor_in_pcm_frames(&self, context: &SourceContext) -> MaResult<u64> {
        Ok(context.cursor)
    }

    fn length_in_pcm_frames(&self, context: &SourceContext) -> MaResult<u64> {
        Ok((self.samples.len() / context.data_format.channels as usize) as u64)
    }
}

type StaticDataSource = DataSource<f32, SharedPcmSource>;

enum VoiceSource {
    Loading,
    Static(Box<StaticDataSource>),
    Streaming {
        receiver: Box<PcmRbRecv<f32>>,
        control: Arc<StreamingControl>,
    },
}

struct VoiceSnapshot {
    owner_id: u32,
    time_bits: AtomicU64,
    volume_bits: AtomicU32,
    playing: AtomicBool,
    queued_frames: AtomicUsize,
    stream: Option<Arc<StreamingControl>>,
}

struct Voice {
    owner_id: u32,
    id: u32,
    sound: Option<Sound>,
    end_notifier: Option<EndNotifier>,
    source: VoiceSource,
    offset_seconds: f64,
    duration_seconds: Option<f64>,
    timeline_seconds: f64,
    timeline_updated_at: Instant,
    volume: f32,
    muted: bool,
    looped: bool,
    playing: bool,
    playback_rate: f64,
    streaming: bool,
    fade: Option<ActiveFade>,
    play_announced: bool,
    starved: bool,
    snapshot: Arc<VoiceSnapshot>,
}

impl Drop for Voice {
    fn drop(&mut self) {
        if let Some(sound) = self.sound.take() {
            let _ = sound.stop_sound();
            drop(sound);
        }
        if let VoiceSource::Streaming { control, .. } = &self.source {
            control.stop();
        }
    }
}

impl Voice {
    fn update_static_timeline(&mut self, now: Instant) {
        if self.streaming || !self.playing {
            self.timeline_updated_at = now;
            return;
        }
        self.timeline_seconds +=
            now.duration_since(self.timeline_updated_at).as_secs_f64() * self.playback_rate;
        if self.looped {
            if let Some(duration_seconds) = self.duration_seconds {
                self.timeline_seconds %= duration_seconds;
            }
        }
        self.timeline_updated_at = now;
    }
}

enum EngineCommand {
    AddVoice(Voice),
    AttachStatic { id: u32, samples: Arc<Vec<f32>> },
    Control(NativeCommandOptions),
    RemoveOwner(u32),
    StopAll,
    SetGlobalVolume,
}

struct EngineRuntime {
    engine: Engine,
    voices: BTreeMap<u32, Voice>,
}

struct SharedState {
    sample_rate: u32,
    commands: Mutex<VecDeque<EngineCommand>>,
    command_wakeup: Condvar,
    snapshots: Mutex<HashMap<u32, Arc<VoiceSnapshot>>>,
    cache: Mutex<HashMap<String, Arc<Vec<f32>>>>,
    events: Mutex<VecDeque<QueuedEvent>>,
    event_notifier: Option<Arc<EventNotifier>>,
    event_sequence: AtomicU64,
    global_volume_bits: AtomicU32,
    global_muted: AtomicBool,
    fade_versions: Mutex<HashMap<u32, u32>>,
    underruns: AtomicU32,
    shutdown: AtomicBool,
}

impl SharedState {
    fn push_command(&self, command: EngineCommand) {
        if let Ok(mut commands) = self.commands.lock() {
            commands.push_back(command);
            self.command_wakeup.notify_one();
        }
    }

    fn queue_event(
        &self,
        owner_id: u32,
        event: &'static str,
        id: Option<u32>,
        message: Option<String>,
        fade_version: Option<u32>,
    ) {
        if let Ok(mut events) = self.events.lock() {
            events.push_back(QueuedEvent {
                owner_id,
                event,
                id,
                message,
                sequence: self.event_sequence.fetch_add(1, Ordering::Relaxed),
                fade_version,
            });
        }
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
    control_thread: Mutex<Option<thread::JoinHandle<()>>>,
}

#[napi]
impl NativeAudioEngine {
    #[napi(constructor)]
    pub fn new(event_notifier: EventNotifier) -> Result<Self> {
        let mut builder = EngineBuilder::new();
        builder
            .set_channels(CHANNELS as u32)
            .set_sample_rate(SampleRate::Sr48000);
        let engine = builder.build().map_err(|error| {
            Error::from_reason(format!("Cannot initialize miniaudio output: {error}"))
        })?;
        let state = Arc::new(SharedState {
            sample_rate: SAMPLE_RATE,
            commands: Mutex::new(VecDeque::new()),
            command_wakeup: Condvar::new(),
            snapshots: Mutex::new(HashMap::new()),
            cache: Mutex::new(HashMap::new()),
            events: Mutex::new(VecDeque::new()),
            event_notifier: Some(Arc::new(event_notifier)),
            event_sequence: AtomicU64::new(0),
            global_volume_bits: AtomicU32::new(1.0_f32.to_bits()),
            global_muted: AtomicBool::new(false),
            fade_versions: Mutex::new(HashMap::new()),
            underruns: AtomicU32::new(0),
            shutdown: AtomicBool::new(false),
        });
        let thread_state = Arc::clone(&state);
        let control_thread = thread::Builder::new()
            .name("pixi-native-audio".to_string())
            .spawn(move || run_engine(engine, thread_state))
            .map_err(|error| Error::from_reason(format!("Cannot start audio control: {error}")))?;
        Ok(Self {
            state,
            control_thread: Mutex::new(Some(control_thread)),
        })
    }

    #[napi]
    pub fn create_voice(&self, options: NativeVoiceOptions) -> Result<()> {
        validate_voice_options(&options)?;
        let id = options.id;
        let owner_id = options.owner_id;
        let stream_control = options.streaming.then(|| Arc::new(StreamingControl::new()));
        let snapshot = Arc::new(VoiceSnapshot {
            owner_id,
            time_bits: AtomicU64::new(options.offset_seconds.to_bits()),
            volume_bits: AtomicU32::new((options.volume as f32).to_bits()),
            playing: AtomicBool::new(true),
            queued_frames: AtomicUsize::new(0),
            stream: stream_control.clone(),
        });
        let mut stream_sender = None;
        let source = if let Some(control) = &stream_control {
            let (mut sender, mut receiver) =
                PcmRingBuffer::new_f32(STREAM_BUFFER_FRAMES, CHANNELS as u32).map_err(|error| {
                    Error::from_reason(format!("Cannot create audio ring buffer: {error}"))
                })?;
            sender.set_sample_rate(SampleRate::Sr48000);
            receiver.set_sample_rate(SampleRate::Sr48000);
            stream_sender = Some(sender);
            VoiceSource::Streaming {
                receiver: Box::new(receiver),
                control: Arc::clone(control),
            }
        } else {
            VoiceSource::Loading
        };
        let voice = Voice {
            owner_id,
            id,
            sound: None,
            end_notifier: None,
            source,
            offset_seconds: options.offset_seconds,
            duration_seconds: options.duration_seconds,
            timeline_seconds: 0.0,
            timeline_updated_at: Instant::now(),
            volume: options.volume as f32,
            muted: options.muted,
            looped: options.loop_ && !options.streaming,
            playing: true,
            playback_rate: options.playback_rate,
            streaming: options.streaming,
            fade: None,
            play_announced: false,
            starved: false,
            snapshot: Arc::clone(&snapshot),
        };
        self.state
            .snapshots
            .lock()
            .map_err(|_| Error::from_reason("Audio engine state is poisoned"))?
            .insert(id, snapshot);
        self.state.push_command(EngineCommand::AddVoice(voice));

        if let (Some(sender), Some(control)) = (stream_sender, stream_control) {
            start_streaming_decode(Arc::clone(&self.state), options, sender, control);
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
                )));
            }
        }

        if options.command == "stop" {
            self.remove_snapshots(options.owner_id, options.id);
        }
        self.state.push_command(EngineCommand::Control(options));
        Ok(())
    }

    #[napi]
    pub fn unload_owner(&self, owner_id: u32) {
        self.remove_snapshots(owner_id, None);
        self.state
            .push_command(EngineCommand::RemoveOwner(owner_id));
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
        self.state.push_command(EngineCommand::SetGlobalVolume);
        Ok(())
    }

    #[napi]
    pub fn set_global_muted(&self, value: bool) {
        self.state.global_muted.store(value, Ordering::Release);
        self.state.push_command(EngineCommand::SetGlobalVolume);
    }

    #[napi]
    pub fn drain_events(&self) -> Vec<NativeAudioEvent> {
        let mut queued = self
            .state
            .events
            .lock()
            .map(|mut events| events.drain(..).collect::<Vec<_>>())
            .unwrap_or_default();
        queued.sort_by_key(|event| event.sequence);
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
        let (active_voices, queued_frames) = self
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
                    .map(|snapshot| snapshot.queued_frames.load(Ordering::Acquire))
                    .sum::<usize>();
                (active, queued)
            })
            .unwrap_or((0, 0));
        NativeAudioDiagnostics {
            active_voices,
            queued_ms: queued_frames as f64 * 1000.0 / self.state.sample_rate as f64,
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
        self.state.push_command(EngineCommand::StopAll);
    }

    #[napi]
    pub fn shutdown(&self) {
        self.state.shutdown.store(true, Ordering::Release);
        self.stop_all();
        self.state.command_wakeup.notify_all();
        if let Ok(mut control_thread) = self.control_thread.lock() {
            if let Some(control_thread) = control_thread.take() {
                let _ = control_thread.join();
            }
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
        self.state.command_wakeup.notify_all();
        if let Ok(mut control_thread) = self.control_thread.lock() {
            if let Some(control_thread) = control_thread.take() {
                let _ = control_thread.join();
            }
        }
    }
}

fn run_engine(engine: Engine, state: Arc<SharedState>) {
    let mut runtime = EngineRuntime {
        engine,
        voices: BTreeMap::new(),
    };
    runtime.apply_global_volume(&state);
    while !state.shutdown.load(Ordering::Acquire) {
        let commands = if let Ok(commands) = state.commands.lock() {
            let mut commands = if commands.is_empty() {
                state
                    .command_wakeup
                    .wait_timeout(commands, CONTROL_INTERVAL)
                    .map_or_else(|poisoned| poisoned.into_inner().0, |result| result.0)
            } else {
                commands
            };
            commands.drain(..).collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        runtime.apply_commands(&state, commands);
        runtime.poll_voices(&state);
    }
    runtime.voices.clear();
    let _ = runtime.engine.stop();
}

impl EngineRuntime {
    fn apply_commands(&mut self, state: &SharedState, commands: Vec<EngineCommand>) {
        for command in commands {
            match command {
                EngineCommand::AddVoice(mut voice) => {
                    if matches!(voice.source, VoiceSource::Streaming { .. }) {
                        if let Err(message) = self.attach_sound(&mut voice) {
                            state.queue_event(
                                voice.owner_id,
                                "playerror",
                                Some(voice.id),
                                Some(message),
                                None,
                            );
                            remove_snapshot(state, voice.id);
                            continue;
                        }
                    }
                    self.voices.insert(voice.id, voice);
                }
                EngineCommand::AttachStatic { id, samples } => {
                    let Some(mut voice) = self.voices.remove(&id) else {
                        continue;
                    };
                    let result = build_static_data_source(samples)
                        .map_err(|error| format!("Cannot create miniaudio data source: {error}"))
                        .and_then(|buffer| {
                            voice.source = VoiceSource::Static(Box::new(buffer));
                            self.attach_sound(&mut voice)
                        });
                    match result {
                        Ok(()) => {
                            state.queue_event(voice.owner_id, "play", Some(id), None, None);
                            self.voices.insert(id, voice);
                        }
                        Err(message) => {
                            state.queue_event(
                                voice.owner_id,
                                "playerror",
                                Some(id),
                                Some(message),
                                None,
                            );
                            remove_snapshot(state, id);
                        }
                    }
                }
                EngineCommand::Control(options) => self.apply_control(state, options),
                EngineCommand::RemoveOwner(owner_id) => {
                    self.voices.retain(|_, voice| voice.owner_id != owner_id);
                }
                EngineCommand::StopAll => self.voices.clear(),
                EngineCommand::SetGlobalVolume => self.apply_global_volume(state),
            }
        }
    }

    fn attach_sound(&self, voice: &mut Voice) -> std::result::Result<(), String> {
        let (sound, notifier) = match &voice.source {
            VoiceSource::Static(source) => SoundBuilder::new(&self.engine)
                .data_source(source.as_ref())
                .with_end_notifier(),
            VoiceSource::Streaming { receiver, .. } => SoundBuilder::new(&self.engine)
                .data_source(receiver.as_ref())
                .with_end_notifier(),
            VoiceSource::Loading => return Ok(()),
        }
        .map_err(|error| format!("Cannot create miniaudio sound: {error}"))?;
        sound.set_spatialization(false);
        sound.set_volume(if voice.muted { 0.0 } else { 1.0 });
        sound.set_fade_mili(voice.volume, voice.volume, 0);
        sound.set_looping(voice.looped && !voice.streaming);
        if !voice.streaming {
            sound.set_pitch(voice.playback_rate as f32);
            sound
                .play_sound()
                .map_err(|error| format!("Cannot start miniaudio sound: {error}"))?;
            voice.timeline_updated_at = Instant::now();
            voice.play_announced = true;
        }
        voice.sound = Some(sound);
        voice.end_notifier = Some(notifier);
        Ok(())
    }

    fn apply_global_volume(&self, state: &SharedState) {
        let muted = state.global_muted.load(Ordering::Acquire);
        let volume = f32::from_bits(state.global_volume_bits.load(Ordering::Acquire));
        let _ = self.engine.set_volume(if muted { 0.0 } else { volume });
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
                voice.timeline_updated_at = Instant::now();
                voice.playing = true;
                voice.snapshot.playing.store(true, Ordering::Release);
                if let Some(sound) = &voice.sound {
                    let _ = sound.play_sound();
                }
                state.queue_event(voice.owner_id, "play", Some(id), None, None);
            }
            "pause" => {
                voice.update_static_timeline(Instant::now());
                voice.playing = false;
                voice.snapshot.playing.store(false, Ordering::Release);
                if let Some(sound) = &voice.sound {
                    let _ = sound.stop_sound();
                }
                state.queue_event(voice.owner_id, "pause", Some(id), None, None);
            }
            "volume" => {
                voice.volume = options.value.unwrap_or(1.0) as f32;
                voice.fade = None;
                if let Some(sound) = &voice.sound {
                    sound.set_fade_mili(voice.volume, voice.volume, 0);
                }
                voice
                    .snapshot
                    .volume_bits
                    .store(voice.volume.to_bits(), Ordering::Release);
                state.queue_event(voice.owner_id, "volume", Some(id), None, None);
            }
            "mute" => {
                voice.muted = options.bool_value.unwrap_or(false);
                if let Some(sound) = &voice.sound {
                    sound.set_volume(if voice.muted { 0.0 } else { 1.0 });
                }
                state.queue_event(voice.owner_id, "mute", Some(id), None, None);
            }
            "loop" => {
                voice.looped = options.bool_value.unwrap_or(false);
                if let Some(sound) = &voice.sound {
                    sound.set_looping(voice.looped && !voice.streaming);
                }
            }
            "seek" => {
                let seconds = options.value.unwrap_or(0.0);
                voice.fade = None;
                if !voice.streaming {
                    if let Some(sound) = &voice.sound {
                        let _ = sound.seek_to_second(seconds as f32);
                    }
                    voice.timeline_seconds = seconds;
                    voice.timeline_updated_at = Instant::now();
                }
                voice.snapshot.time_bits.store(
                    (voice.offset_seconds + seconds).to_bits(),
                    Ordering::Release,
                );
                state.queue_event(voice.owner_id, "seek", Some(id), None, None);
            }
            "fade" => {
                let from = options.from.unwrap_or(voice.volume as f64) as f32;
                let to = options.to.unwrap_or(1.0) as f32;
                let duration_ms = options.duration_ms.unwrap_or(0.0).round() as u64;
                if let Some(sound) = &voice.sound {
                    sound.set_fade_mili(from, to, duration_ms);
                }
                voice.fade = Some(ActiveFade {
                    to,
                    ends_at: Instant::now() + Duration::from_millis(duration_ms),
                    version: options.fade_version.unwrap_or(0),
                });
            }
            _ => {}
        }
    }

    fn poll_voices(&mut self, state: &SharedState) {
        let mut completed = Vec::new();
        for (id, voice) in &mut self.voices {
            if voice.sound.is_none() {
                continue;
            }
            voice.update_static_timeline(Instant::now());
            let sound = voice.sound.as_ref().expect("sound was checked above");
            if let VoiceSource::Streaming { receiver, control } = &voice.source {
                let queued = receiver.available_read() as usize;
                voice
                    .snapshot
                    .queued_frames
                    .store(queued, Ordering::Release);
                if control.ready.load(Ordering::Acquire)
                    && !voice.play_announced
                    && sound.play_sound().is_ok()
                {
                    voice.play_announced = true;
                    state.queue_event(voice.owner_id, "play", Some(*id), None, None);
                }
                let starved = voice.play_announced
                    && voice.playing
                    && queued == 0
                    && !control.ended.load(Ordering::Acquire);
                if starved && !voice.starved {
                    state.underruns.fetch_add(1, Ordering::Relaxed);
                }
                voice.starved = starved;
                if control.ended.load(Ordering::Acquire) && queued == 0 {
                    if voice.play_announced {
                        state.queue_event(voice.owner_id, "end", Some(*id), None, None);
                    }
                    completed.push(*id);
                    continue;
                }
            }

            let elapsed_seconds = if voice.streaming {
                sound.time_millis() as f64 * voice.playback_rate / 1000.0
            } else {
                voice.timeline_seconds
            };
            let time = voice.offset_seconds + elapsed_seconds;
            voice
                .snapshot
                .time_bits
                .store(time.to_bits(), Ordering::Release);
            let current_volume = if voice.fade.is_some() {
                sound.current_fade_volume()
            } else {
                voice.volume
            };
            voice
                .snapshot
                .volume_bits
                .store(current_volume.to_bits(), Ordering::Release);
            if voice
                .fade
                .as_ref()
                .is_some_and(|fade| Instant::now() >= fade.ends_at)
            {
                let fade = voice.fade.take().expect("fade was checked above");
                voice.volume = fade.to;
                state.queue_event(
                    voice.owner_id,
                    "fade",
                    Some(voice.id),
                    None,
                    Some(fade.version),
                );
            }
            if voice.end_notifier.as_ref().is_some_and(EndNotifier::take) {
                state.queue_event(voice.owner_id, "end", Some(*id), None, None);
                if !voice.looped {
                    completed.push(*id);
                }
            }
        }
        for id in completed {
            self.voices.remove(&id);
            remove_snapshot(state, id);
        }
    }
}

fn remove_snapshot(state: &SharedState, id: u32) {
    if let Ok(mut snapshots) = state.snapshots.lock() {
        snapshots.remove(&id);
    }
}

fn start_static_decode(
    state: Arc<SharedState>,
    options: NativeVoiceOptions,
    preload: bool,
    request_id: Option<u32>,
) {
    let key = cache_key(&options);
    if let Some(samples) = state
        .cache
        .lock()
        .ok()
        .and_then(|cache| cache.get(&key).cloned())
    {
        complete_static_decode(&state, &options, preload, request_id, samples);
        return;
    }

    thread::spawn(move || {
        let decoded = decode_static(&options, state.sample_rate).map(Arc::new);
        match decoded {
            Ok(samples) => {
                if let Ok(mut cache) = state.cache.lock() {
                    cache.insert(key, Arc::clone(&samples));
                }
                complete_static_decode(&state, &options, preload, request_id, samples);
            }
            Err(message) => {
                if !preload {
                    remove_snapshot(&state, options.id);
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

fn complete_static_decode(
    state: &SharedState,
    options: &NativeVoiceOptions,
    preload: bool,
    request_id: Option<u32>,
    samples: Arc<Vec<f32>>,
) {
    if preload {
        state.queue_event(options.owner_id, "load", request_id, None, None);
    } else {
        state.push_command(EngineCommand::AttachStatic {
            id: options.id,
            samples,
        });
    }
}

fn build_static_data_source(samples: Arc<Vec<f32>>) -> MaResult<StaticDataSource> {
    DataSourceBuilder::new(CHANNELS as u32, SampleRate::Sr48000)
        .build_f32(SharedPcmSource::new(samples))
}

fn start_streaming_decode(
    state: Arc<SharedState>,
    options: NativeVoiceOptions,
    mut sender: PcmRbSend<f32>,
    control: Arc<StreamingControl>,
) {
    thread::spawn(move || {
        let result = decode_stream(&state, &options, &mut sender, &control);
        if let Err(message) = result {
            if !control.stopped.load(Ordering::Acquire) {
                remove_snapshot(&state, options.id);
                state.queue_event(
                    options.owner_id,
                    "playerror",
                    Some(options.id),
                    Some(message),
                    None,
                );
            }
        }
        control.ended.store(true, Ordering::Release);
        state.command_wakeup.notify_one();
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
    sender: &mut PcmRbSend<f32>,
    control: &StreamingControl,
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
    if let Ok(mut stored_child) = control.child.lock() {
        *stored_child = Some(child);
    }
    let mut byte_carry = Vec::new();
    let mut sample_carry = Vec::new();
    let mut bytes = vec![0_u8; 32 * 1024];
    let mut produced_frames = 0_u32;
    loop {
        if control.stopped.load(Ordering::Acquire) || state.shutdown.load(Ordering::Acquire) {
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
            let chunk = std::mem::replace(&mut sample_carry, remainder);
            write_stream_chunk(sender, &chunk, control)?;
            produced_frames = produced_frames.saturating_add(STREAM_CHUNK_FRAMES as u32);
            if produced_frames >= STREAM_START_FRAMES {
                control.ready.store(true, Ordering::Release);
            }
        }
    }
    let mut child = control
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
        let frames = sample_carry.len() / CHANNELS;
        sample_carry.resize(STREAM_CHUNK_SAMPLES, 0.0);
        write_stream_chunk(sender, &sample_carry, control)?;
        produced_frames = produced_frames.saturating_add(frames as u32);
    }
    if produced_frames == 0 {
        return Err("Audio stream contains no decodable samples".to_string());
    }
    control.ready.store(true, Ordering::Release);
    Ok(())
}

fn write_stream_chunk(
    sender: &mut PcmRbSend<f32>,
    samples: &[f32],
    control: &StreamingControl,
) -> std::result::Result<(), String> {
    let mut written = 0;
    while written < samples.len() / CHANNELS {
        if control.stopped.load(Ordering::Acquire) {
            return Ok(());
        }
        let frames = sender
            .write(&samples[written * CHANNELS..])
            .map_err(|error| format!("Cannot write audio stream buffer: {error}"))?;
        if frames == 0 {
            thread::sleep(Duration::from_millis(2));
        } else {
            written += frames;
        }
    }
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

    #[test]
    fn static_voices_share_pcm_with_independent_cursors() {
        let samples = Arc::new(vec![0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
        let mut first = build_static_data_source(Arc::clone(&samples)).unwrap();
        let second = build_static_data_source(Arc::clone(&samples)).unwrap();

        assert_eq!(Arc::strong_count(&samples), 3);
        assert_eq!(first.cursor_in_pcm_frames().unwrap(), 0);
        assert_eq!(second.cursor_in_pcm_frames().unwrap(), 0);

        assert_eq!(first.read_pcm_frames(1).unwrap().frames(), 1);
        assert_eq!(first.cursor_in_pcm_frames().unwrap(), 1);
        assert_eq!(second.cursor_in_pcm_frames().unwrap(), 0);

        first.seek_to_pcm_frame(0).unwrap();
        assert_eq!(first.cursor_in_pcm_frames().unwrap(), 0);
        assert!(first.seek_to_pcm_frame(4).is_err());

        drop(first);
        drop(second);
        assert_eq!(Arc::strong_count(&samples), 1);
    }

    #[test]
    fn atempo_decomposes_extreme_rates() {
        assert_eq!(build_atempo_filter(4.0).unwrap(), "atempo=2,atempo=2");
        assert_eq!(build_atempo_filter(0.25).unwrap(), "atempo=0.5,atempo=0.5");
    }

    #[test]
    fn credentials_are_redacted() {
        assert_eq!(
            redact_credentials("https://user:secret@example.test/audio.mp3"),
            "https://***:***@example.test/audio.mp3"
        );
    }
}
