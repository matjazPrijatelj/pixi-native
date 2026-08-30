import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export interface VideoFrameData {
    width: number;
    height: number;
    timestampUs: number;
    data: Uint8Array;
    pixelFormat: "rgba";
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
        "-hide_banner", "-loglevel", "error", "-hwaccel", "vaapi", "-hwaccel_device", device,
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
    private process?: ChildProcessByStdio<null, Readable, Readable>;
    private closed = false;
    private readonly assembler: RawVideoFrameAssembler;
    private readonly options: NativeVideoDecoderOptions;
    public readonly info: NativeVideoDecoderInfo;
    public constructor(options: NativeVideoDecoderOptions) {
        this.options = options;
        this.info = { decoderType: "FFmpeg H.264", hardwareBackend: "VA-API", targetFps: options.fps ?? 30 };
        if (options.width <= 0 || options.height <= 0) throw new Error("Video dimensions must be positive");
        const fps = options.fps ?? 30;
        if (fps <= 0) throw new Error("Video FPS must be positive");
        this.assembler = new RawVideoFrameAssembler(options.width, options.height, fps);
    }
    public async open(source: string, onFrame: (frame: VideoFrameData) => void, onError?: (error: Error) => void): Promise<void> {
        if (this.process) throw new Error("Video decoder is already open");
        const ffmpegPath = this.options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
        const child = spawn(ffmpegPath, buildFfmpegArgs(source, this.options), { stdio: ["ignore", "pipe", "pipe"] });
        this.process = child; this.closed = false;
        let stderr = "";
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on("error", (error) => { if (!this.closed) onError?.(error instanceof Error ? error : new Error(String(error))); });
        await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
        void this.readFrames(child, onFrame, onError, () => stderr);
    }
    private async readFrames(child: ChildProcessByStdio<null, Readable, Readable>, onFrame: (frame: VideoFrameData) => void, onError?: (error: Error) => void, getStderr = (): string => ""): Promise<void> {
        try {
            for await (const chunk of child.stdout) {
                if (this.closed) break;
                for (const frame of this.assembler.append(new Uint8Array(chunk))) onFrame(frame);
            }
            if (!this.closed) {
                const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
                if (code !== 0) onError?.(new Error(`FFmpeg VA-API decoder exited with code ${code}: ${getStderr().trim()}`));
            }
        } catch (error) { if (!this.closed) onError?.(error instanceof Error ? error : new Error(String(error))); }
    }
    public close(): void { this.closed = true; this.process?.kill(); this.process = undefined; }
}
