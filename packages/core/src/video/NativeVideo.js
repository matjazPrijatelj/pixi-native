import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { Howl } from "../audio/index.js";
import { parseMediaSource, redactMediaSource } from "./mediaSource.js";
import { loadNativeVideo, resolveNativePlatformModules, } from "../runtime/platformNative.js";
const AUDIO_FRAME_LEAD_SECONDS = 0.02;
const DECODER_READY_POLL_MS = 5;
const DECODER_START_TIMEOUT_MS = 10_000;
const LIVE_PRESENTATION_STALL_TIMEOUT_MS = 5_000;
const MINIMUM_CATCH_UP_LAG_SECONDS = 0.1;
const CATCH_UP_LAG_FRAMES = 3;
const MAXIMUM_SOFTWARE_4K_FPS = 30;
const UHD_PIXEL_COUNT = 3840 * 2160;
const SOFTWARE_CHROMA_PIXEL_FORMAT = /^yuv(?:422|444)p/;
export function getNv12FrameLayout(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
        throw new Error("NV12 video dimensions must be safe integers");
    }
    if (width <= 0 || height <= 0) {
        throw new Error("Video dimensions must be positive");
    }
    if (width % 2 !== 0 || height % 2 !== 0) {
        throw new Error("NV12 video dimensions must be even");
    }
    const yBytes = width * height;
    const uvBytes = yBytes / 2;
    return {
        yBytes,
        uvBytes,
        frameBytes: yBytes + uvBytes,
        yStride: width,
        uvStride: width,
    };
}
export function splitNv12Frame(frame) {
    const layout = getNv12FrameLayout(frame.width, frame.height);
    if (frame.data.byteLength !== layout.frameBytes) {
        throw new Error(`NV12 frame has ${frame.data.byteLength} bytes; expected ${layout.frameBytes}`);
    }
    return {
        width: frame.width,
        height: frame.height,
        timestampUs: frame.timestampUs,
        y: frame.data.subarray(0, layout.yBytes),
        uv: frame.data.subarray(layout.yBytes),
        yStride: layout.yStride,
        uvStride: layout.uvStride,
        pixelFormat: "nv12",
    };
}
export function convertBt709LimitedNv12SampleToRgb(rawY, rawU, rawV) {
    const y = (rawY / 255 - 16 / 255) * (255 / 219);
    const u = (rawU / 255 - 128 / 255) * (255 / 224);
    const v = (rawV / 255 - 128 / 255) * (255 / 224);
    const clamp = (value) => Math.min(1, Math.max(0, value));
    return [
        clamp(y + 1.5748 * v),
        clamp(y - 0.1873 * u - 0.4681 * v),
        clamp(y + 1.8556 * u),
    ];
}
export function getBundledFfmpegPath(platform = process.platform, arch = process.arch) {
    return resolveNativePlatformModules(platform, arch).ffmpeg;
}
export function resolveFfmpegPath(options = {}) {
    const explicitPath = options.explicitPath?.trim();
    if (explicitPath)
        return explicitPath;
    const environment = options.environment ?? process.env;
    const environmentPath = environment.FFMPEG_PATH?.trim();
    if (environmentPath)
        return environmentPath;
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const bundledPath = getBundledFfmpegPath(platform, arch);
    const pathExists = options.pathExists ?? existsSync;
    return pathExists(bundledPath) ? bundledPath : "ffmpeg";
}
function resolveFfprobePath(ffmpegPath) {
    if (ffmpegPath === "ffmpeg")
        return "ffprobe";
    const executable = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    return join(dirname(ffmpegPath), executable);
}
function probeMedia(source, ffmpegPath, inputArgs) {
    return new Promise((resolve) => {
        execFile(resolveFfprobePath(ffmpegPath), [
            "-v", "error",
            ...inputArgs,
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height,pix_fmt:format=duration",
            "-of", "json",
            "-i", source,
        ], { windowsHide: true, timeout: 5_000 }, (error, stdout) => {
            if (error) {
                void redactMediaSource(error.message);
                resolve(null);
                return;
            }
            try {
                const data = JSON.parse(stdout);
                const duration = Number(data.format?.duration);
                resolve({
                    duration: Number.isFinite(duration) ? duration : undefined,
                    width: data.streams?.[0]?.width,
                    height: data.streams?.[0]?.height,
                    pixelFormat: data.streams?.[0]?.pix_fmt,
                });
            }
            catch {
                resolve(null);
            }
        });
    });
}
export class NativeVideoDecoder {
    decoder;
    constructor(options) {
        getNv12FrameLayout(options.width, options.height);
        const fps = options.fps ?? 30;
        if (!Number.isFinite(fps) || fps <= 0) {
            throw new Error("Video FPS must be positive and finite");
        }
        const startTime = options.startTime ?? 0;
        if (!Number.isFinite(startTime) || startTime < 0) {
            throw new Error("Video start time must be non-negative and finite");
        }
        const playbackRate = options.playbackRate ?? 1;
        if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
            throw new Error("Video playback rate must be positive and finite");
        }
        const nativeVideo = loadNativeVideo();
        this.decoder = new nativeVideo.NativeVideoDecoder({
            width: options.width,
            height: options.height,
            fps,
            startTime,
            playbackRate,
            endTime: options.endTime,
            sourcePaced: options.sourcePaced,
            inputArgs: options.inputArgs ? [...options.inputArgs] : undefined,
            outputArgs: options.outputArgs ? [...options.outputArgs] : undefined,
            vaapiDevice: options.vaapiDevice,
            ffmpegPath: resolveFfmpegPath({
                explicitPath: options.ffmpegPath,
            }),
        });
    }
    open(source) {
        this.decoder.open(source);
    }
    pollLatest() {
        const frame = this.decoder.pollLatest();
        return frame ? splitNv12Frame(frame) : null;
    }
    pollNext() {
        const frame = this.decoder.pollNext();
        return frame ? splitNv12Frame(frame) : null;
    }
    queuedFrames() {
        return this.decoder.queuedFrames();
    }
    catchUpTo(timestampUs) {
        this.decoder.catchUpTo(timestampUs);
    }
    isReady() {
        return this.decoder.queuedFrames() > 0;
    }
    pollError() {
        return this.decoder.pollError();
    }
    backend() {
        return this.decoder.backend();
    }
    decodedFrames() {
        return this.decoder.decodedFrames();
    }
    droppedFrames() {
        return this.decoder.droppedFrames();
    }
    skippedFrames() {
        return this.decoder.skippedFrames();
    }
    isFinished() {
        return this.decoder.isFinished();
    }
    close() {
        this.decoder.close();
    }
}
const DEFAULT_DEPENDENCIES = {
    createDecoder: (options) => new NativeVideoDecoder(options),
    createAudio: (source, startTime, volume, muted, playbackRate, inputArgs, outputArgs, endTime) => new HowlVideoAudio(source, startTime, volume, muted, playbackRate, inputArgs, outputArgs, endTime),
    probeMetadata: probeMedia,
};
class HowlVideoAudio {
    howl;
    startTime;
    id = -1;
    hasEnded = false;
    currentVolume;
    currentMuted;
    constructor(source, startTime, volume, muted, playbackRate, inputArgs, outputArgs, endTime) {
        this.startTime = startTime;
        this.currentVolume = volume;
        this.currentMuted = muted;
        this.howl = new Howl({
            src: [source],
            sprite: {
                __video: [
                    startTime * 1000,
                    endTime === undefined ? 86_400_000 : (endTime - startTime) * 1000,
                ],
            },
            volume,
            mute: muted,
            preload: false,
            html5: true,
            rate: playbackRate,
            ffmpegInputArgs: inputArgs,
            ffmpegOutputArgs: outputArgs,
        });
    }
    get currentTime() {
        return this.id === -1
            ? 0
            : this.startTime + this.howl.seek(this.id);
    }
    get ended() {
        return this.hasEnded;
    }
    get volume() {
        return this.currentVolume;
    }
    set volume(value) {
        this.currentVolume = value;
        this.howl.volume(value, this.id === -1 ? undefined : this.id);
    }
    get muted() {
        return this.currentMuted;
    }
    set muted(value) {
        this.currentMuted = value;
        this.howl.mute(value, this.id === -1 ? undefined : this.id);
    }
    play() {
        return new Promise((resolve, reject) => {
            const onPlay = () => resolve();
            const onError = (_id, message) => reject(new Error(message ?? "Video audio failed to start"));
            this.howl.once("play", onPlay);
            this.howl.once("playerror", onError);
            this.howl.once("end", () => { this.hasEnded = true; });
            this.id = this.howl.play("__video");
            if (this.id === -1)
                reject(new Error("Video audio failed to start"));
        });
    }
    destroy() {
        this.howl.unload();
    }
}
const activeVideos = new Set();
export function setNativeVideoModalState(active) {
    for (const reference of activeVideos) {
        const video = reference.deref();
        if (video)
            video.setModalState(active);
        else
            activeVideos.delete(reference);
    }
}
export class NativeVideo extends EventTarget {
    width;
    height;
    fps;
    videoWidth;
    videoHeight;
    onemptied = null;
    onloadedmetadata = null;
    onloadeddata = null;
    oncanplay = null;
    oncanplaythrough = null;
    onplay = null;
    onplaying = null;
    onpause = null;
    ontimeupdate = null;
    onseeked = null;
    onended = null;
    onerror = null;
    options;
    dependencies;
    decoder;
    positionSeconds = 0;
    isPaused = true;
    hasEnded = false;
    destroyed = false;
    lastBackend = "not started";
    lastError = null;
    decodedFrameBase = 0;
    droppedFrameBase = 0;
    skippedFrameBase = 0;
    presentedFrameCount = 0;
    skippedFrameCount = 0;
    syncOffsetMilliseconds = 0;
    audio;
    playbackClockStartedAtMs;
    playbackClockStartSeconds = 0;
    lastAudioError = null;
    pendingFrame = null;
    catchUpTargetUs;
    audioVolume;
    audioMuted;
    playbackGeneration = 0;
    sourceValue;
    decodedSource;
    segmentStart = 0;
    segmentEnd;
    playbackRateValue;
    loopValue;
    readyStateValue = 0;
    durationValue;
    sourcePixelFormat;
    metadataDispatched = false;
    dataDispatched = false;
    playingDispatched = false;
    lastTimeUpdateMs = Number.NEGATIVE_INFINITY;
    reconnectAttempt = 0;
    reconnectAtMs = 0;
    livePresentationDeadlineMs = 0;
    frameAwaitingPresentation = false;
    registryReference;
    metadataPromise;
    sourceGeneration = 0;
    constructor(src, options, dependencies = DEFAULT_DEPENDENCIES) {
        super();
        if (!src)
            throw new Error("Video source must not be empty");
        getNv12FrameLayout(options.width, options.height);
        const fps = options.fps ?? 30;
        if (!Number.isFinite(fps) || fps <= 0) {
            throw new Error("Video FPS must be positive and finite");
        }
        const parsedSource = parseMediaSource(src);
        this.sourceValue = src;
        this.decodedSource = parsedSource.source;
        this.segmentStart = parsedSource.startTime;
        this.segmentEnd = parsedSource.endTime;
        this.width = options.width;
        this.height = options.height;
        this.videoWidth = options.width;
        this.videoHeight = options.height;
        this.fps = fps;
        this.options = options;
        this.dependencies = dependencies;
        this.audioVolume = options.volume ?? 1;
        this.audioMuted = options.muted ?? false;
        this.playbackRateValue = options.playbackRate ?? 1;
        this.loopValue = options.loop ?? false;
        if (!Number.isFinite(this.playbackRateValue) || this.playbackRateValue <= 0) {
            throw new RangeError("Video playbackRate must be positive and finite");
        }
        if (options.mediaType === "live" && this.playbackRateValue !== 1) {
            throw new Error("Live video only supports playbackRate 1");
        }
        this.positionSeconds = this.segmentStart;
        this.durationValue = options.mediaType === "live"
            ? Number.POSITIVE_INFINITY
            : (this.segmentEnd ?? Number.NaN);
        this.registryReference = new WeakRef(this);
        activeVideos.add(this.registryReference);
    }
    get src() {
        return this.sourceValue;
    }
    set src(value) {
        this.replaceSource(value, !this.isPaused);
    }
    replaceSource(value, resumePlayback) {
        this.assertUsable();
        if (!value)
            throw new Error("Video source must not be empty");
        const parsed = parseMediaSource(value);
        this.playbackGeneration++;
        this.stopDecoder();
        this.stopAudio();
        this.isPaused = true;
        this.sourceValue = value;
        this.decodedSource = parsed.source;
        this.segmentStart = parsed.startTime;
        this.segmentEnd = parsed.endTime;
        this.resetSourceState();
        this.emit("emptied");
        if (resumePlayback) {
            void this.play().catch(() => undefined);
        }
        else {
            this.loadMetadataInBackground();
        }
    }
    get currentSrc() {
        return this.decodedSource;
    }
    get duration() {
        return this.durationValue;
    }
    get readyState() {
        return this.readyStateValue;
    }
    get loop() {
        return this.loopValue;
    }
    set loop(value) {
        this.loopValue = Boolean(value);
    }
    get playbackRate() {
        return this.playbackRateValue;
    }
    set playbackRate(value) {
        this.assertUsable();
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError("Video playbackRate must be positive and finite");
        }
        if (this.options.mediaType === "live" && value !== 1) {
            throw new Error("Live video only supports playbackRate 1");
        }
        if (value === this.playbackRateValue)
            return;
        const position = this.currentTime;
        this.playbackRateValue = value;
        if (!this.isPaused)
            void this.restartPlayback(position);
    }
    get paused() {
        return this.isPaused;
    }
    get ended() {
        return this.hasEnded;
    }
    get backend() {
        return this.decoder?.backend() ?? this.lastBackend;
    }
    get error() {
        return this.lastError;
    }
    get audioError() {
        return this.lastAudioError;
    }
    get reconnecting() {
        return this.reconnectAtMs > 0;
    }
    get reconnectAttempts() {
        return this.reconnectAttempt;
    }
    get volume() {
        return this.audio?.volume ?? this.audioVolume;
    }
    set volume(value) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new RangeError("Video volume must be between 0 and 1");
        }
        this.audioVolume = value;
        if (this.audio)
            this.audio.volume = value;
    }
    get muted() {
        return this.audio?.muted ?? this.audioMuted;
    }
    set muted(value) {
        this.audioMuted = value;
        if (this.audio)
            this.audio.muted = value;
    }
    get currentTime() {
        return this.audio && !this.audio.ended
            ? this.audio.currentTime
            : (this.filePlaybackClockTime() ?? this.positionSeconds);
    }
    set currentTime(value) {
        this.assertUsable();
        if (this.options.mediaType === "live") {
            throw new Error("Live video cannot be seeked");
        }
        if (!Number.isFinite(value) || value < 0) {
            throw new RangeError("currentTime must be non-negative and finite");
        }
        this.positionSeconds = this.clampFileTime(value);
        this.pendingFrame = null;
        this.syncOffsetMilliseconds = 0;
        this.hasEnded = false;
        this.lastError = null;
        if (!this.isPaused) {
            try {
                if (this.shouldUseAudio()) {
                    void this.restartWithAudio(value, ++this.playbackGeneration);
                }
                else {
                    this.startDecoder(value);
                }
            }
            catch (error) {
                this.isPaused = true;
                this.lastError = asError(error);
                throw this.lastError;
            }
        }
        this.emit("timeupdate");
        queueMicrotask(() => {
            if (!this.destroyed)
                this.emit("seeked");
        });
    }
    get stats() {
        const layout = getNv12FrameLayout(this.width, this.height);
        return {
            decodedFrames: this.decodedFrameBase + (this.decoder?.decodedFrames() ?? 0),
            presentedFrames: this.presentedFrameCount,
            droppedFrames: this.droppedFrameBase + (this.decoder?.droppedFrames() ?? 0),
            skippedFrames: this.skippedFrameBase +
                this.skippedFrameCount +
                (this.decoder?.skippedFrames() ?? 0),
            queuedFrames: (this.decoder?.queuedFrames() ?? 0) + (this.pendingFrame ? 1 : 0),
            syncOffsetMs: this.syncOffsetMilliseconds,
            bytesPerFrame: layout.frameBytes,
        };
    }
    async play() {
        this.assertUsable();
        if (!this.isPaused)
            return;
        void this.ensureMetadata();
        if (this.hasEnded)
            this.positionSeconds = this.segmentStart;
        this.hasEnded = false;
        this.lastError = null;
        this.isPaused = false;
        this.emit("play");
        const generation = ++this.playbackGeneration;
        try {
            await this.ensureMetadata();
            if (generation !== this.playbackGeneration || this.isPaused)
                return;
            await this.startPlaybackAt(this.positionSeconds, generation);
        }
        catch (error) {
            this.lastError = asError(error);
            this.stopDecoder();
            this.stopAudio();
            this.emit("error");
            if (this.options.mediaType === "live" && this.options.reconnect !== false) {
                this.scheduleReconnect();
                return;
            }
            this.isPaused = true;
            throw this.lastError;
        }
    }
    pause() {
        this.assertUsable();
        this.pauseInternal(true);
    }
    load() {
        this.replaceSource(this.sourceValue, false);
    }
    takeLatestFrame() {
        if (this.destroyed)
            return null;
        if (!this.decoder) {
            this.tryReconnect();
            return null;
        }
        if (this.frameAwaitingPresentation && this.recoverStalledLiveVideo()) {
            return null;
        }
        const message = this.decoder.pollError();
        if (message) {
            this.lastError = new Error(message);
            this.stopDecoder();
            this.emit("error");
            if (this.options.mediaType === "live" && this.options.reconnect !== false) {
                this.scheduleReconnect();
            }
            else {
                this.isPaused = true;
            }
            return null;
        }
        if (!this.shouldUseAudio() && this.decoder.isReady()) {
            this.ensureFilePlaybackClock(this.positionSeconds);
        }
        const synchronizationTime = this.audio && !this.audio.ended
            ? this.audio.currentTime
            : this.filePlaybackClockTime();
        const frame = synchronizationTime === undefined
            ? this.takeNewestDecodedFrame()
            : this.takeSynchronizedFrame(synchronizationTime);
        if (frame) {
            this.frameAwaitingPresentation = true;
            return frame;
        }
        if (this.decoder.isFinished() &&
            this.pendingFrame === null &&
            this.decoder.queuedFrames() === 0) {
            if (this.options.mediaType === "live") {
                this.stopDecoder();
                this.lastError = new Error("Live video stream ended");
                this.emit("error");
                if (this.options.reconnect !== false)
                    this.scheduleReconnect();
                else
                    this.isPaused = true;
                return null;
            }
            if (!this.audio || this.audio.ended) {
                this.stopDecoder();
                this.stopAudio();
                if (this.loopValue) {
                    this.positionSeconds = this.segmentStart;
                    void this.restartPlayback(this.segmentStart);
                }
                else {
                    this.positionSeconds = this.segmentEnd ?? this.positionSeconds;
                    this.emit("timeupdate");
                    this.isPaused = true;
                    this.hasEnded = true;
                    this.emit("pause");
                    this.emit("ended");
                }
            }
        }
        if (this.recoverStalledLiveVideo())
            return null;
        this.tryReconnect();
        return null;
    }
    markFramePresented() {
        if (this.destroyed || !this.frameAwaitingPresentation)
            return;
        this.frameAwaitingPresentation = false;
        this.presentedFrameCount++;
        this.handlePresentedFrameState();
    }
    destroy() {
        if (this.destroyed)
            return;
        this.playbackGeneration++;
        this.stopDecoder();
        this.stopAudio();
        this.isPaused = true;
        this.destroyed = true;
        activeVideos.delete(this.registryReference);
    }
    startDecoder(startTime) {
        this.stopDecoder();
        const decoder = this.dependencies.createDecoder({
            ...this.options,
            fps: this.decoderFrameRate(),
            startTime,
            endTime: this.segmentEnd,
            playbackRate: this.playbackRateValue,
            sourcePaced: this.options.ffmpeg?.inputPacing === "source" ||
                this.options.mediaType === "live",
            inputArgs: this.options.ffmpeg?.inputArgs,
            outputArgs: this.options.ffmpeg?.videoOutputArgs,
        });
        try {
            decoder.open(this.decodedSource);
            this.decoder = decoder;
            this.lastBackend = decoder.backend();
            if (this.options.mediaType === "live") {
                this.livePresentationDeadlineMs =
                    performance.now() + LIVE_PRESENTATION_STALL_TIMEOUT_MS;
            }
        }
        catch (error) {
            decoder.close();
            throw error;
        }
    }
    // D3D11VA cannot decode the 4:2:2/4:4:4 H.264 fixtures in hardware. Limiting
    // their pre-scale output rate avoids an unbounded A/V lag in the CPU path.
    decoderFrameRate() {
        const sourcePixels = this.videoWidth * this.videoHeight;
        const needsSoftwareChromaConversion = process.platform === "win32" &&
            sourcePixels >= UHD_PIXEL_COUNT &&
            this.sourcePixelFormat !== undefined &&
            SOFTWARE_CHROMA_PIXEL_FORMAT.test(this.sourcePixelFormat);
        return needsSoftwareChromaConversion
            ? Math.min(this.fps, MAXIMUM_SOFTWARE_4K_FPS)
            : this.fps;
    }
    shouldUseAudio() {
        return this.options.audio !== false && this.dependencies.createAudio !== undefined;
    }
    async startPlaybackAt(startTime, generation) {
        if (this.options.mediaType === "live") {
            if (this.shouldUseAudio())
                await this.startAudio(startTime, generation);
            if (this.isPlaybackGenerationActive(generation))
                this.startDecoder(startTime);
            return;
        }
        this.startDecoder(startTime);
        const ready = await this.waitForDecoderReady(generation);
        if (!ready)
            return;
        if (this.shouldUseAudio())
            await this.startAudio(startTime, generation);
        if (!this.audio && this.isPlaybackGenerationActive(generation)) {
            this.ensureFilePlaybackClock(startTime);
        }
    }
    async waitForDecoderReady(generation) {
        const deadline = performance.now() + DECODER_START_TIMEOUT_MS;
        while (this.isPlaybackGenerationActive(generation)) {
            const decoder = this.decoder;
            if (!decoder)
                return false;
            const message = decoder.pollError();
            if (message)
                throw new Error(message);
            if (decoder.isReady())
                return true;
            if (decoder.isFinished()) {
                throw new Error("Video decoder ended before producing its first frame");
            }
            if (performance.now() >= deadline) {
                throw new Error(`Video decoder did not produce a frame within ${DECODER_START_TIMEOUT_MS / 1000} seconds`);
            }
            await new Promise((resolve) => setTimeout(resolve, DECODER_READY_POLL_MS));
        }
        return false;
    }
    isPlaybackGenerationActive(generation) {
        return generation === this.playbackGeneration && !this.destroyed && !this.isPaused;
    }
    ensureFilePlaybackClock(startTime) {
        if (this.playbackClockStartedAtMs !== undefined)
            return;
        this.playbackClockStartSeconds = startTime;
        this.playbackClockStartedAtMs = performance.now();
    }
    filePlaybackClockTime() {
        if (this.options.mediaType === "live" ||
            this.playbackClockStartedAtMs === undefined ||
            this.isPaused)
            return undefined;
        const elapsedSeconds = (performance.now() - this.playbackClockStartedAtMs) / 1000;
        return this.clampFileTime(this.playbackClockStartSeconds + elapsedSeconds * this.playbackRateValue);
    }
    async startAudio(startTime, generation) {
        this.stopAudio();
        this.lastAudioError = null;
        const audio = this.dependencies.createAudio(this.decodedSource, startTime, this.audioVolume, this.audioMuted, this.playbackRateValue, this.options.ffmpeg?.inputArgs ?? [], this.options.ffmpeg?.audioOutputArgs ?? [], this.segmentEnd);
        this.audio = audio;
        try {
            await audio.play();
            if (generation !== this.playbackGeneration || this.destroyed || this.isPaused) {
                audio.destroy();
                if (this.audio === audio)
                    this.audio = undefined;
            }
        }
        catch (error) {
            this.lastAudioError = asError(error);
            audio.destroy();
            if (this.audio === audio)
                this.audio = undefined;
        }
    }
    async restartWithAudio(startTime, generation) {
        try {
            this.stopDecoder();
            await this.startPlaybackAt(startTime, generation);
        }
        catch (error) {
            if (generation !== this.playbackGeneration || this.destroyed)
                return;
            this.lastError = asError(error);
            this.isPaused = true;
            this.stopDecoder();
            this.stopAudio();
            this.emit("error");
        }
    }
    stopAudio() {
        this.audio?.destroy();
        this.audio = undefined;
    }
    takeSynchronizedFrame(masterTime) {
        let frame = this.pendingFrame ?? this.decoder?.pollNext() ?? null;
        let selected = null;
        this.pendingFrame = null;
        this.positionSeconds = masterTime;
        while (frame) {
            const frameTime = frame.timestampUs / 1_000_000;
            const offsetSeconds = frameTime - masterTime;
            if (offsetSeconds > AUDIO_FRAME_LEAD_SECONDS) {
                this.pendingFrame = frame;
                if (!selected)
                    this.syncOffsetMilliseconds = offsetSeconds * 1000;
                break;
            }
            if (selected)
                this.skippedFrameCount++;
            selected = frame;
            frame = this.decoder?.pollNext() ?? null;
        }
        if (selected) {
            this.syncOffsetMilliseconds =
                (selected.timestampUs / 1_000_000 - masterTime) * 1000;
            this.requestDecoderCatchUp(selected, masterTime);
        }
        return selected;
    }
    requestDecoderCatchUp(frame, audioTime) {
        if (this.options.mediaType === "live" || !this.decoder)
            return;
        if (this.catchUpTargetUs !== undefined &&
            frame.timestampUs >= this.catchUpTargetUs) {
            this.catchUpTargetUs = undefined;
        }
        if (this.catchUpTargetUs !== undefined)
            return;
        const maximumLagSeconds = Math.max(MINIMUM_CATCH_UP_LAG_SECONDS, CATCH_UP_LAG_FRAMES / this.fps);
        const frameTime = frame.timestampUs / 1_000_000;
        if (frameTime >= audioTime - maximumLagSeconds)
            return;
        const targetSeconds = Math.max(this.segmentStart, audioTime - AUDIO_FRAME_LEAD_SECONDS);
        this.catchUpTargetUs = Math.round(targetSeconds * 1_000_000);
        this.pendingFrame = null;
        this.decoder.catchUpTo(this.catchUpTargetUs);
    }
    takeNewestDecodedFrame() {
        const pending = this.pendingFrame;
        const latest = this.decoder?.pollLatest() ?? null;
        this.pendingFrame = null;
        let selected = latest ?? pending;
        if (pending && latest) {
            this.skippedFrameCount++;
            selected = latest.timestampUs >= pending.timestampUs ? latest : pending;
        }
        if (selected)
            this.positionSeconds = selected.timestampUs / 1_000_000;
        this.syncOffsetMilliseconds = 0;
        return selected;
    }
    stopDecoder() {
        this.pendingFrame = null;
        this.catchUpTargetUs = undefined;
        this.playbackClockStartedAtMs = undefined;
        this.livePresentationDeadlineMs = 0;
        this.frameAwaitingPresentation = false;
        if (!this.decoder)
            return;
        this.decodedFrameBase += this.decoder.decodedFrames();
        this.droppedFrameBase += this.decoder.droppedFrames();
        this.skippedFrameBase += this.decoder.skippedFrames();
        this.lastBackend = this.decoder.backend();
        this.decoder.close();
        this.decoder = undefined;
    }
    setModalState(active) {
        // Native audio and the decoder keep their own clocks/threads. Modal RAF
        // continues presenting the newest frame due on that same audio clock.
        void active;
    }
    pauseInternal(dispatch) {
        if (this.isPaused)
            return;
        this.positionSeconds = this.currentTime;
        this.playbackGeneration++;
        this.stopDecoder();
        this.stopAudio();
        this.isPaused = true;
        if (dispatch)
            this.emit("pause");
    }
    async restartPlayback(startTime) {
        const generation = ++this.playbackGeneration;
        this.stopDecoder();
        this.stopAudio();
        this.positionSeconds = startTime;
        this.hasEnded = false;
        try {
            await this.startPlaybackAt(startTime, generation);
        }
        catch (error) {
            if (generation !== this.playbackGeneration || this.destroyed)
                return;
            this.lastError = asError(error);
            this.isPaused = true;
            this.stopDecoder();
            this.stopAudio();
            this.emit("error");
        }
    }
    clampFileTime(value) {
        return Math.min(this.segmentEnd ?? Number.POSITIVE_INFINITY, Math.max(this.segmentStart, value));
    }
    resetReadiness() {
        this.readyStateValue = 0;
        this.metadataDispatched = false;
        this.dataDispatched = false;
        this.playingDispatched = false;
        this.metadataPromise = undefined;
    }
    resetSourceState() {
        this.sourceGeneration++;
        this.positionSeconds = this.segmentStart;
        this.hasEnded = false;
        this.lastBackend = "not started";
        this.lastError = null;
        this.lastAudioError = null;
        this.decodedFrameBase = 0;
        this.droppedFrameBase = 0;
        this.skippedFrameBase = 0;
        this.presentedFrameCount = 0;
        this.skippedFrameCount = 0;
        this.syncOffsetMilliseconds = 0;
        this.reconnectAttempt = 0;
        this.reconnectAtMs = 0;
        this.sourcePixelFormat = undefined;
        this.videoWidth = this.width;
        this.videoHeight = this.height;
        this.durationValue = this.options.mediaType === "live"
            ? Number.POSITIVE_INFINITY
            : (this.segmentEnd ?? Number.NaN);
        this.lastTimeUpdateMs = Number.NEGATIVE_INFINITY;
        this.resetReadiness();
    }
    loadMetadataInBackground() {
        const sourceGeneration = this.sourceGeneration;
        void this.ensureMetadata().catch((error) => {
            if (this.destroyed || sourceGeneration !== this.sourceGeneration)
                return;
            this.lastError = asError(error);
            this.emit("error");
        });
    }
    ensureMetadata() {
        if (this.metadataPromise)
            return this.metadataPromise;
        const sourceGeneration = this.sourceGeneration;
        const source = this.decodedSource;
        this.metadataPromise = (async () => {
            if (this.options.mediaType !== "live" &&
                this.dependencies.probeMetadata) {
                const ffmpegPath = resolveFfmpegPath({ explicitPath: this.options.ffmpegPath });
                const metadata = await this.dependencies.probeMetadata(source, ffmpegPath, this.options.ffmpeg?.inputArgs ?? []);
                if (this.destroyed || sourceGeneration !== this.sourceGeneration)
                    return;
                if (metadata?.width)
                    this.videoWidth = metadata.width;
                if (metadata?.height)
                    this.videoHeight = metadata.height;
                this.sourcePixelFormat = metadata?.pixelFormat;
                if (this.segmentEnd !== undefined) {
                    this.durationValue = this.segmentEnd;
                }
                else if (metadata?.duration !== undefined) {
                    this.durationValue = metadata.duration;
                }
            }
            if (!this.metadataDispatched &&
                !this.destroyed &&
                sourceGeneration === this.sourceGeneration) {
                this.readyStateValue = 1;
                this.metadataDispatched = true;
                this.emit("loadedmetadata");
            }
        })();
        return this.metadataPromise;
    }
    handlePresentedFrameState() {
        this.lastError = null;
        if (this.options.mediaType === "live") {
            this.livePresentationDeadlineMs =
                performance.now() + LIVE_PRESENTATION_STALL_TIMEOUT_MS;
        }
        if (!this.dataDispatched) {
            this.dataDispatched = true;
            this.readyStateValue = 4;
            this.emit("loadeddata");
            this.emit("canplay");
            this.emit("canplaythrough");
        }
        if (!this.playingDispatched && !this.isPaused) {
            this.playingDispatched = true;
            this.emit("playing");
        }
        this.reconnectAttempt = 0;
        this.reconnectAtMs = 0;
        const now = performance.now();
        if (now - this.lastTimeUpdateMs >= 250) {
            this.lastTimeUpdateMs = now;
            this.emit("timeupdate");
        }
    }
    recoverStalledLiveVideo() {
        if (this.options.mediaType !== "live" ||
            this.livePresentationDeadlineMs === 0 ||
            performance.now() < this.livePresentationDeadlineMs)
            return false;
        this.lastError = new Error(`Live video produced no presented frame for ${LIVE_PRESENTATION_STALL_TIMEOUT_MS / 1000} seconds`);
        this.stopDecoder();
        this.emit("error");
        if (this.options.reconnect !== false)
            this.scheduleReconnect();
        else
            this.isPaused = true;
        return true;
    }
    scheduleReconnect() {
        this.playingDispatched = false;
        const reconnect = this.options.reconnect || {};
        const initialDelay = reconnect.initialDelayMs ?? 500;
        const maxDelay = reconnect.maxDelayMs ?? 5_000;
        const delay = Math.min(maxDelay, initialDelay * 2 ** this.reconnectAttempt);
        this.reconnectAttempt++;
        this.reconnectAtMs = performance.now() + delay;
    }
    tryReconnect() {
        if (this.destroyed ||
            this.isPaused ||
            this.options.mediaType !== "live" ||
            this.options.reconnect === false ||
            this.reconnectAtMs === 0 ||
            performance.now() < this.reconnectAtMs)
            return;
        this.reconnectAtMs = 0;
        try {
            this.startDecoder(0);
        }
        catch (error) {
            this.lastError = asError(error);
            this.emit("error");
            this.scheduleReconnect();
        }
    }
    emit(type) {
        const event = new Event(type);
        this.dispatchEvent(event);
        const handler = this[`on${type}`];
        if (typeof handler === "function") {
            handler?.call(this, event);
        }
    }
    assertUsable() {
        if (this.destroyed)
            throw new Error("NativeVideo has been destroyed");
    }
}
export class VideoFpsMeter {
    startedAtMs;
    frameCount = 0;
    sampleWindowMs;
    constructor(sampleWindowMs = 500) {
        if (sampleWindowMs <= 0) {
            throw new Error("FPS sample window must be positive");
        }
        this.sampleWindowMs = sampleWindowMs;
    }
    observe(timestampMs) {
        if (this.startedAtMs === undefined) {
            this.startedAtMs = timestampMs;
            this.frameCount = 0;
            return null;
        }
        this.frameCount++;
        const elapsedMs = timestampMs - this.startedAtMs;
        if (elapsedMs < this.sampleWindowMs)
            return null;
        const fps = (this.frameCount * 1000) / elapsedMs;
        this.startedAtMs = timestampMs;
        this.frameCount = 0;
        return fps;
    }
}
function asError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
