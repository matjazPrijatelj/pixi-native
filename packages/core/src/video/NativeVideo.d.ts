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
    createAudio?(source: string, startTime: number, volume: number, muted: boolean, playbackRate: number, inputArgs: readonly string[], outputArgs: readonly string[], endTime?: number): NativeVideoAudioLike;
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
export declare function getNv12FrameLayout(width: number, height: number): Nv12FrameLayout;
export declare function splitNv12Frame(frame: NativePackedVideoFrame): NativeVideoFrame;
export declare function convertBt709LimitedNv12SampleToRgb(rawY: number, rawU: number, rawV: number): readonly [number, number, number];
export declare function getBundledFfmpegPath(platform?: NodeJS.Platform, arch?: string): string;
export declare function resolveFfmpegPath(options?: ResolveFfmpegPathOptions): string;
export declare class NativeVideoDecoder implements NativeVideoDecoderLike {
    private readonly decoder;
    constructor(options: NativeVideoDecoderOptions);
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
export type NativeVideoEventType = "emptied" | "loadedmetadata" | "loadeddata" | "canplay" | "canplaythrough" | "play" | "playing" | "pause" | "timeupdate" | "seeked" | "ended" | "error";
type NativeVideoEventHandler = ((this: NativeVideo, event: Event) => void) | null;
export declare function setNativeVideoModalState(active: boolean): void;
export declare class NativeVideo extends EventTarget {
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    videoWidth: number;
    videoHeight: number;
    onemptied: NativeVideoEventHandler;
    onloadedmetadata: NativeVideoEventHandler;
    onloadeddata: NativeVideoEventHandler;
    oncanplay: NativeVideoEventHandler;
    oncanplaythrough: NativeVideoEventHandler;
    onplay: NativeVideoEventHandler;
    onplaying: NativeVideoEventHandler;
    onpause: NativeVideoEventHandler;
    ontimeupdate: NativeVideoEventHandler;
    onseeked: NativeVideoEventHandler;
    onended: NativeVideoEventHandler;
    onerror: NativeVideoEventHandler;
    private readonly options;
    private readonly dependencies;
    private decoder?;
    private positionSeconds;
    private isPaused;
    private hasEnded;
    private destroyed;
    private lastBackend;
    private lastError;
    private decodedFrameBase;
    private droppedFrameBase;
    private skippedFrameBase;
    private presentedFrameCount;
    private skippedFrameCount;
    private syncOffsetMilliseconds;
    private audio?;
    private playbackClockStartedAtMs?;
    private playbackClockStartSeconds;
    private lastAudioError;
    private pendingFrame;
    private catchUpTargetUs?;
    private audioVolume;
    private audioMuted;
    private playbackGeneration;
    private sourceValue;
    private decodedSource;
    private segmentStart;
    private segmentEnd?;
    private playbackRateValue;
    private loopValue;
    private readyStateValue;
    private durationValue;
    private sourcePixelFormat?;
    private metadataDispatched;
    private dataDispatched;
    private playingDispatched;
    private lastTimeUpdateMs;
    private reconnectAttempt;
    private reconnectAtMs;
    private livePresentationDeadlineMs;
    private frameAwaitingPresentation;
    private readonly registryReference;
    private metadataPromise?;
    private sourceGeneration;
    constructor(src: string, options: NativeVideoOptions, dependencies?: NativeVideoDependencies);
    get src(): string;
    set src(value: string);
    private replaceSource;
    get currentSrc(): string;
    get duration(): number;
    get readyState(): number;
    get loop(): boolean;
    set loop(value: boolean);
    get playbackRate(): number;
    set playbackRate(value: number);
    get paused(): boolean;
    get ended(): boolean;
    get backend(): string;
    get error(): Error | null;
    get audioError(): Error | null;
    get reconnecting(): boolean;
    get reconnectAttempts(): number;
    get volume(): number;
    set volume(value: number);
    get muted(): boolean;
    set muted(value: boolean);
    get currentTime(): number;
    set currentTime(value: number);
    get stats(): NativeVideoStats;
    play(): Promise<void>;
    pause(): void;
    load(): void;
    takeLatestFrame(): NativeVideoFrame | null;
    markFramePresented(): void;
    destroy(): void;
    private startDecoder;
    private decoderFrameRate;
    private shouldUseAudio;
    private startPlaybackAt;
    private waitForDecoderReady;
    private isPlaybackGenerationActive;
    private ensureFilePlaybackClock;
    private filePlaybackClockTime;
    private startAudio;
    private restartWithAudio;
    private stopAudio;
    private takeSynchronizedFrame;
    private requestDecoderCatchUp;
    private takeNewestDecodedFrame;
    private stopDecoder;
    setModalState(active: boolean): void;
    private pauseInternal;
    private restartPlayback;
    private clampFileTime;
    private resetReadiness;
    private resetSourceState;
    private loadMetadataInBackground;
    private ensureMetadata;
    private handlePresentedFrameState;
    private recoverStalledLiveVideo;
    private scheduleReconnect;
    private tryReconnect;
    private emit;
    private assertUsable;
}
export declare class VideoFpsMeter {
    private startedAtMs;
    private frameCount;
    private readonly sampleWindowMs;
    constructor(sampleWindowMs?: number);
    observe(timestampMs: number): number | null;
}
export {};
