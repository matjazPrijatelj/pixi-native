import {
    nativeAudioEngine,
    type NativeAudioEvent,
    type NativeAudioEventTarget,
} from "./NativeAudioEngine.ts";

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

interface Listener {
    readonly callback: HowlEventCallback;
    readonly id?: number;
    readonly once: boolean;
}

interface SoundState {
    readonly sprite?: string;
    volume: number;
    muted: boolean;
    loop: boolean;
    paused: boolean;
    fadeTarget?: number;
}

const OPTION_EVENTS: ReadonlyArray<readonly [keyof HowlOptions, NativeAudioEvent]> = [
    ["onload", "load"],
    ["onloaderror", "loaderror"],
    ["onplayerror", "playerror"],
    ["onplay", "play"],
    ["onend", "end"],
    ["onpause", "pause"],
    ["onstop", "stop"],
    ["onmute", "mute"],
    ["onvolume", "volume"],
    ["onseek", "seek"],
    ["onfade", "fade"],
];

function clampVolume(value: number): number {
    if (!Number.isFinite(value)) throw new RangeError("Audio volume must be finite");
    return Math.max(0, Math.min(1, value));
}

const howls = new Set<Howl>();

export class Howl implements NativeAudioEventTarget {
    public readonly _sprite: HowlSprite;
    private readonly options: HowlOptions;
    private readonly sources: readonly string[];
    private readonly ownerId: number;
    private readonly listeners = new Map<NativeAudioEvent, Listener[]>();
    private readonly sounds = new Map<number, SoundState>();
    private groupVolume: number;
    private groupMuted: boolean;
    private groupLoop: boolean;
    private loadState: "unloaded" | "loading" | "loaded" = "unloaded";
    private readonly pendingPreloads = new Set<number>();
    private destroyed = false;

    public constructor(options: HowlOptions) {
        this.options = options;
        this.sources = typeof options.src === "string" ? [options.src] : options.src;
        if (this.sources.length === 0 || !this.sources[0]) {
            throw new Error("Howl requires at least one audio source");
        }
        this._sprite = { ...(options.sprite ?? {}) };
        this.groupVolume = clampVolume(options.volume ?? 1);
        this.groupMuted = options.mute ?? false;
        this.groupLoop = options.loop ?? false;
        this.ownerId = nativeAudioEngine.registerOwner(this);
        howls.add(this);

        for (const [optionName, event] of OPTION_EVENTS) {
            const callback = options[optionName];
            if (typeof callback === "function") this.on(event, callback as HowlEventCallback);
        }

        if (options.preload !== false) this.load();
    }

    public load(): this {
        this.assertUsable();
        if (this.loadState !== "unloaded") return this;
        this.loadState = "loading";
        const entries = Object.values(this._sprite);
        if (this.options.html5) {
            queueMicrotask(() => this.handleNativeAudioEvent("load"));
        } else if (this.options.preloadSprites && entries.length > 0) {
            for (const [offsetMs, durationMs] of entries) {
                const requestId = nativeAudioEngine.preload(
                    this.ownerId,
                    this.sources[0],
                    offsetMs / 1000,
                    durationMs / 1000,
                );
                this.pendingPreloads.add(requestId);
            }
        } else {
            const requestId = nativeAudioEngine.preload(
                this.ownerId,
                this.sources[0],
                0,
            );
            this.pendingPreloads.add(requestId);
        }
        return this;
    }

    public play(spriteOrId?: string | number): number {
        this.assertUsable();
        if (typeof spriteOrId === "number") {
            const sound = this.sounds.get(spriteOrId);
            if (!sound) return -1;
            sound.paused = false;
            nativeAudioEngine.command(this.ownerId, "play", spriteOrId);
            return spriteOrId;
        }

        const spriteName = spriteOrId;
        const definition = spriteName === undefined ? undefined : this._sprite[spriteName];
        if (spriteName !== undefined && !definition) {
            this.handleNativeAudioEvent("playerror", undefined, `Unknown audio sprite: ${spriteName}`);
            return -1;
        }
        const offsetSeconds = definition ? definition[0] / 1000 : 0;
        const durationSeconds = definition ? definition[1] / 1000 : undefined;
        const loop = definition?.[2] ?? this.groupLoop;
        try {
            const id = nativeAudioEngine.createVoice(this.ownerId, {
                source: this.sources[0],
                offsetSeconds,
                durationSeconds,
                volume: this.groupVolume,
                muted: this.groupMuted,
                loop,
                streaming: this.options.html5 ?? false,
                playbackRate: this.options.rate ?? 1,
                inputArgs: this.options.ffmpegInputArgs,
                outputArgs: this.options.ffmpegOutputArgs,
            });
            this.sounds.set(id, {
                sprite: spriteName,
                volume: this.groupVolume,
                muted: this.groupMuted,
                loop,
                paused: false,
            });
            return id;
        } catch (error) {
            this.handleNativeAudioEvent(
                "playerror",
                undefined,
                error instanceof Error ? error.message : String(error),
            );
            return -1;
        }
    }

    public pause(id?: number): this {
        this.forSounds(id, (sound, soundId) => {
            sound.paused = true;
            nativeAudioEngine.command(this.ownerId, "pause", soundId);
        });
        return this;
    }

    public stop(id?: number): this {
        this.forSounds(id, (_sound, soundId) => {
            nativeAudioEngine.command(this.ownerId, "stop", soundId);
            this.sounds.delete(soundId);
        });
        return this;
    }

    public volume(): number;
    public volume(volume: undefined, id: number): number;
    public volume(volume: number, id?: number): this;
    public volume(volume?: number, id?: number): number | this {
        if (volume === undefined) return id === undefined
            ? this.groupVolume
            : (nativeAudioEngine.currentVolume(id) ??
              this.sounds.get(id)?.volume ??
              this.groupVolume);
        const normalized = clampVolume(volume);
        if (id === undefined) this.groupVolume = normalized;
        this.forSounds(id, (sound, soundId) => {
            sound.volume = normalized;
            sound.fadeTarget = undefined;
            nativeAudioEngine.command(this.ownerId, "volume", soundId, { value: normalized });
        });
        return this;
    }

    public mute(): boolean;
    public mute(muted: boolean, id?: number): this;
    public mute(muted?: boolean, id?: number): boolean | this {
        if (muted === undefined) return id === undefined
            ? this.groupMuted
            : (this.sounds.get(id)?.muted ?? this.groupMuted);
        if (id === undefined) this.groupMuted = muted;
        this.forSounds(id, (sound, soundId) => {
            sound.muted = muted;
            nativeAudioEngine.command(this.ownerId, "mute", soundId, { value: muted });
        });
        return this;
    }

    public loop(): boolean;
    public loop(loop: boolean, id?: number): this;
    public loop(loop?: boolean, id?: number): boolean | this {
        if (loop === undefined) return id === undefined
            ? this.groupLoop
            : (this.sounds.get(id)?.loop ?? this.groupLoop);
        if (id === undefined) this.groupLoop = loop;
        this.forSounds(id, (sound, soundId) => {
            sound.loop = loop;
            nativeAudioEngine.command(this.ownerId, "loop", soundId, { value: loop });
        });
        return this;
    }

    public seek(): number;
    public seek(id: number): number;
    public seek(seek: number, id?: number): this;
    public seek(seekOrId?: number, id?: number): number | this {
        if (seekOrId === undefined) {
            const firstId = this.sounds.keys().next().value as number | undefined;
            return firstId === undefined ? 0 : (this.seek(firstId) as number);
        }
        if (id === undefined && this.sounds.has(seekOrId)) {
            const sound = this.sounds.get(seekOrId)!;
            const absolute = nativeAudioEngine.currentTime(seekOrId) ?? 0;
            const offset = sound.sprite ? (this._sprite[sound.sprite]?.[0] ?? 0) / 1000 : 0;
            return Math.max(0, absolute - offset);
        }
        if (!Number.isFinite(seekOrId) || seekOrId < 0) {
            throw new RangeError("Audio seek must be non-negative and finite");
        }
        this.forSounds(id, (_sound, soundId) => {
            nativeAudioEngine.command(this.ownerId, "seek", soundId, { value: seekOrId });
        });
        return this;
    }

    public fade(from: number, to: number, durationMs: number, id?: number): this {
        const normalizedFrom = clampVolume(from);
        const normalizedTo = clampVolume(to);
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            throw new RangeError("Fade duration must be non-negative and finite");
        }
        this.forSounds(id, (sound, soundId) => {
            sound.volume = nativeAudioEngine.currentVolume(soundId) ?? sound.volume;
            sound.fadeTarget = normalizedTo;
            nativeAudioEngine.command(this.ownerId, "fade", soundId, {
                from: normalizedFrom,
                to: normalizedTo,
                durationMs,
            });
        });
        return this;
    }

    public playing(id?: number): boolean {
        if (id !== undefined) return this.sounds.has(id) && !this.sounds.get(id)!.paused;
        return [...this.sounds.values()].some((sound) => !sound.paused);
    }

    public duration(id?: number): number {
        if (id !== undefined) {
            const sprite = this.sounds.get(id)?.sprite;
            return sprite ? (this._sprite[sprite]?.[1] ?? 0) / 1000 : 0;
        }
        return Math.max(0, ...Object.values(this._sprite).map(([offset, duration]) => (offset + duration) / 1000));
    }

    public state(): "unloaded" | "loading" | "loaded" {
        return this.loadState;
    }

    public on(event: NativeAudioEvent, callback: HowlEventCallback, id?: number): this {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push({ callback, id, once: false });
        this.listeners.set(event, listeners);
        return this;
    }

    public once(event: NativeAudioEvent, callback: HowlEventCallback, id?: number): this {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push({ callback, id, once: true });
        this.listeners.set(event, listeners);
        return this;
    }

    public off(event?: NativeAudioEvent, callback?: HowlEventCallback, id?: number): this {
        if (event === undefined) {
            this.listeners.clear();
            return this;
        }
        const listeners = this.listeners.get(event) ?? [];
        this.listeners.set(
            event,
            listeners.filter((listener) =>
                (callback !== undefined && listener.callback !== callback) ||
                (id !== undefined && listener.id !== id),
            ),
        );
        return this;
    }

    public unload(): null {
        if (this.destroyed) return null;
        this.stop();
        this.destroyed = true;
        this.loadState = "unloaded";
        nativeAudioEngine.unregisterOwner(this.ownerId);
        this.listeners.clear();
        this.sounds.clear();
        this.pendingPreloads.clear();
        howls.delete(this);
        return null;
    }

    public handleNativeAudioEvent(
        event: NativeAudioEvent,
        id?: number,
        message?: string,
    ): void {
        if (this.destroyed) return;
        if (event === "load" && this.loadState !== "loading") return;
        if (event === "load" && this.pendingPreloads.size > 0) {
            if (id !== undefined) this.pendingPreloads.delete(id);
            if (this.pendingPreloads.size > 0) return;
        }
        if (event === "load") this.loadState = "loaded";
        if (event === "loaderror") {
            this.pendingPreloads.clear();
            this.loadState = "unloaded";
        }
        if (event === "end" || event === "stop") {
            const sound = id === undefined ? undefined : this.sounds.get(id);
            if (sound && !sound.loop) this.sounds.delete(id!);
        }
        if (event === "fade" && id !== undefined) {
            const sound = this.sounds.get(id);
            if (sound?.fadeTarget !== undefined) {
                sound.volume = sound.fadeTarget;
                sound.fadeTarget = undefined;
            }
        }
        const listeners = [...(this.listeners.get(event) ?? [])];
        for (const listener of listeners) {
            if (listener.id !== undefined && listener.id !== id) continue;
            listener.callback(id, message);
            if (listener.once) this.off(event, listener.callback, listener.id);
        }
        if (event === "load" && this.options.autoplay) this.play();
    }

    private forSounds(
        id: number | undefined,
        callback: (sound: SoundState, id: number) => void,
    ): void {
        if (id !== undefined) {
            const sound = this.sounds.get(id);
            if (sound) callback(sound, id);
            return;
        }
        for (const [soundId, sound] of [...this.sounds]) callback(sound, soundId);
    }

    private assertUsable(): void {
        if (this.destroyed) throw new Error("Howl has been unloaded");
    }
}

export interface HowlerGlobal {
    volume(): number;
    volume(value: number): HowlerGlobal;
    mute(value: boolean): HowlerGlobal;
    stop(): HowlerGlobal;
    unload(): HowlerGlobal;
    codecs(extension: string): boolean;
}

function globalVolume(): number;
function globalVolume(value: number): HowlerGlobal;
function globalVolume(value?: number): number | HowlerGlobal {
    if (value === undefined) return nativeAudioEngine.volume;
    nativeAudioEngine.volume = clampVolume(value);
    return Howler;
}

export const Howler: HowlerGlobal = {
    volume: globalVolume,
    mute(value: boolean): typeof Howler {
        nativeAudioEngine.muted = value;
        return Howler;
    },
    stop(): typeof Howler {
        for (const howl of howls) howl.stop();
        nativeAudioEngine.stopAll();
        return Howler;
    },
    unload(): typeof Howler {
        for (const howl of [...howls]) howl.unload();
        nativeAudioEngine.shutdown();
        return Howler;
    },
    codecs(extension: string): boolean {
        return ["wav", "mp3", "mpeg", "ogg", "oga", "opus", "aac", "m4a", "mp4", "flac", "webm"].includes(
            extension.toLowerCase().replace(/^\./, ""),
        );
    },
};
