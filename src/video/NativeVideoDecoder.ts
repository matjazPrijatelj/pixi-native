import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface VideoFrameData {
    width: number;
    height: number;
    timestampUs: number;
    data: Uint8Array;
    pixelFormat: "rgba";
}

interface NativeVideoModule {
    NativeVideoDecoder: new (options: NativeVideoDecoderOptions) => {
        open(source: string): void;
        pollLatest(): VideoFrameData | null;
        pollError(): string | null;
        backend(): string;
        close(): void;
    };
}

export interface NativeVideoDecoderOptions {
    width: number;
    height: number;
    fps?: number;
    ffmpegPath?: string;
    vaapiDevice?: string;
}

export interface NativeVideoDecoderInfo {
    readonly decoderType: "FFmpeg H.264";
    readonly hardwareBackend: "VA-API";
    readonly targetFps: number;
}

export function buildFfmpegArgs(source: string, options: NativeVideoDecoderOptions): string[] {
    const fps = options.fps ?? 30;
    const device = options.vaapiDevice ?? process.env.FFMPEG_VAAPI_DEVICE ?? "/dev/dri/renderD128";
    return [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-hwaccel", "vaapi", "-hwaccel_device", device,
        "-hwaccel_output_format", "vaapi", "-re", "-i", source, "-an",
        "-vf", `hwdownload,format=nv12,scale=${options.width}:${options.height}:flags=fast_bilinear,format=rgba`,
        "-r", String(fps), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
    ];
}

export class RawVideoFrameAssembler {
    private pending = new Uint8Array(0);
    private frameIndex = 0;
    private readonly width: number;
    private readonly height: number;
    private readonly fps: number;
    public constructor(width: number, height: number, fps: number) {
        this.width = width;
        this.height = height;
        this.fps = fps;
    }
    public append(chunk: Uint8Array): VideoFrameData[] {
        const merged = new Uint8Array(this.pending.length + chunk.length);
        merged.set(this.pending); merged.set(chunk, this.pending.length); this.pending = merged;
        const frameBytes = this.width * this.height * 4;
        const frames: VideoFrameData[] = [];
        while (this.pending.length >= frameBytes) {
            const data = this.pending.slice(0, frameBytes); this.pending = this.pending.slice(frameBytes);
            frames.push({ width: this.width, height: this.height, timestampUs: Math.round(this.frameIndex++ * 1_000_000 / this.fps), data, pixelFormat: "rgba" });
        }
        return frames;
    }
}

/* Measures the arrival rate of decoded frames in the Node process. */
export class VideoFpsMeter {
    private startedAtMs: number | undefined;
    private frameCount = 0;
    private readonly sampleWindowMs: number;
    public constructor(sampleWindowMs = 500) {
        if (sampleWindowMs <= 0) throw new Error("FPS sample window must be positive");
        this.sampleWindowMs = sampleWindowMs;
    }
    public observe(timestampMs: number): number | null {
        if (this.startedAtMs === undefined) this.startedAtMs = timestampMs;
        this.frameCount++;
        const elapsedMs = timestampMs - this.startedAtMs;
        if (elapsedMs < this.sampleWindowMs) return null;
        const fps = this.frameCount * 1000 / elapsedMs;
        this.startedAtMs = timestampMs;
        this.frameCount = 0;
        return fps;
    }
}

/** FFmpeg decoder that requires VA-API hardware H.264 decoding. */
export class NativeVideoDecoder {
    private nativeDecoder?: NativeVideoModule["NativeVideoDecoder"] extends new (...args: never[]) => infer T ? T : never;
    private closed = false;
    private readonly options: NativeVideoDecoderOptions;
    public readonly info: NativeVideoDecoderInfo;
    public constructor(options: NativeVideoDecoderOptions) {
        this.options = options;
        this.info = { decoderType: "FFmpeg H.264", hardwareBackend: "VA-API", targetFps: options.fps ?? 30 };
        if (options.width <= 0 || options.height <= 0) throw new Error("Video dimensions must be positive");
        const fps = options.fps ?? 30;
        if (fps <= 0) throw new Error("Video FPS must be positive");
    }
    public async open(source: string, onFrame: (frame: VideoFrameData) => void, onError?: (error: Error) => void): Promise<void> {
        if (this.nativeDecoder) throw new Error("Video decoder is already open");
        this.closed = false;
        try {
            const nativeVideo = require("../../native/video/src/index.js") as NativeVideoModule;
            const ffmpegPath = this.options.ffmpegPath ?? process.env.FFMPEG_PATH;
            this.nativeDecoder = new nativeVideo.NativeVideoDecoder({ ...this.options, ffmpegPath });
            this.nativeDecoder.open(source);
            this.onFrame = onFrame;
            this.onError = onError;
        } catch (error) {
            this.closed = true;
            onError?.(error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }
    private onFrame?: (frame: VideoFrameData) => void;
    private onError?: (error: Error) => void;
    public pollLatest(): boolean {
        if (this.closed || !this.nativeDecoder) return false;
        const message = this.nativeDecoder.pollError();
        if (message) this.onError?.(new Error(message));
        const frame = this.nativeDecoder.pollLatest();
        if (!frame) return false;
        this.onFrame?.({ ...frame, pixelFormat: "rgba" });
        return true;
    }
    public getBackend(): string {
        return this.nativeDecoder?.backend() ?? "unknown";
    }
    public close(): void { this.closed = true; this.nativeDecoder?.close(); this.nativeDecoder = undefined; this.onFrame = undefined; this.onError = undefined; }
}
