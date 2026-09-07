import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { Howl } from "../audio/index.ts";
import { nativeAudioEngine } from "../audio/NativeAudioEngine.ts";
import { parseMediaSource, redactMediaSource } from "./mediaSource.ts";
import {
    loadNativeVideo,
    resolveNativePlatformModules,
} from "../runtime/platformNative.ts";

const AUDIO_FRAME_LEAD_SECONDS = 0.02;
const DECODER_READY_POLL_MS = 5;
const DECODER_START_TIMEOUT_MS = 10_000;
const LIVE_PRESENTATION_STALL_TIMEOUT_MS = 5_000;
const MINIMUM_CATCH_UP_LAG_SECONDS = 0.1;
const CATCH_UP_LAG_FRAMES = 3;
const MAXIMUM_SOFTWARE_4K_FPS = 30;
const UHD_PIXEL_COUNT = 3840 * 2160;
const SOFTWARE_CHROMA_PIXEL_FORMAT = /^yuv(?:422|444)p/;

export interface Nv12FrameLayout {
    readonly yBytes: number;
    readonly uvBytes: number;
    readonly frameBytes: number;
    readonly yStride: number;
    readonly uvStride: number;
}

export interface NativeVideoFrame {
    readonly width: number;
    readonly height: number;
    readonly timestampUs: number;
    readonly y: Uint8Array;
    readonly uv: Uint8Array;
    readonly yStride: number;
    readonly uvStride: number;
    readonly pixelFormat: "nv12";
}

interface NativePackedVideoFrame {
    readonly width: number;
    readonly height: number;
    readonly timestampUs: number;
    readonly data: Uint8Array;
}

interface NativeDecoderBinding {
    open(source: string): void;
    pollLatest(): NativePackedVideoFrame | null;
    pollNext(): NativePackedVideoFrame | null;
    queuedFrames(): number;
    catchUpTo(timestampUs: number): void;
    pollError(): string | null;
    backend(): string;
    decodedFrames(): number;
    droppedFrames(): number;
    skippedFrames(): number;
    isFinished(): boolean;
    close(): void;
}

interface NativeVideoModule {
    NativeVideoDecoder: new (
        options: {
            width: number;
            height: number;
            fps: number;
            startTime: number;
            ffmpegPath: string;
            vaapiDevice?: string;
            playbackRate: number;
            endTime?: number;
            sourcePaced?: boolean;
            inputArgs?: string[];
            outputArgs?: string[];
        },
    ) => NativeDecoderBinding;
}

export interface NativeVideoOptions {
    readonly width: number;
    readonly height: number;
    readonly fps?: number;
    readonly ffmpegPath?: string;
    readonly vaapiDevice?: string;
    readonly audio?: boolean;
    readonly volume?: number;
    readonly muted?: boolean;
    readonly loop?: boolean;
    readonly playbackRate?: number;
    readonly mediaType?: "file" | "live";
    readonly ffmpeg?: NativeVideoFfmpegOptions;
    readonly reconnect?: false | NativeVideoReconnectOptions;
}

export interface NativeVideoFfmpegOptions {
    readonly inputArgs?: readonly string[];
    readonly videoOutputArgs?: readonly string[];
    readonly audioOutputArgs?: readonly string[];
    readonly inputPacing?: "media" | "source";
}

export interface NativeVideoReconnectOptions {
    readonly initialDelayMs?: number;
    readonly maxDelayMs?: number;
}

export interface NativeVideoDecoderOptions extends NativeVideoOptions {
    readonly startTime?: number;
    readonly endTime?: number;
    readonly sourcePaced?: boolean;
    readonly inputArgs?: readonly string[];
    readonly outputArgs?: readonly string[];
}

export interface NativeVideoStats {
    readonly decodedFrames: number;
    readonly presentedFrames: number;
    readonly droppedFrames: number;
    readonly skippedFrames: number;
    readonly queuedFrames: number;
    readonly syncOffsetMs: number;
    readonly bytesPerFrame: number;
}

export interface NativeVideoDecoderLike {
    open(source: string): void;
    pollLatest(): NativeVideoFrame | null;
    pollNext(): NativeVideoFrame | null;
    queuedFrames(): number;
    catchUpTo(timestampUs: number): void;
    isReady(): boolean;
    pollError(): string | null;
    backend(): string;
    decodedFrames(): number;
    droppedFrames(): number;
    skippedFrames(): number;
    isFinished(): boolean;
    close(): void;
}

export interface NativeVideoDependencies {
    createDecoder(options: NativeVideoDecoderOptions): NativeVideoDecoderLike;
    createAudio?(
        source: string,
        startTime: number,
        volume: number,
        muted: boolean,
        playbackRate: number,
        inputArgs: readonly string[],
        outputArgs: readonly string[],
        endTime?: number,
    ): NativeVideoAudioLike;
}

interface NativeVideoInternalDependencies extends NativeVideoDependencies {
    probeMetadata?(
        source: string,
        ffmpegPath: string,
        inputArgs: readonly string[],
    ): Promise<ProbedMetadata | null>;
}

export interface NativeVideoAudioLike {
    readonly currentTime: number;
    readonly ended: boolean;
    volume: number;
    muted: boolean;
    play(): Promise<void>;
    destroy(): void;
}

export interface ResolveFfmpegPathOptions {
    readonly explicitPath?: string;
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    readonly environment?: NodeJS.ProcessEnv;
    readonly pathExists?: (path: string) => boolean;
}

export function getNv12FrameLayout(
    width: number,
    height: number,
): Nv12FrameLayout {
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

export function splitNv12Frame(
    frame: NativePackedVideoFrame,
): NativeVideoFrame {
    const layout = getNv12FrameLayout(frame.width, frame.height);
    if (frame.data.byteLength !== layout.frameBytes) {
        throw new Error(
            `NV12 frame has ${frame.data.byteLength} bytes; expected ${layout.frameBytes}`,
        );
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

export function convertBt709LimitedNv12SampleToRgb(
    rawY: number,
    rawU: number,
    rawV: number,
): readonly [number, number, number] {
    const y = (rawY / 255 - 16 / 255) * (255 / 219);
    const u = (rawU / 255 - 128 / 255) * (255 / 224);
    const v = (rawV / 255 - 128 / 255) * (255 / 224);
    const clamp = (value: number): number => Math.min(1, Math.max(0, value));
    return [
        clamp(y + 1.5748 * v),
        clamp(y - 0.1873 * u - 0.4681 * v),
        clamp(y + 1.8556 * u),
    ];
}

export function getBundledFfmpegPath(
    platform: NodeJS.Platform = process.platform,
    arch: string = process.arch,
): string {
    return resolveNativePlatformModules(platform, arch).ffmpeg;
}

export function resolveFfmpegPath(
    options: ResolveFfmpegPathOptions = {},
): string {
    const explicitPath = options.explicitPath?.trim();
    if (explicitPath) return explicitPath;

    const environment = options.environment ?? process.env;
    const environmentPath = environment.FFMPEG_PATH?.trim();
    if (environmentPath) return environmentPath;

    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    const bundledPath = getBundledFfmpegPath(platform, arch);
    const pathExists = options.pathExists ?? existsSync;
    return pathExists(bundledPath) ? bundledPath : "ffmpeg";
}

function resolveFfprobePath(ffmpegPath: string): string {
    if (ffmpegPath === "ffmpeg") return "ffprobe";
    const executable = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    return join(dirname(ffmpegPath), executable);
}

interface ProbedMetadata {
    readonly duration?: number;
    readonly width?: number;
    readonly height?: number;
    readonly pixelFormat?: string;
}

function probeMedia(
    source: string,
    ffmpegPath: string,
    inputArgs: readonly string[],
): Promise<ProbedMetadata | null> {
    return new Promise((resolve) => {
        execFile(
            resolveFfprobePath(ffmpegPath),
            [
                "-v", "error",
                ...inputArgs,
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,pix_fmt:format=duration",
                "-of", "json",
                "-i", source,
            ],
            { windowsHide: true, timeout: 5_000 },
            (error, stdout) => {
                if (error) {
                    void redactMediaSource(error.message);
                    resolve(null);
                    return;
                }
                try {
                    const data = JSON.parse(stdout) as {
                        format?: { duration?: string };
                        streams?: Array<{
                            width?: number;
                            height?: number;
                            pix_fmt?: string;
                        }>;
                    };
                    const duration = Number(data.format?.duration);
                    resolve({
                        duration: Number.isFinite(duration) ? duration : undefined,
                        width: data.streams?.[0]?.width,
                        height: data.streams?.[0]?.height,
                        pixelFormat: data.streams?.[0]?.pix_fmt,
                    });
                } catch {
                    resolve(null);
                }
            },
        );
    });
}

export class NativeVideoDecoder implements NativeVideoDecoderLike {
    private readonly decoder: NativeDecoderBinding;

    public constructor(options: NativeVideoDecoderOptions) {
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

        const nativeVideo = loadNativeVideo<NativeVideoModule>();
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

    public open(source: string): void {
        this.decoder.open(source);
    }

    public pollLatest(): NativeVideoFrame | null {
        const frame = this.decoder.pollLatest();
        return frame ? splitNv12Frame(frame) : null;
    }

    public pollNext(): NativeVideoFrame | null {
        const frame = this.decoder.pollNext();
        return frame ? splitNv12Frame(frame) : null;
    }

    public queuedFrames(): number {
        return this.decoder.queuedFrames();
    }

    public catchUpTo(timestampUs: number): void {
        this.decoder.catchUpTo(timestampUs);
    }

    public isReady(): boolean {
        return this.decoder.queuedFrames() > 0;
    }

    public pollError(): string | null {
        return this.decoder.pollError();
    }

    public backend(): string {
        return this.decoder.backend();
    }

    public decodedFrames(): number {
        return this.decoder.decodedFrames();
    }

    public droppedFrames(): number {
        return this.decoder.droppedFrames();
    }

    public skippedFrames(): number {
        return this.decoder.skippedFrames();
    }

    public isFinished(): boolean {
        return this.decoder.isFinished();
    }

    public close(): void {
        this.decoder.close();
    }
}

const DEFAULT_DEPENDENCIES: NativeVideoInternalDependencies = {
    createDecoder: (options) => new NativeVideoDecoder(options),
    createAudio: (source, startTime, volume, muted, playbackRate, inputArgs, outputArgs, endTime) =>
        new HowlVideoAudio(source, startTime, volume, muted, playbackRate, inputArgs, outputArgs, endTime),
    probeMetadata: probeMedia,
};

class HowlVideoAudio implements NativeVideoAudioLike {
    private readonly howl: Howl;
    private readonly startTime: number;
    private id = -1;
    private hasEnded = false;
    private currentVolume: number;
    private currentMuted: boolean;

    public constructor(
        source: string,
        startTime: number,
        volume: number,
        muted: boolean,
        playbackRate: number,
        inputArgs: readonly string[],
        outputArgs: readonly string[],
        endTime?: number,
    ) {
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

    public get currentTime(): number {
        return this.id === -1
            ? 0
            : this.startTime + (this.howl.seek(this.id) as number);
    }

    public get ended(): boolean {
        return this.hasEnded;
    }

    public get volume(): number {
        return this.currentVolume;
    }

    public set volume(value: number) {
        this.currentVolume = value;
        this.howl.volume(value, this.id === -1 ? undefined : this.id);
    }

    public get muted(): boolean {
        return this.currentMuted;
    }

    public set muted(value: boolean) {
        this.currentMuted = value;
        this.howl.mute(value, this.id === -1 ? undefined : this.id);
    }

    public play(): Promise<void> {
        return new Promise((resolve, reject) => {
            const onPlay = (): void => resolve();
            const onError = (_id?: number, message?: string): void =>
                reject(new Error(message ?? "Video audio failed to start"));
            this.howl.once("play", onPlay);
            this.howl.once("playerror", onError);
            this.howl.once("end", () => { this.hasEnded = true; });
            this.id = this.howl.play("__video");
            if (this.id === -1) reject(new Error("Video audio failed to start"));
        });
    }

    public destroy(): void {
        this.howl.unload();
    }
}

export type NativeVideoEventType =
    | "emptied"
    | "loadedmetadata"
    | "loadeddata"
    | "canplay"
    | "canplaythrough"
    | "play"
    | "playing"
    | "pause"
    | "timeupdate"
    | "seeked"
    | "ended"
    | "error";

type NativeVideoEventHandler = ((this: NativeVideo, event: Event) => void) | null;

const activeVideos = new Set<WeakRef<NativeVideo>>();

export function setNativeVideoModalState(active: boolean): void {
    for (const reference of activeVideos) {
        const video = reference.deref();
        if (video) video.setModalState(active);
        else activeVideos.delete(reference);
    }
}

export class NativeVideo extends EventTarget {
    public readonly width: number;
    public readonly height: number;
    public readonly fps: number;
    public videoWidth: number;
    public videoHeight: number;

    public onemptied: NativeVideoEventHandler = null;
    public onloadedmetadata: NativeVideoEventHandler = null;
    public onloadeddata: NativeVideoEventHandler = null;
    public oncanplay: NativeVideoEventHandler = null;
    public oncanplaythrough: NativeVideoEventHandler = null;
    public onplay: NativeVideoEventHandler = null;
    public onplaying: NativeVideoEventHandler = null;
    public onpause: NativeVideoEventHandler = null;
    public ontimeupdate: NativeVideoEventHandler = null;
    public onseeked: NativeVideoEventHandler = null;
    public onended: NativeVideoEventHandler = null;
    public onerror: NativeVideoEventHandler = null;

    private readonly options: NativeVideoOptions;
    private readonly dependencies: NativeVideoInternalDependencies;
    private decoder?: NativeVideoDecoderLike;
    private positionSeconds = 0;
    private isPaused = true;
    private hasEnded = false;
    private destroyed = false;
    private lastBackend = "not started";
    private lastError: Error | null = null;
    private decodedFrameBase = 0;
    private droppedFrameBase = 0;
    private skippedFrameBase = 0;
    private presentedFrameCount = 0;
    private skippedFrameCount = 0;
    private syncOffsetMilliseconds = 0;
    private audio?: NativeVideoAudioLike;
    private playbackClockStartedAtMs?: number;
    private playbackClockStartSeconds = 0;
    private lastAudioError: Error | null = null;
    private pendingFrame: NativeVideoFrame | null = null;
    private catchUpTargetUs?: number;
    private audioVolume: number;
    private audioMuted: boolean;
    private playbackGeneration = 0;
    private sourceValue: string;
    private decodedSource: string;
    private segmentStart = 0;
    private segmentEnd?: number;
    private playbackRateValue: number;
    private loopValue: boolean;
    private readyStateValue = 0;
    private durationValue: number;
    private sourcePixelFormat?: string;
    private metadataDispatched = false;
    private dataDispatched = false;
    private playingDispatched = false;
    private lastTimeUpdateMs = Number.NEGATIVE_INFINITY;
    private reconnectAttempt = 0;
    private reconnectAtMs = 0;
    private livePresentationDeadlineMs = 0;
    private frameAwaitingPresentation = false;
    private readonly registryReference: WeakRef<NativeVideo>;
    private metadataPromise?: Promise<void>;
    private sourceGeneration = 0;

    public constructor(
        src: string,
        options: NativeVideoOptions,
        dependencies: NativeVideoDependencies = DEFAULT_DEPENDENCIES,
    ) {
        super();
        if (!src) throw new Error("Video source must not be empty");
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
        this.dependencies = dependencies as NativeVideoInternalDependencies;
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

    public get src(): string {
        return this.sourceValue;
    }

    public set src(value: string) {
        this.replaceSource(value, !this.isPaused);
    }

    private replaceSource(value: string, resumePlayback: boolean): void {
        this.assertUsable();
        if (!value) throw new Error("Video source must not be empty");
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
        } else {
            this.loadMetadataInBackground();
        }
    }

    public get currentSrc(): string {
        return this.decodedSource;
    }

    public get duration(): number {
        return this.durationValue;
    }

    public get readyState(): number {
        return this.readyStateValue;
    }

    public get loop(): boolean {
        return this.loopValue;
    }

    public set loop(value: boolean) {
        this.loopValue = Boolean(value);
    }

    public get playbackRate(): number {
        return this.playbackRateValue;
    }

    public set playbackRate(value: number) {
        this.assertUsable();
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError("Video playbackRate must be positive and finite");
        }
        if (this.options.mediaType === "live" && value !== 1) {
            throw new Error("Live video only supports playbackRate 1");
        }
        if (value === this.playbackRateValue) return;
        const position = this.currentTime;
        this.playbackRateValue = value;
        if (!this.isPaused) void this.restartPlayback(position);
    }

    public get paused(): boolean {
        return this.isPaused;
    }

    public get ended(): boolean {
        return this.hasEnded;
    }

    public get backend(): string {
        return this.decoder?.backend() ?? this.lastBackend;
    }

    public get error(): Error | null {
        return this.lastError;
    }

    public get audioError(): Error | null {
        return this.lastAudioError;
    }

    public get reconnecting(): boolean {
        return this.reconnectAtMs > 0;
    }

    public get reconnectAttempts(): number {
        return this.reconnectAttempt;
    }

    public get volume(): number {
        return this.audio?.volume ?? this.audioVolume;
    }

    public set volume(value: number) {
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            throw new RangeError("Video volume must be between 0 and 1");
        }
        this.audioVolume = value;
        if (this.audio) this.audio.volume = value;
    }

    public get muted(): boolean {
        return this.audio?.muted ?? this.audioMuted;
    }

    public set muted(value: boolean) {
        this.audioMuted = value;
        if (this.audio) this.audio.muted = value;
    }

    public get currentTime(): number {
        return this.audio && !this.audio.ended
            ? this.audio.currentTime
            : (this.filePlaybackClockTime() ?? this.positionSeconds);
    }

    public set currentTime(value: number) {
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
                } else {
                    this.startDecoder(value);
                }
            } catch (error) {
                this.isPaused = true;
                this.lastError = asError(error);
                throw this.lastError;
            }
        }
        this.emit("timeupdate");
        queueMicrotask(() => {
            if (!this.destroyed) this.emit("seeked");
        });
    }

    public get stats(): NativeVideoStats {
        const layout = getNv12FrameLayout(this.width, this.height);
        return {
            decodedFrames:
                this.decodedFrameBase + (this.decoder?.decodedFrames() ?? 0),
            presentedFrames: this.presentedFrameCount,
            droppedFrames:
                this.droppedFrameBase + (this.decoder?.droppedFrames() ?? 0),
            skippedFrames:
                this.skippedFrameBase +
                this.skippedFrameCount +
                (this.decoder?.skippedFrames() ?? 0),
            queuedFrames:
                (this.decoder?.queuedFrames() ?? 0) + (this.pendingFrame ? 1 : 0),
            syncOffsetMs: this.syncOffsetMilliseconds,
            bytesPerFrame: layout.frameBytes,
        };
    }

    public async play(): Promise<void> {
        this.assertUsable();
        if (!this.isPaused) return;
        void this.ensureMetadata();
        if (this.hasEnded) this.positionSeconds = this.segmentStart;

        this.hasEnded = false;
        this.lastError = null;
        this.isPaused = false;
        this.emit("play");
        const generation = ++this.playbackGeneration;
        try {
            await this.ensureMetadata();
            if (generation !== this.playbackGeneration || this.isPaused) return;
            await this.startPlaybackAt(this.positionSeconds, generation);
        } catch (error) {
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

    public pause(): void {
        this.assertUsable();
        this.pauseInternal(true);
    }

    public load(): void {
        this.replaceSource(this.sourceValue, false);
    }

    public takeLatestFrame(): NativeVideoFrame | null {
        if (this.destroyed) return null;
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
            } else {
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

        if (
            this.decoder.isFinished() &&
            this.pendingFrame === null &&
            this.decoder.queuedFrames() === 0
        ) {
            if (this.options.mediaType === "live") {
                this.stopDecoder();
                this.lastError = new Error("Live video stream ended");
                this.emit("error");
                if (this.options.reconnect !== false) this.scheduleReconnect();
                else this.isPaused = true;
                return null;
            }
            if (!this.audio || this.audio.ended) {
                this.stopDecoder();
                this.stopAudio();
                if (this.loopValue) {
                    this.positionSeconds = this.segmentStart;
                    void this.restartPlayback(this.segmentStart);
                } else {
                    this.positionSeconds = this.segmentEnd ?? this.positionSeconds;
                    this.emit("timeupdate");
                    this.isPaused = true;
                    this.hasEnded = true;
                    this.emit("pause");
                    this.emit("ended");
                }
            }
        }
        if (this.recoverStalledLiveVideo()) return null;
        this.tryReconnect();
        return null;
    }

    public markFramePresented(): void {
        if (this.destroyed || !this.frameAwaitingPresentation) return;
        this.frameAwaitingPresentation = false;
        this.presentedFrameCount++;
        this.handlePresentedFrameState();
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.playbackGeneration++;
        this.stopDecoder();
        this.stopAudio();
        this.isPaused = true;
        this.destroyed = true;
        activeVideos.delete(this.registryReference);
    }

    private startDecoder(startTime: number): void {
        this.stopDecoder();
        const decoder = this.dependencies.createDecoder({
            ...this.options,
            fps: this.decoderFrameRate(),
            startTime,
            endTime: this.segmentEnd,
            playbackRate: this.playbackRateValue,
            sourcePaced:
                this.options.ffmpeg?.inputPacing === "source" ||
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
        } catch (error) {
            decoder.close();
            throw error;
        }
    }

    // D3D11VA cannot decode the 4:2:2/4:4:4 H.264 fixtures in hardware. Limiting
    // their pre-scale output rate avoids an unbounded A/V lag in the CPU path.
    private decoderFrameRate(): number {
        const sourcePixels = this.videoWidth * this.videoHeight;
        const needsSoftwareChromaConversion =
            process.platform === "win32" &&
            sourcePixels >= UHD_PIXEL_COUNT &&
            this.sourcePixelFormat !== undefined &&
            SOFTWARE_CHROMA_PIXEL_FORMAT.test(this.sourcePixelFormat);
        return needsSoftwareChromaConversion
            ? Math.min(this.fps, MAXIMUM_SOFTWARE_4K_FPS)
            : this.fps;
    }

    private shouldUseAudio(): boolean {
        return this.options.audio !== false && this.dependencies.createAudio !== undefined;
    }

    private async startPlaybackAt(startTime: number, generation: number): Promise<void> {
        if (this.options.mediaType === "live") {
            if (this.shouldUseAudio()) await this.startAudio(startTime, generation);
            if (this.isPlaybackGenerationActive(generation)) this.startDecoder(startTime);
            return;
        }

        this.startDecoder(startTime);
        const ready = await this.waitForDecoderReady(generation);
        if (!ready) return;
        if (this.shouldUseAudio()) await this.startAudio(startTime, generation);
        if (!this.audio && this.isPlaybackGenerationActive(generation)) {
            this.ensureFilePlaybackClock(startTime);
        }
    }

    private async waitForDecoderReady(generation: number): Promise<boolean> {
        const deadline = performance.now() + DECODER_START_TIMEOUT_MS;
        while (this.isPlaybackGenerationActive(generation)) {
            const decoder = this.decoder;
            if (!decoder) return false;
            const message = decoder.pollError();
            if (message) throw new Error(message);
            if (decoder.isReady()) return true;
            if (decoder.isFinished()) {
                throw new Error("Video decoder ended before producing its first frame");
            }
            if (performance.now() >= deadline) {
                throw new Error(
                    `Video decoder did not produce a frame within ${DECODER_START_TIMEOUT_MS / 1000} seconds`,
                );
            }
            await new Promise<void>((resolve) => setTimeout(resolve, DECODER_READY_POLL_MS));
        }
        return false;
    }

    private isPlaybackGenerationActive(generation: number): boolean {
        return generation === this.playbackGeneration && !this.destroyed && !this.isPaused;
    }

    private ensureFilePlaybackClock(startTime: number): void {
        if (this.playbackClockStartedAtMs !== undefined) return;
        this.playbackClockStartSeconds = startTime;
        this.playbackClockStartedAtMs = performance.now();
    }

    private filePlaybackClockTime(): number | undefined {
        if (
            this.options.mediaType === "live" ||
            this.playbackClockStartedAtMs === undefined ||
            this.isPaused
        ) return undefined;
        const elapsedSeconds =
            (performance.now() - this.playbackClockStartedAtMs) / 1000;
        return this.clampFileTime(
            this.playbackClockStartSeconds + elapsedSeconds * this.playbackRateValue,
        );
    }

    private async startAudio(startTime: number, generation: number): Promise<void> {
        this.stopAudio();
        this.lastAudioError = null;
        const audio = this.dependencies.createAudio!(
            this.decodedSource,
            startTime,
            this.audioVolume,
            this.audioMuted,
            this.playbackRateValue,
            this.options.ffmpeg?.inputArgs ?? [],
            this.options.ffmpeg?.audioOutputArgs ?? [],
            this.segmentEnd,
        );
        this.audio = audio;
        try {
            await audio.play();
            if (generation !== this.playbackGeneration || this.destroyed || this.isPaused) {
                audio.destroy();
                if (this.audio === audio) this.audio = undefined;
            }
        } catch (error) {
            this.lastAudioError = asError(error);
            audio.destroy();
            if (this.audio === audio) this.audio = undefined;
        }
    }

    private async restartWithAudio(startTime: number, generation: number): Promise<void> {
        try {
            this.stopDecoder();
            await this.startPlaybackAt(startTime, generation);
        } catch (error) {
            if (generation !== this.playbackGeneration || this.destroyed) return;
            this.lastError = asError(error);
            this.isPaused = true;
            this.stopDecoder();
            this.stopAudio();
            this.emit("error");
        }
    }

    private stopAudio(): void {
        this.audio?.destroy();
        this.audio = undefined;
    }

    private takeSynchronizedFrame(masterTime: number): NativeVideoFrame | null {
        let frame = this.pendingFrame ?? this.decoder?.pollNext() ?? null;
        let selected: NativeVideoFrame | null = null;
        this.pendingFrame = null;
        this.positionSeconds = masterTime;

        while (frame) {
            const frameTime = frame.timestampUs / 1_000_000;
            const offsetSeconds = frameTime - masterTime;
            if (offsetSeconds > AUDIO_FRAME_LEAD_SECONDS) {
                this.pendingFrame = frame;
                if (!selected) this.syncOffsetMilliseconds = offsetSeconds * 1000;
                break;
            }

            if (selected) this.skippedFrameCount++;
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

    private requestDecoderCatchUp(frame: NativeVideoFrame, audioTime: number): void {
        if (this.options.mediaType === "live" || !this.decoder) return;
        if (
            this.catchUpTargetUs !== undefined &&
            frame.timestampUs >= this.catchUpTargetUs
        ) {
            this.catchUpTargetUs = undefined;
        }
        if (this.catchUpTargetUs !== undefined) return;

        const maximumLagSeconds = Math.max(
            MINIMUM_CATCH_UP_LAG_SECONDS,
            CATCH_UP_LAG_FRAMES / this.fps,
        );
        const frameTime = frame.timestampUs / 1_000_000;
        if (frameTime >= audioTime - maximumLagSeconds) return;

        const targetSeconds = Math.max(
            this.segmentStart,
            audioTime - AUDIO_FRAME_LEAD_SECONDS,
        );
        this.catchUpTargetUs = Math.round(targetSeconds * 1_000_000);
        this.pendingFrame = null;
        this.decoder.catchUpTo(this.catchUpTargetUs);
    }

    private takeNewestDecodedFrame(): NativeVideoFrame | null {
        const pending = this.pendingFrame;
        const latest = this.decoder?.pollLatest() ?? null;
        this.pendingFrame = null;

        let selected = latest ?? pending;
        if (pending && latest) {
            this.skippedFrameCount++;
            selected = latest.timestampUs >= pending.timestampUs ? latest : pending;
        }
        if (selected) this.positionSeconds = selected.timestampUs / 1_000_000;
        this.syncOffsetMilliseconds = 0;
        return selected;
    }

    private stopDecoder(): void {
        this.pendingFrame = null;
        this.catchUpTargetUs = undefined;
        this.playbackClockStartedAtMs = undefined;
        this.livePresentationDeadlineMs = 0;
        this.frameAwaitingPresentation = false;
        if (!this.decoder) return;
        this.decodedFrameBase += this.decoder.decodedFrames();
        this.droppedFrameBase += this.decoder.droppedFrames();
        this.skippedFrameBase += this.decoder.skippedFrames();
        this.lastBackend = this.decoder.backend();
        this.decoder.close();
        this.decoder = undefined;
    }

    public setModalState(active: boolean): void {
        // Native audio and the decoder keep their own clocks/threads. Modal RAF
        // continues presenting the newest frame due on that same audio clock.
        void active;
    }

    private pauseInternal(dispatch: boolean): void {
        if (this.isPaused) return;
        this.positionSeconds = this.currentTime;
        this.playbackGeneration++;
        this.stopDecoder();
        this.stopAudio();
        this.isPaused = true;
        if (dispatch) this.emit("pause");
    }

    private async restartPlayback(startTime: number): Promise<void> {
        const generation = ++this.playbackGeneration;
        this.stopDecoder();
        this.stopAudio();
        this.positionSeconds = startTime;
        this.hasEnded = false;
        try {
            await this.startPlaybackAt(startTime, generation);
        } catch (error) {
            if (generation !== this.playbackGeneration || this.destroyed) return;
            this.lastError = asError(error);
            this.isPaused = true;
            this.stopDecoder();
            this.stopAudio();
            this.emit("error");
        }
    }

    private clampFileTime(value: number): number {
        return Math.min(this.segmentEnd ?? Number.POSITIVE_INFINITY, Math.max(this.segmentStart, value));
    }

    private resetReadiness(): void {
        this.readyStateValue = 0;
        this.metadataDispatched = false;
        this.dataDispatched = false;
        this.playingDispatched = false;
        this.metadataPromise = undefined;
    }

    private resetSourceState(): void {
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

    private loadMetadataInBackground(): void {
        const sourceGeneration = this.sourceGeneration;
        void this.ensureMetadata().catch((error: unknown) => {
            if (this.destroyed || sourceGeneration !== this.sourceGeneration) return;
            this.lastError = asError(error);
            this.emit("error");
        });
    }

    private ensureMetadata(): Promise<void> {
        if (this.metadataPromise) return this.metadataPromise;
        const sourceGeneration = this.sourceGeneration;
        const source = this.decodedSource;
        this.metadataPromise = (async () => {
            if (
                this.options.mediaType !== "live" &&
                this.dependencies.probeMetadata
            ) {
                const ffmpegPath = resolveFfmpegPath({ explicitPath: this.options.ffmpegPath });
                const metadata = await this.dependencies.probeMetadata(
                    source,
                    ffmpegPath,
                    this.options.ffmpeg?.inputArgs ?? [],
                );
                if (this.destroyed || sourceGeneration !== this.sourceGeneration) return;
                if (metadata?.width) this.videoWidth = metadata.width;
                if (metadata?.height) this.videoHeight = metadata.height;
                this.sourcePixelFormat = metadata?.pixelFormat;
                if (this.segmentEnd !== undefined) {
                    this.durationValue = this.segmentEnd;
                } else if (metadata?.duration !== undefined) {
                    this.durationValue = metadata.duration;
                }
            }
            if (
                !this.metadataDispatched &&
                !this.destroyed &&
                sourceGeneration === this.sourceGeneration
            ) {
                this.readyStateValue = 1;
                this.metadataDispatched = true;
                this.emit("loadedmetadata");
            }
        })();
        return this.metadataPromise;
    }

    private handlePresentedFrameState(): void {
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

    private recoverStalledLiveVideo(): boolean {
        if (
            this.options.mediaType !== "live" ||
            this.livePresentationDeadlineMs === 0 ||
            performance.now() < this.livePresentationDeadlineMs
        ) return false;

        this.lastError = new Error(
            `Live video produced no presented frame for ${LIVE_PRESENTATION_STALL_TIMEOUT_MS / 1000} seconds`,
        );
        this.stopDecoder();
        this.emit("error");
        if (this.options.reconnect !== false) this.scheduleReconnect();
        else this.isPaused = true;
        return true;
    }

    private scheduleReconnect(): void {
        this.playingDispatched = false;
        const reconnect = this.options.reconnect || {};
        const initialDelay = reconnect.initialDelayMs ?? 500;
        const maxDelay = reconnect.maxDelayMs ?? 5_000;
        const delay = Math.min(maxDelay, initialDelay * 2 ** this.reconnectAttempt);
        this.reconnectAttempt++;
        this.reconnectAtMs = performance.now() + delay;
    }

    private tryReconnect(): void {
        if (
            this.destroyed ||
            this.isPaused ||
            this.options.mediaType !== "live" ||
            this.options.reconnect === false ||
            this.reconnectAtMs === 0 ||
            performance.now() < this.reconnectAtMs
        ) return;
        this.reconnectAtMs = 0;
        try {
            this.startDecoder(0);
        } catch (error) {
            this.lastError = asError(error);
            this.emit("error");
            this.scheduleReconnect();
        }
    }

    private emit(type: NativeVideoEventType): void {
        const event = new Event(type);
        this.dispatchEvent(event);
        const handler = this[`on${type}` as keyof NativeVideo];
        if (typeof handler === "function") {
            (handler as NativeVideoEventHandler)?.call(this, event);
        }
    }

    private assertUsable(): void {
        if (this.destroyed) throw new Error("NativeVideo has been destroyed");
    }
}

export class VideoFpsMeter {
    private startedAtMs: number | undefined;
    private frameCount = 0;
    private readonly sampleWindowMs: number;

    public constructor(sampleWindowMs = 500) {
        if (sampleWindowMs <= 0) {
            throw new Error("FPS sample window must be positive");
        }
        this.sampleWindowMs = sampleWindowMs;
    }

    public observe(timestampMs: number): number | null {
        if (this.startedAtMs === undefined) {
            this.startedAtMs = timestampMs;
            this.frameCount = 0;
            return null;
        }
        this.frameCount++;
        const elapsedMs = timestampMs - this.startedAtMs;
        if (elapsedMs < this.sampleWindowMs) return null;

        const fps = (this.frameCount * 1000) / elapsedMs;
        this.startedAtMs = timestampMs;
        this.frameCount = 0;
        return fps;
    }
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}
