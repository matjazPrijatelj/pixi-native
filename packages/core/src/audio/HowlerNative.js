import { nativeAudioEngine, } from "./NativeAudioEngine.js";
const OPTION_EVENTS = [
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
function clampVolume(value) {
    if (!Number.isFinite(value))
        throw new RangeError("Audio volume must be finite");
    return Math.max(0, Math.min(1, value));
}
const howls = new Set();
export class Howl {
    _sprite;
    options;
    sources;
    ownerId;
    listeners = new Map();
    sounds = new Map();
    groupVolume;
    groupMuted;
    groupLoop;
    loadState = "unloaded";
    pendingPreloads = new Set();
    destroyed = false;
    constructor(options) {
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
            if (typeof callback === "function")
                this.on(event, callback);
        }
        if (options.preload !== false)
            this.load();
    }
    load() {
        this.assertUsable();
        if (this.loadState !== "unloaded")
            return this;
        this.loadState = "loading";
        const entries = Object.values(this._sprite);
        if (this.options.html5) {
            queueMicrotask(() => this.handleNativeAudioEvent("load"));
        }
        else if (this.options.preloadSprites && entries.length > 0) {
            for (const [offsetMs, durationMs] of entries) {
                const requestId = nativeAudioEngine.preload(this.ownerId, this.sources[0], offsetMs / 1000, durationMs / 1000);
                this.pendingPreloads.add(requestId);
            }
        }
        else {
            const requestId = nativeAudioEngine.preload(this.ownerId, this.sources[0], 0);
            this.pendingPreloads.add(requestId);
        }
        return this;
    }
    play(spriteOrId) {
        this.assertUsable();
        if (typeof spriteOrId === "number") {
            const sound = this.sounds.get(spriteOrId);
            if (!sound)
                return -1;
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
        }
        catch (error) {
            this.handleNativeAudioEvent("playerror", undefined, error instanceof Error ? error.message : String(error));
            return -1;
        }
    }
    pause(id) {
        this.forSounds(id, (sound, soundId) => {
            sound.paused = true;
            nativeAudioEngine.command(this.ownerId, "pause", soundId);
        });
        return this;
    }
    stop(id) {
        this.forSounds(id, (_sound, soundId) => {
            nativeAudioEngine.command(this.ownerId, "stop", soundId);
            this.sounds.delete(soundId);
        });
        return this;
    }
    volume(volume, id) {
        if (volume === undefined)
            return id === undefined
                ? this.groupVolume
                : (nativeAudioEngine.currentVolume(id) ??
                    this.sounds.get(id)?.volume ??
                    this.groupVolume);
        const normalized = clampVolume(volume);
        if (id === undefined)
            this.groupVolume = normalized;
        this.forSounds(id, (sound, soundId) => {
            sound.volume = normalized;
            sound.fadeTarget = undefined;
            nativeAudioEngine.command(this.ownerId, "volume", soundId, { value: normalized });
        });
        return this;
    }
    mute(muted, id) {
        if (muted === undefined)
            return id === undefined
                ? this.groupMuted
                : (this.sounds.get(id)?.muted ?? this.groupMuted);
        if (id === undefined)
            this.groupMuted = muted;
        this.forSounds(id, (sound, soundId) => {
            sound.muted = muted;
            nativeAudioEngine.command(this.ownerId, "mute", soundId, { value: muted });
        });
        return this;
    }
    loop(loop, id) {
        if (loop === undefined)
            return id === undefined
                ? this.groupLoop
                : (this.sounds.get(id)?.loop ?? this.groupLoop);
        if (id === undefined)
            this.groupLoop = loop;
        this.forSounds(id, (sound, soundId) => {
            sound.loop = loop;
            nativeAudioEngine.command(this.ownerId, "loop", soundId, { value: loop });
        });
        return this;
    }
    seek(seekOrId, id) {
        if (seekOrId === undefined) {
            const firstId = this.sounds.keys().next().value;
            return firstId === undefined ? 0 : this.seek(firstId);
        }
        if (id === undefined && this.sounds.has(seekOrId)) {
            const sound = this.sounds.get(seekOrId);
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
    fade(from, to, durationMs, id) {
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
    playing(id) {
        if (id !== undefined)
            return this.sounds.has(id) && !this.sounds.get(id).paused;
        return [...this.sounds.values()].some((sound) => !sound.paused);
    }
    duration(id) {
        if (id !== undefined) {
            const sprite = this.sounds.get(id)?.sprite;
            return sprite ? (this._sprite[sprite]?.[1] ?? 0) / 1000 : 0;
        }
        return Math.max(0, ...Object.values(this._sprite).map(([offset, duration]) => (offset + duration) / 1000));
    }
    state() {
        return this.loadState;
    }
    on(event, callback, id) {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push({ callback, id, once: false });
        this.listeners.set(event, listeners);
        return this;
    }
    once(event, callback, id) {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push({ callback, id, once: true });
        this.listeners.set(event, listeners);
        return this;
    }
    off(event, callback, id) {
        if (event === undefined) {
            this.listeners.clear();
            return this;
        }
        const listeners = this.listeners.get(event) ?? [];
        this.listeners.set(event, listeners.filter((listener) => (callback !== undefined && listener.callback !== callback) ||
            (id !== undefined && listener.id !== id)));
        return this;
    }
    unload() {
        if (this.destroyed)
            return null;
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
    handleNativeAudioEvent(event, id, message) {
        if (this.destroyed)
            return;
        if (event === "load" && this.loadState !== "loading")
            return;
        if (event === "load" && this.pendingPreloads.size > 0) {
            if (id !== undefined)
                this.pendingPreloads.delete(id);
            if (this.pendingPreloads.size > 0)
                return;
        }
        if (event === "load")
            this.loadState = "loaded";
        if (event === "loaderror") {
            this.pendingPreloads.clear();
            this.loadState = "unloaded";
        }
        if (event === "end" || event === "stop") {
            const sound = id === undefined ? undefined : this.sounds.get(id);
            if (sound && !sound.loop)
                this.sounds.delete(id);
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
            if (listener.id !== undefined && listener.id !== id)
                continue;
            listener.callback(id, message);
            if (listener.once)
                this.off(event, listener.callback, listener.id);
        }
        if (event === "load" && this.options.autoplay)
            this.play();
    }
    forSounds(id, callback) {
        if (id !== undefined) {
            const sound = this.sounds.get(id);
            if (sound)
                callback(sound, id);
            return;
        }
        for (const [soundId, sound] of [...this.sounds])
            callback(sound, soundId);
    }
    assertUsable() {
        if (this.destroyed)
            throw new Error("Howl has been unloaded");
    }
}
function globalVolume(value) {
    if (value === undefined)
        return nativeAudioEngine.volume;
    nativeAudioEngine.volume = clampVolume(value);
    return Howler;
}
export const Howler = {
    volume: globalVolume,
    mute(value) {
        nativeAudioEngine.muted = value;
        return Howler;
    },
    stop() {
        for (const howl of howls)
            howl.stop();
        nativeAudioEngine.stopAll();
        return Howler;
    },
    unload() {
        for (const howl of [...howls])
            howl.unload();
        nativeAudioEngine.shutdown();
        return Howler;
    },
    codecs(extension) {
        return ["wav", "mp3", "mpeg", "ogg", "oga", "opus", "aac", "m4a", "mp4", "flac", "webm"].includes(extension.toLowerCase().replace(/^\./, ""));
    },
};
