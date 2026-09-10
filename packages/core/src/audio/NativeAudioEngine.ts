import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolveNativePlatformModules } from "../runtime/platformNative.ts";

const resolveFfmpegPath = (): string => {
    const configured = process.env.FFMPEG_PATH?.trim();
    if (configured) return configured;
    const bundled = resolveNativePlatformModules().ffmpeg;
    return existsSync(bundled) ? bundled : "ffmpeg";
};

export type NativeAudioEvent =
    | "load" | "loaderror" | "playerror" | "play" | "end" | "pause" | "stop"
    | "mute" | "volume" | "seek" | "fade";

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

interface NativeEvent {
    readonly ownerId: number;
    readonly event: NativeAudioEvent;
    readonly id?: number;
    readonly message?: string;
}

interface NativeDiagnostics {
    readonly activeVoices: number;
    readonly queuedMs: number;
    readonly underruns: number;
}

interface NativeBinding {
    createVoice(options: Record<string, unknown>): void;
    preload(ownerId: number, requestId: number, source: string, ffmpegPath: string, offsetSeconds: number, durationSeconds?: number): void;
    command(options: Record<string, unknown>): void;
    unloadOwner(ownerId: number): void;
    currentTime(id: number): number | null;
    currentVolume(id: number): number | null;
    setGlobalVolume(value: number): void;
    setGlobalMuted(value: boolean): void;
    drainEvents(): NativeEvent[];
    diagnostics(): NativeDiagnostics;
    stopAll(): void;
    shutdown(): void;
}

interface NativeBindingModule {
    readonly NativeAudioEngine: new (eventNotifier: () => void) => NativeBinding;
}

export function resolveNativeAudioBindingPath(platform = process.platform, arch = process.arch): string {
    if ((platform !== "win32" && platform !== "linux") || arch !== "x64") {
        throw new Error(`Native miniaudio supports only Windows/Linux x64, not ${platform}-${arch}`);
    }
    const path = resolveNativePlatformModules(platform, arch).audioBinding;
    if (!path) throw new Error(`Native miniaudio audio binding is missing for ${platform}-${arch}`);
    return path;
}

/** @deprecated Use resolveNativeAudioBindingPath. */
export function resolveWindowsNativeAudioBindingPath(platform = process.platform, arch = process.arch): string {
    return resolveNativeAudioBindingPath(platform, arch);
}

class NativeAudioEngineAdapter {
    private readonly owners = new Map<number, NativeAudioEventTarget>();
    private readonly fadeVersions = new Map<number, number>();
    private native?: NativeBinding;
    private nextOwnerId = 1;
    private nextVoiceId = 1;
    private nextPreloadId = 1;
    private globalVolume = 1;
    private globalMuted = false;

    public registerOwner(owner: NativeAudioEventTarget): number {
        const id = this.nextOwnerId++;
        this.owners.set(id, owner);
        return id;
    }

    public unregisterOwner(ownerId: number): void {
        this.owners.delete(ownerId);
        this.native?.unloadOwner(ownerId);
    }

    public createVoice(ownerId: number, options: CreateVoiceOptions): number {
        const native = this.ensureStarted();
        const id = this.nextVoiceId++;
        native.createVoice({ ownerId, id, source: options.source, ffmpegPath: resolveFfmpegPath(), offsetSeconds: options.offsetSeconds, durationSeconds: options.durationSeconds, volume: options.volume, muted: options.muted, loop: options.loop, streaming: options.streaming ?? false, playbackRate: options.playbackRate ?? 1, inputArgs: [...(options.inputArgs ?? [])], outputArgs: [...(options.outputArgs ?? [])] });
        return id;
    }

    public preload(ownerId: number, source: string, offsetSeconds: number, durationSeconds?: number): number {
        const requestId = this.nextPreloadId++;
        this.ensureStarted().preload(ownerId, requestId, source, resolveFfmpegPath(), offsetSeconds, durationSeconds);
        return requestId;
    }

    public command(ownerId: number, command: string, id?: number, values: Record<string, unknown> = {}): void {
        let fadeVersion: number | undefined;
        if (id !== undefined && ["fade", "volume", "seek", "stop"].includes(command)) {
            fadeVersion = (this.fadeVersions.get(id) ?? 0) + 1;
            this.fadeVersions.set(id, fadeVersion);
        }
        const value = typeof values.value === "number" ? values.value : undefined;
        const boolValue = typeof values.value === "boolean" ? values.value : undefined;
        this.native?.command({ ownerId, command, id, value, boolValue, from: values.from, to: values.to, durationMs: values.durationMs, fadeVersion });
    }

    public currentTime(id: number): number | undefined { return this.native?.currentTime(id) ?? undefined; }
    public currentVolume(id: number): number | undefined { return this.native?.currentVolume(id) ?? undefined; }
    public get volume(): number { return this.globalVolume; }
    public set volume(value: number) { this.globalVolume = value; this.native?.setGlobalVolume(value); }
    public get muted(): boolean { return this.globalMuted; }
    public set muted(value: boolean) { this.globalMuted = value; this.native?.setGlobalMuted(value); }
    public get diagnostics(): NativeDiagnostics { return this.native?.diagnostics() ?? { activeVoices: 0, queuedMs: 0, underruns: 0 }; }
    public stopAll(): void { this.native?.stopAll(); this.fadeVersions.clear(); }
    public clearQueuedOutput(): void {}
    public shutdown(): void { this.native?.shutdown(); this.native = undefined; this.owners.clear(); this.fadeVersions.clear(); }

    private ensureStarted(): NativeBinding {
        if (this.native) return this.native;
        const bindingPath = resolveNativeAudioBindingPath();
        if (!existsSync(bindingPath)) throw new Error(`Missing native audio addon: ${bindingPath}. Build it with pnpm native:audio:build.`);
        const binding = createRequire(import.meta.url)(bindingPath) as NativeBindingModule;
        this.native = new binding.NativeAudioEngine(() => this.dispatchPendingEvents());
        this.native.setGlobalVolume(this.globalVolume);
        this.native.setGlobalMuted(this.globalMuted);
        return this.native;
    }

    private dispatchPendingEvents(): void {
        for (const event of this.native?.drainEvents() ?? []) {
            this.owners.get(event.ownerId)?.handleNativeAudioEvent(event.event, event.id, event.message);
        }
    }
}

export const nativeAudioEngine = new NativeAudioEngineAdapter();
