import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import * as sdl from "@kmamal/sdl";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 4;
const CHUNK_FRAMES = 512;
const TARGET_QUEUE_FRAMES = 2048;

export type NativeAudioEvent =
    | "load"
    | "loaderror"
    | "playerror"
    | "play"
    | "end"
    | "pause"
    | "stop"
    | "mute"
    | "volume"
    | "seek"
    | "fade";

export interface NativeAudioEventTarget {
    handleNativeAudioEvent(event: NativeAudioEvent, id?: number, message?: string): void;
}

export interface CreateVoiceOptions {
    readonly source: string;
    readonly offsetSeconds: number;
    readonly durationSeconds?: number;
    readonly volume: number;
    readonly muted: boolean;
    readonly loop: boolean;
    readonly streaming?: boolean;
    readonly playbackRate?: number;
    readonly inputArgs?: readonly string[];
    readonly outputArgs?: readonly string[];
}

interface VoicePosition {
    readonly ownerId: number;
    readonly seconds: number;
    readonly outputFrame: number;
    readonly playing: boolean;
    readonly volume: number;
    readonly playbackRate: number;
}

function resolveFfmpegPath(): string {
    const configured = process.env.FFMPEG_PATH?.trim();
    if (configured) return configured;
    const executable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const bundled = join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../native/video/dist",
        `${process.platform}-${process.arch}`,
        executable,
    );
    return existsSync(bundled) ? bundled : "ffmpeg";
}

export class NativeAudioEngine {
    private readonly owners = new Map<number, NativeAudioEventTarget>();
    private readonly positions = new Map<number, VoicePosition>();
    private readonly voiceOwners = new Map<number, number>();
    private readonly fadeVersions = new Map<number, number>();
    private readonly eventTimers = new Set<ReturnType<typeof setTimeout>>();
    private worker?: Worker;
    private device?: sdl.Sdl.Audio.AudioPlaybackInstance;
    private pumpTimer?: ReturnType<typeof setInterval>;
    private renderPending = false;
    private nextOwnerId = 1;
    private nextVoiceId = 1;
    private nextPreloadId = 1;
    private submittedFrames = 0;
    private globalVolume = 1;
    private globalMuted = false;
    private queueGeneration = 0;

    public registerOwner(owner: NativeAudioEventTarget): number {
        const id = this.nextOwnerId++;
        this.owners.set(id, owner);
        return id;
    }

    public unregisterOwner(ownerId: number): void {
        this.owners.delete(ownerId);
        this.worker?.postMessage({ type: "unloadOwner", ownerId });
        for (const [id, position] of this.positions) {
            if (position.ownerId === ownerId) this.positions.delete(id);
        }
        for (const [id, voiceOwnerId] of this.voiceOwners) {
            if (voiceOwnerId !== ownerId) continue;
            this.voiceOwners.delete(id);
            this.fadeVersions.delete(id);
        }
    }

    public createVoice(ownerId: number, options: CreateVoiceOptions): number {
        this.ensureStarted();
        const id = this.nextVoiceId++;
        this.voiceOwners.set(id, ownerId);
        this.worker!.postMessage({
            type: "createVoice",
            ownerId,
            id,
            source: options.source,
            ffmpegPath: resolveFfmpegPath(),
            offsetSeconds: options.offsetSeconds,
            durationSeconds: options.durationSeconds,
            volume: options.volume,
            muted: options.muted,
            loop: options.loop,
            streaming: options.streaming ?? false,
            playbackRate: options.playbackRate ?? 1,
            inputArgs: [...(options.inputArgs ?? [])],
            outputArgs: [...(options.outputArgs ?? [])],
        });
        return id;
    }

    public preload(
        ownerId: number,
        source: string,
        offsetSeconds: number,
        durationSeconds?: number,
    ): number {
        this.ensureStarted();
        const requestId = this.nextPreloadId++;
        this.worker!.postMessage({
            type: "preload",
            ownerId,
            requestId,
            source,
            ffmpegPath: resolveFfmpegPath(),
            offsetSeconds,
            durationSeconds,
        });
        return requestId;
    }

    public command(
        ownerId: number,
        command: string,
        id?: number,
        values: Record<string, unknown> = {},
    ): void {
        let fadeVersion: number | undefined;
        if (
            id !== undefined &&
            (command === "fade" || command === "volume" || command === "seek" || command === "stop")
        ) {
            fadeVersion = (this.fadeVersions.get(id) ?? 0) + 1;
            this.fadeVersions.set(id, fadeVersion);
        }
        this.worker?.postMessage({
            type: "command",
            ownerId,
            id,
            command,
            ...values,
            fadeVersion,
        });
        if (command === "stop" && id !== undefined) {
            this.positions.delete(id);
            this.voiceOwners.delete(id);
        }
    }

    public currentTime(id: number): number | undefined {
        const position = this.positions.get(id);
        if (!position) return undefined;
        if (!position.playing || !this.device) return position.seconds;
        const queuedFrames = this.device.queued / (CHANNELS * BYTES_PER_SAMPLE);
        const audibleFrame = this.submittedFrames - queuedFrames;
        return Math.max(
            0,
            position.seconds -
                (position.outputFrame - audibleFrame) * position.playbackRate / SAMPLE_RATE,
        );
    }

    public currentVolume(id: number): number | undefined {
        return this.positions.get(id)?.volume;
    }

    public get volume(): number {
        return this.globalVolume;
    }

    public set volume(value: number) {
        this.globalVolume = value;
    }

    public get muted(): boolean {
        return this.globalMuted;
    }

    public set muted(value: boolean) {
        this.globalMuted = value;
    }

    public get diagnostics(): { activeVoices: number; queuedMs: number } {
        return {
            activeVoices: this.positions.size,
            queuedMs: this.device
                ? (this.device.queued * 1000) /
                  (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
                : 0,
        };
    }

    public stopAll(): void {
        this.worker?.postMessage({ type: "clear" });
        this.positions.clear();
        this.voiceOwners.clear();
        this.fadeVersions.clear();
        this.clearQueuedOutput();
    }

    public clearQueuedOutput(): void {
        this.queueGeneration++;
        this.device?.clearQueue();
        this.submittedFrames = 0;
    }

    public shutdown(): void {
        this.stopAll();
        if (this.pumpTimer) clearInterval(this.pumpTimer);
        this.pumpTimer = undefined;
        for (const timer of this.eventTimers) clearTimeout(timer);
        this.eventTimers.clear();
        this.worker?.postMessage({ type: "shutdown" });
        void this.worker?.terminate();
        this.worker = undefined;
        if (this.device && !this.device.closed) this.device.close();
        this.device = undefined;
        this.owners.clear();
    }

    private ensureStarted(): void {
        if (this.worker && this.device) return;
        this.device = sdl.audio.openDevice(
            { type: "playback" },
            { channels: CHANNELS, frequency: SAMPLE_RATE, format: "f32", buffered: 1024 },
        );
        this.worker = new Worker(new URL("./audioWorker.ts", import.meta.url), {
            execArgv: ["--enable-source-maps"],
        });
        this.worker.on("message", (message) => this.handleWorkerMessage(message));
        this.worker.on("error", (error) => {
            for (const owner of this.owners.values()) {
                owner.handleNativeAudioEvent("playerror", undefined, error.message);
            }
        });
        this.device.play();
        this.pumpTimer = setInterval(() => this.pump(), 5);
        this.pumpTimer.unref();
        this.pump();
    }

    private pump(): void {
        if (!this.device || !this.worker || this.renderPending) return;
        const queuedFrames = this.device.queued / (CHANNELS * BYTES_PER_SAMPLE);
        if (queuedFrames >= TARGET_QUEUE_FRAMES) return;
        this.renderPending = true;
        this.worker.postMessage({
            type: "render",
            frames: CHUNK_FRAMES,
            globalVolume: this.globalVolume,
            globalMuted: this.globalMuted,
            generation: this.queueGeneration,
        });
    }

    private handleWorkerMessage(message: any): void {
        if (message.type === "event") {
            this.dispatch(message.ownerId, message.event, message.id, message.message);
            return;
        }
        if (message.type === "preloaded") {
            this.dispatch(message.ownerId, "load", message.requestId);
            return;
        }
        if (message.type !== "chunk" || !this.device) return;
        this.renderPending = false;
        if (message.generation !== this.queueGeneration) {
            this.pump();
            return;
        }
        const buffer = Buffer.from(message.buffer);
        this.device.enqueue(buffer);
        this.submittedFrames += message.frames;
        for (const position of message.positions) {
            this.positions.set(position.id, {
                ownerId: position.ownerId,
                seconds: position.seconds,
                outputFrame: this.submittedFrames,
                playing: position.playing,
                volume: position.volume,
                playbackRate: position.playbackRate,
            });
        }
        const audibleDelayMs =
            (this.device.queued * 1000) /
            (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
        for (const event of message.events) {
            const timer = setTimeout(() => {
                this.eventTimers.delete(timer);
                if (
                    event.event === "fade" &&
                    event.fadeVersion !== this.fadeVersions.get(event.id)
                ) {
                    return;
                }
                if (event.event === "end" && event.final !== false) {
                    this.positions.delete(event.id);
                    this.voiceOwners.delete(event.id);
                    this.fadeVersions.delete(event.id);
                }
                this.dispatch(event.ownerId, event.event, event.id);
            }, audibleDelayMs);
            timer.unref();
            this.eventTimers.add(timer);
        }
        this.pump();
    }

    private dispatch(
        ownerId: number,
        event: NativeAudioEvent,
        id?: number,
        message?: string,
    ): void {
        this.owners.get(ownerId)?.handleNativeAudioEvent(event, id, message);
    }
}

export const nativeAudioEngine = new NativeAudioEngine();
