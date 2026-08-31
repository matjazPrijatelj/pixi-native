import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

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
    pollError(): string | null;
    backend(): string;
    decodedFrames(): number;
    droppedFrames(): number;
    isFinished(): boolean;
    close(): void;
}

interface NativeVideoModule {
    NativeVideoDecoder: new (
        options: NativeVideoDecoderOptions,
    ) => NativeDecoderBinding;
}

export interface NativeVideoOptions {
    readonly width: number;
    readonly height: number;
    readonly fps?: number;
    readonly ffmpegPath?: string;
    readonly vaapiDevice?: string;
}

export interface NativeVideoDecoderOptions extends NativeVideoOptions {
    readonly startTime?: number;
}

export interface NativeVideoStats {
    readonly decodedFrames: number;
    readonly presentedFrames: number;
    readonly droppedFrames: number;
    readonly bytesPerFrame: number;
}

export interface NativeVideoDecoderLike {
    open(source: string): void;
    pollLatest(): NativeVideoFrame | null;
    pollError(): string | null;
    backend(): string;
    decodedFrames(): number;
    droppedFrames(): number;
    isFinished(): boolean;
    close(): void;
}

export interface NativeVideoDependencies {
    createDecoder(options: NativeVideoDecoderOptions): NativeVideoDecoderLike;
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
    const executable = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    return fileURLToPath(
        new URL(
            `../../../native/video/dist/${platform}-${arch}/${executable}`,
            import.meta.url,
        ),
    );
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

        const nativeVideo = require(
            "../../../native/video/src/index.js"
        ) as NativeVideoModule;
        this.decoder = new nativeVideo.NativeVideoDecoder({
            ...options,
            fps,
            startTime,
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

    public isFinished(): boolean {
        return this.decoder.isFinished();
    }

    public close(): void {
        this.decoder.close();
    }
}

const DEFAULT_DEPENDENCIES: NativeVideoDependencies = {
    createDecoder: (options) => new NativeVideoDecoder(options),
};

export class NativeVideo {
    public readonly src: string;
    public readonly width: number;
    public readonly height: number;
    public readonly fps: number;

    private readonly options: NativeVideoOptions;
    private readonly dependencies: NativeVideoDependencies;
    private decoder?: NativeVideoDecoderLike;
    private positionSeconds = 0;
    private isPaused = true;
    private hasEnded = false;
    private destroyed = false;
    private lastBackend = "not started";
    private lastError: Error | null = null;
    private decodedFrameBase = 0;
    private droppedFrameBase = 0;
    private presentedFrameCount = 0;

    public constructor(
        src: string,
        options: NativeVideoOptions,
        dependencies: NativeVideoDependencies = DEFAULT_DEPENDENCIES,
    ) {
        if (!src) throw new Error("Video source must not be empty");
        getNv12FrameLayout(options.width, options.height);
        const fps = options.fps ?? 30;
        if (!Number.isFinite(fps) || fps <= 0) {
            throw new Error("Video FPS must be positive and finite");
        }

        this.src = src;
        this.width = options.width;
        this.height = options.height;
        this.fps = fps;
        this.options = options;
        this.dependencies = dependencies;
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

    public get currentTime(): number {
        return this.positionSeconds;
    }

    public set currentTime(value: number) {
        this.assertUsable();
        if (!Number.isFinite(value) || value < 0) {
            throw new RangeError("currentTime must be non-negative and finite");
        }

        this.positionSeconds = value;
        this.hasEnded = false;
        this.lastError = null;
        if (!this.isPaused) {
            try {
                this.startDecoder(value);
            } catch (error) {
                this.isPaused = true;
                this.lastError = asError(error);
                throw this.lastError;
            }
        }
    }

    public get stats(): NativeVideoStats {
        const layout = getNv12FrameLayout(this.width, this.height);
        return {
            decodedFrames:
                this.decodedFrameBase + (this.decoder?.decodedFrames() ?? 0),
            presentedFrames: this.presentedFrameCount,
            droppedFrames:
                this.droppedFrameBase + (this.decoder?.droppedFrames() ?? 0),
            bytesPerFrame: layout.frameBytes,
        };
    }

    public async play(): Promise<void> {
        this.assertUsable();
        if (!this.isPaused) return;
        if (this.hasEnded) this.positionSeconds = 0;

        this.hasEnded = false;
        this.lastError = null;
        this.isPaused = false;
        try {
            this.startDecoder(this.positionSeconds);
        } catch (error) {
            this.isPaused = true;
            this.lastError = asError(error);
            throw this.lastError;
        }
    }

    public pause(): void {
        this.assertUsable();
        if (this.isPaused) return;
        this.stopDecoder();
        this.isPaused = true;
    }

    public takeLatestFrame(): NativeVideoFrame | null {
        if (this.destroyed || !this.decoder) return null;

        const message = this.decoder.pollError();
        if (message) {
            this.lastError = new Error(message);
            this.stopDecoder();
            this.isPaused = true;
            return null;
        }

        const frame = this.decoder.pollLatest();
        if (frame) {
            this.positionSeconds = frame.timestampUs / 1_000_000;
            return frame;
        }

        if (this.decoder.isFinished()) {
            this.stopDecoder();
            this.isPaused = true;
            this.hasEnded = true;
        }
        return null;
    }

    public markFramePresented(): void {
        if (!this.destroyed) this.presentedFrameCount++;
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.stopDecoder();
        this.isPaused = true;
        this.destroyed = true;
    }

    private startDecoder(startTime: number): void {
        this.stopDecoder();
        const decoder = this.dependencies.createDecoder({
            ...this.options,
            fps: this.fps,
            startTime,
        });

        try {
            decoder.open(this.src);
            this.decoder = decoder;
            this.lastBackend = decoder.backend();
        } catch (error) {
            decoder.close();
            throw error;
        }
    }

    private stopDecoder(): void {
        if (!this.decoder) return;
        this.decodedFrameBase += this.decoder.decodedFrames();
        this.droppedFrameBase += this.decoder.droppedFrames();
        this.lastBackend = this.decoder.backend();
        this.decoder.close();
        this.decoder = undefined;
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
        if (this.startedAtMs === undefined) this.startedAtMs = timestampMs;
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
