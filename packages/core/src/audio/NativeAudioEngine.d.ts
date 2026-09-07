export type NativeAudioEvent = "load" | "loaderror" | "playerror" | "play" | "end" | "pause" | "stop" | "mute" | "volume" | "seek" | "fade";
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
export declare class NativeAudioEngine {
    private readonly owners;
    private readonly positions;
    private readonly voiceOwners;
    private readonly fadeVersions;
    private readonly eventTimers;
    private worker?;
    private device?;
    private pumpTimer?;
    private renderPending;
    private nextOwnerId;
    private nextVoiceId;
    private nextPreloadId;
    private submittedFrames;
    private globalVolume;
    private globalMuted;
    private queueGeneration;
    registerOwner(owner: NativeAudioEventTarget): number;
    unregisterOwner(ownerId: number): void;
    createVoice(ownerId: number, options: CreateVoiceOptions): number;
    preload(ownerId: number, source: string, offsetSeconds: number, durationSeconds?: number): number;
    command(ownerId: number, command: string, id?: number, values?: Record<string, unknown>): void;
    currentTime(id: number): number | undefined;
    currentVolume(id: number): number | undefined;
    get volume(): number;
    set volume(value: number);
    get muted(): boolean;
    set muted(value: boolean);
    get diagnostics(): {
        activeVoices: number;
        queuedMs: number;
        underruns: number;
    };
    stopAll(): void;
    clearQueuedOutput(): void;
    shutdown(): void;
    private ensureStarted;
    private pump;
    private handleWorkerMessage;
    private dispatch;
}
interface WindowsNativeDiagnostics {
    readonly activeVoices: number;
    readonly queuedMs: number;
    readonly underruns: number;
}
export declare function resolveWindowsNativeAudioBindingPath(platform?: NodeJS.Platform, arch?: NodeJS.Architecture): string;
declare class WindowsNativeAudioEngine {
    private readonly owners;
    private readonly fadeVersions;
    private native?;
    private nextOwnerId;
    private nextVoiceId;
    private nextPreloadId;
    private globalVolume;
    private globalMuted;
    registerOwner(owner: NativeAudioEventTarget): number;
    unregisterOwner(ownerId: number): void;
    createVoice(ownerId: number, options: CreateVoiceOptions): number;
    preload(ownerId: number, source: string, offsetSeconds: number, durationSeconds?: number): number;
    command(ownerId: number, command: string, id?: number, values?: Record<string, unknown>): void;
    currentTime(id: number): number | undefined;
    currentVolume(id: number): number | undefined;
    get volume(): number;
    set volume(value: number);
    get muted(): boolean;
    set muted(value: boolean);
    get diagnostics(): WindowsNativeDiagnostics;
    stopAll(): void;
    /** WASAPI owns already submitted audio, so modal rendering must never flush it. */
    clearQueuedOutput(): void;
    shutdown(): void;
    private ensureStarted;
    private dispatchPendingEvents;
}
export declare const nativeAudioEngine: NativeAudioEngine | WindowsNativeAudioEngine;
export {};
