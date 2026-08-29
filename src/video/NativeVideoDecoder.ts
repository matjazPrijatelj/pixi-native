import { spawn, type Subprocess } from "bun";
import ffmpegStatic from "ffmpeg-static";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface VideoMetadata { width: number; height: number; fps: number; duration: number | null; }
export interface VideoFrameData { width: number; height: number; timestampUs: number; data: Uint8Array; pixelFormat: "rgba"; }
export interface NativeVideoDecoderOptions { width: number; height: number; fps?: number; ffmpegPath?: string; }

/** Software FFmpeg decoder producing timestamped RGBA frames for GPU upload. */
export class NativeVideoDecoder {
    private process?: Subprocess;
    private playing = false;
    private closed = false;
    private readonly frameBytes: number;
    private readonly fps: number;
    public constructor(private readonly options: NativeVideoDecoderOptions) {
        if (options.width <= 0 || options.height <= 0) throw new Error("Video dimensions must be positive");
        this.frameBytes = options.width * options.height * 4;
        this.fps = options.fps ?? 30;
    }

    public async open(source: string, onFrame: (frame: VideoFrameData) => void): Promise<void> {
        if (this.process) throw new Error("Video decoder is already open");
        const bundledName = process.platform === "win32" ? "../ffmpeg/ffmpeg.exe" : "../ffmpeg/ffmpeg";
        const bundledPath = fileURLToPath(new URL(bundledName, import.meta.url));
        const ffmpeg = this.options.ffmpegPath ?? (existsSync(bundledPath) ? bundledPath : ffmpegStatic ?? "ffmpeg");
        const child = spawn([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", source, "-vf", `scale=${this.options.width}:${this.options.height}`, "-r", String(this.fps), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { stdout: "pipe", stderr: "pipe" });
        this.process = child;
        if (!child.stdout || typeof child.stdout === "number") throw new Error("FFmpeg stdout pipe is unavailable");
        this.closed = false;
        this.playing = true;
        void this.readFrames(child.stdout, onFrame);
    }

    private async readFrames(stdout: ReadableStream<Uint8Array>, onFrame: (frame: VideoFrameData) => void): Promise<void> {
        const reader = stdout.getReader();
        let pending = new Uint8Array(0);
        let frameIndex = 0;
        try {
            while (!this.closed) {
                const result = await reader.read();
                if (result.done) break;
                const merged = new Uint8Array(pending.length + result.value.length);
                merged.set(pending);
                merged.set(result.value, pending.length);
                pending = merged;
                while (pending.length >= this.frameBytes) {
                    const data = pending.slice(0, this.frameBytes);
                    pending = pending.slice(this.frameBytes);
                    const timestampUs = Math.round(frameIndex++ * 1_000_000 / this.fps);
                    if (this.playing) onFrame({ width: this.options.width, height: this.options.height, timestampUs, data, pixelFormat: "rgba" });
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    public pause(): void { this.playing = false; }
    public play(): void { if (!this.closed) this.playing = true; }
    public close(): void { this.closed = true; this.playing = false; this.process?.kill(); this.process = undefined; }
}
