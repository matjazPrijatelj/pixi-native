import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import * as sdl from "@kmamal/sdl";
import { resolveNativePlatformModules } from "../runtime/platformNative.js";
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 4;
const CHUNK_FRAMES = 512;
const TARGET_QUEUE_FRAMES = 2048;
const AUDIO_WORKER_MODULE = import.meta.url.endsWith(".ts")
    ? "./audioWorker.ts"
    : "./audioWorker.js";
function resolveFfmpegPath() {
    const configured = process.env.FFMPEG_PATH?.trim();
    if (configured)
        return configured;
    const bundled = resolveNativePlatformModules().ffmpeg;
    return existsSync(bundled) ? bundled : "ffmpeg";
}
export class NativeAudioEngine {
    owners = new Map();
    positions = new Map();
    voiceOwners = new Map();
    fadeVersions = new Map();
    eventTimers = new Set();
    worker;
    device;
    pumpTimer;
    renderPending = false;
    nextOwnerId = 1;
    nextVoiceId = 1;
    nextPreloadId = 1;
    submittedFrames = 0;
    globalVolume = 1;
    globalMuted = false;
    queueGeneration = 0;
    registerOwner(owner) {
        const id = this.nextOwnerId++;
        this.owners.set(id, owner);
        return id;
    }
    unregisterOwner(ownerId) {
        this.owners.delete(ownerId);
        this.worker?.postMessage({ type: "unloadOwner", ownerId });
        for (const [id, position] of this.positions) {
            if (position.ownerId === ownerId)
                this.positions.delete(id);
        }
        for (const [id, voiceOwnerId] of this.voiceOwners) {
            if (voiceOwnerId !== ownerId)
                continue;
            this.voiceOwners.delete(id);
            this.fadeVersions.delete(id);
        }
    }
    createVoice(ownerId, options) {
        this.ensureStarted();
        const id = this.nextVoiceId++;
        this.voiceOwners.set(id, ownerId);
        this.worker.postMessage({
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
    preload(ownerId, source, offsetSeconds, durationSeconds) {
        this.ensureStarted();
        const requestId = this.nextPreloadId++;
        this.worker.postMessage({
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
    command(ownerId, command, id, values = {}) {
        let fadeVersion;
        if (id !== undefined &&
            (command === "fade" || command === "volume" || command === "seek" || command === "stop")) {
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
    currentTime(id) {
        const position = this.positions.get(id);
        if (!position)
            return undefined;
        if (!position.playing || !this.device)
            return position.seconds;
        const queuedFrames = this.device.queued / (CHANNELS * BYTES_PER_SAMPLE);
        const audibleFrame = this.submittedFrames - queuedFrames;
        return Math.max(0, position.seconds -
            (position.outputFrame - audibleFrame) * position.playbackRate / SAMPLE_RATE);
    }
    currentVolume(id) {
        return this.positions.get(id)?.volume;
    }
    get volume() {
        return this.globalVolume;
    }
    set volume(value) {
        this.globalVolume = value;
    }
    get muted() {
        return this.globalMuted;
    }
    set muted(value) {
        this.globalMuted = value;
    }
    get diagnostics() {
        return {
            activeVoices: this.positions.size,
            queuedMs: this.device
                ? (this.device.queued * 1000) /
                    (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
                : 0,
            underruns: 0,
        };
    }
    stopAll() {
        this.worker?.postMessage({ type: "clear" });
        this.positions.clear();
        this.voiceOwners.clear();
        this.fadeVersions.clear();
        this.clearQueuedOutput();
    }
    clearQueuedOutput() {
        this.queueGeneration++;
        this.device?.clearQueue();
        this.submittedFrames = 0;
    }
    shutdown() {
        this.stopAll();
        if (this.pumpTimer)
            clearInterval(this.pumpTimer);
        this.pumpTimer = undefined;
        for (const timer of this.eventTimers)
            clearTimeout(timer);
        this.eventTimers.clear();
        this.worker?.postMessage({ type: "shutdown" });
        void this.worker?.terminate();
        this.worker = undefined;
        if (this.device && !this.device.closed)
            this.device.close();
        this.device = undefined;
        this.owners.clear();
    }
    ensureStarted() {
        if (this.worker && this.device)
            return;
        this.device = sdl.audio.openDevice({ type: "playback" }, { channels: CHANNELS, frequency: SAMPLE_RATE, format: "f32", buffered: 1024 });
        this.worker = new Worker(new URL(AUDIO_WORKER_MODULE, import.meta.url), {
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
    pump() {
        if (!this.device || !this.worker || this.renderPending)
            return;
        const queuedFrames = this.device.queued / (CHANNELS * BYTES_PER_SAMPLE);
        if (queuedFrames >= TARGET_QUEUE_FRAMES)
            return;
        this.renderPending = true;
        this.worker.postMessage({
            type: "render",
            frames: CHUNK_FRAMES,
            globalVolume: this.globalVolume,
            globalMuted: this.globalMuted,
            generation: this.queueGeneration,
        });
    }
    handleWorkerMessage(message) {
        if (message.type === "event") {
            this.dispatch(message.ownerId, message.event, message.id, message.message);
            return;
        }
        if (message.type === "preloaded") {
            this.dispatch(message.ownerId, "load", message.requestId);
            return;
        }
        if (message.type !== "chunk" || !this.device)
            return;
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
        const audibleDelayMs = (this.device.queued * 1000) /
            (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE);
        for (const event of message.events) {
            const timer = setTimeout(() => {
                this.eventTimers.delete(timer);
                if (event.event === "fade" &&
                    event.fadeVersion !== this.fadeVersions.get(event.id)) {
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
    dispatch(ownerId, event, id, message) {
        this.owners.get(ownerId)?.handleNativeAudioEvent(event, id, message);
    }
}
export function resolveWindowsNativeAudioBindingPath(platform = process.platform, arch = process.arch) {
    if (platform !== "win32" || arch !== "x64") {
        throw new Error(`Native WASAPI audio supports only Windows x64, not ${platform}-${arch}`);
    }
    return resolveNativePlatformModules(platform, arch).audioBinding;
}
class WindowsNativeAudioEngine {
    owners = new Map();
    fadeVersions = new Map();
    native;
    nextOwnerId = 1;
    nextVoiceId = 1;
    nextPreloadId = 1;
    globalVolume = 1;
    globalMuted = false;
    registerOwner(owner) {
        const id = this.nextOwnerId++;
        this.owners.set(id, owner);
        return id;
    }
    unregisterOwner(ownerId) {
        this.owners.delete(ownerId);
        this.native?.unloadOwner(ownerId);
    }
    createVoice(ownerId, options) {
        const native = this.ensureStarted();
        const id = this.nextVoiceId++;
        native.createVoice({
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
    preload(ownerId, source, offsetSeconds, durationSeconds) {
        const native = this.ensureStarted();
        const requestId = this.nextPreloadId++;
        native.preload(ownerId, requestId, source, resolveFfmpegPath(), offsetSeconds, durationSeconds);
        return requestId;
    }
    command(ownerId, command, id, values = {}) {
        let fadeVersion;
        if (id !== undefined &&
            (command === "fade" || command === "volume" || command === "seek" || command === "stop")) {
            fadeVersion = (this.fadeVersions.get(id) ?? 0) + 1;
            this.fadeVersions.set(id, fadeVersion);
        }
        this.native?.command({
            ownerId,
            command,
            id,
            value: typeof values.value === "number" ? values.value : undefined,
            boolValue: typeof values.value === "boolean" ? values.value : undefined,
            from: values.from,
            to: values.to,
            durationMs: values.durationMs,
            fadeVersion,
        });
    }
    currentTime(id) {
        return this.native?.currentTime(id) ?? undefined;
    }
    currentVolume(id) {
        return this.native?.currentVolume(id) ?? undefined;
    }
    get volume() {
        return this.globalVolume;
    }
    set volume(value) {
        this.globalVolume = value;
        this.native?.setGlobalVolume(value);
    }
    get muted() {
        return this.globalMuted;
    }
    set muted(value) {
        this.globalMuted = value;
        this.native?.setGlobalMuted(value);
    }
    get diagnostics() {
        return this.native?.diagnostics() ?? { activeVoices: 0, queuedMs: 0, underruns: 0 };
    }
    stopAll() {
        this.native?.stopAll();
        this.fadeVersions.clear();
    }
    /** WASAPI owns already submitted audio, so modal rendering must never flush it. */
    clearQueuedOutput() { }
    shutdown() {
        this.native?.shutdown();
        this.native = undefined;
        this.owners.clear();
        this.fadeVersions.clear();
    }
    ensureStarted() {
        if (this.native)
            return this.native;
        const bindingPath = resolveWindowsNativeAudioBindingPath();
        if (!existsSync(bindingPath)) {
            throw new Error(`Missing Windows native audio addon: ${bindingPath}. ` +
                "Build it with pnpm native:audio:build.");
        }
        const require = createRequire(import.meta.url);
        const binding = require(bindingPath);
        this.native = new binding.NativeAudioEngine(() => this.dispatchPendingEvents());
        this.native.setGlobalVolume(this.globalVolume);
        this.native.setGlobalMuted(this.globalMuted);
        return this.native;
    }
    dispatchPendingEvents() {
        const events = this.native?.drainEvents() ?? [];
        for (const event of events) {
            this.owners.get(event.ownerId)?.handleNativeAudioEvent(event.event, event.id, event.message);
        }
    }
}
export const nativeAudioEngine = process.platform === "win32"
    ? new WindowsNativeAudioEngine()
    : new NativeAudioEngine();
