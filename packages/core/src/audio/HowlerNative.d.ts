import { type NativeAudioEvent, type NativeAudioEventTarget } from "./NativeAudioEngine.ts";
export type HowlSprite = Record<string, [offsetMs: number, durationMs: number, loop?: boolean]>;
export type HowlEventCallback = (id?: number, message?: string) => void;
export interface HowlOptions {
    readonly src: string | readonly string[];
    readonly sprite?: HowlSprite;
    readonly volume?: number;
    readonly mute?: boolean;
    readonly loop?: boolean;
    readonly autoplay?: boolean;
    readonly preload?: boolean | "metadata";
    readonly preloadSprites?: boolean;
    readonly html5?: boolean;
    /** Internal/native FFmpeg input options used by media streams. */
    readonly ffmpegInputArgs?: readonly string[];
    readonly ffmpegOutputArgs?: readonly string[];
    /** Initial media playback rate. */
    readonly rate?: number;
    readonly onload?: HowlEventCallback;
    readonly onloaderror?: HowlEventCallback;
    readonly onplayerror?: HowlEventCallback;
    readonly onplay?: HowlEventCallback;
    readonly onend?: HowlEventCallback;
    readonly onpause?: HowlEventCallback;
    readonly onstop?: HowlEventCallback;
    readonly onmute?: HowlEventCallback;
    readonly onvolume?: HowlEventCallback;
    readonly onseek?: HowlEventCallback;
    readonly onfade?: HowlEventCallback;
}
export declare class Howl implements NativeAudioEventTarget {
    readonly _sprite: HowlSprite;
    private readonly options;
    private readonly sources;
    private readonly ownerId;
    private readonly listeners;
    private readonly sounds;
    private groupVolume;
    private groupMuted;
    private groupLoop;
    private loadState;
    private readonly pendingPreloads;
    private destroyed;
    constructor(options: HowlOptions);
    load(): this;
    play(spriteOrId?: string | number): number;
    pause(id?: number): this;
    stop(id?: number): this;
    volume(): number;
    volume(volume: undefined, id: number): number;
    volume(volume: number, id?: number): this;
    mute(): boolean;
    mute(muted: boolean, id?: number): this;
    loop(): boolean;
    loop(loop: boolean, id?: number): this;
    seek(): number;
    seek(id: number): number;
    seek(seek: number, id?: number): this;
    fade(from: number, to: number, durationMs: number, id?: number): this;
    playing(id?: number): boolean;
    duration(id?: number): number;
    state(): "unloaded" | "loading" | "loaded";
    on(event: NativeAudioEvent, callback: HowlEventCallback, id?: number): this;
    once(event: NativeAudioEvent, callback: HowlEventCallback, id?: number): this;
    off(event?: NativeAudioEvent, callback?: HowlEventCallback, id?: number): this;
    unload(): null;
    handleNativeAudioEvent(event: NativeAudioEvent, id?: number, message?: string): void;
    private forSounds;
    private assertUsable;
}
export interface HowlerGlobal {
    volume(): number;
    volume(value: number): HowlerGlobal;
    mute(value: boolean): HowlerGlobal;
    stop(): HowlerGlobal;
    unload(): HowlerGlobal;
    codecs(extension: string): boolean;
}
export declare const Howler: HowlerGlobal;
