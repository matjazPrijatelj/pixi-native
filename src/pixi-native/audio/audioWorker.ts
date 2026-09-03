import { parentPort } from "node:worker_threads";
import { spawn, type ChildProcess } from "node:child_process";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const STREAM_RESUME_SAMPLES = SAMPLE_RATE * CHANNELS;
const STREAM_PAUSE_SAMPLES = STREAM_RESUME_SAMPLES * 2;

interface Voice {
    readonly ownerId: number;
    readonly id: number;
    readonly data?: Float32Array;
    readonly stream?: StreamState;
    readonly spriteOffsetSeconds: number;
    positionFrames: number;
    renderedFrames: number;
    volume: number;
    muted: boolean;
    loop: boolean;
    playing: boolean;
    readonly playbackRate: number;
    fade?: { from: number; to: number; startFrame: number; durationFrames: number; version: number };
}

interface StreamState {
    readonly child: ChildProcess;
    readonly chunks: Float32Array[];
    chunkOffset: number;
    queuedSamples: number;
    ready: boolean;
    ended: boolean;
}

type WorkerCommand =
    | { type: "createVoice"; ownerId: number; id: number; source: string; ffmpegPath: string; offsetSeconds: number; durationSeconds?: number; volume: number; muted: boolean; loop: boolean; streaming: boolean; playbackRate: number; inputArgs: string[]; outputArgs: string[] }
    | { type: "preload"; ownerId: number; requestId: number; source: string; ffmpegPath: string; offsetSeconds: number; durationSeconds?: number }
    | { type: "render"; frames: number; globalVolume: number; globalMuted: boolean; generation: number }
    | { type: "command"; ownerId: number; id?: number; command: "play" | "pause" | "stop" | "volume" | "mute" | "loop" | "seek" | "fade"; value?: number | boolean; from?: number; to?: number; durationMs?: number; fadeVersion?: number }
    | { type: "unloadOwner"; ownerId: number }
    | { type: "clear" }
    | { type: "shutdown" };

const port = parentPort;
if (!port) throw new Error("Native audio worker requires a parent port");

const voices = new Map<number, Voice>();
const cache = new Map<string, Promise<Float32Array>>();
const ownerCacheKeys = new Map<number, Set<string>>();
const canceledVoiceIds = new Set<number>();
const pendingVoiceCommands = new Map<
    number,
    Array<Extract<WorkerCommand, { type: "command" }>>
>();
const AUTHENTICATED_URL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/giu;

// FFmpeg atempo accepts bounded factors, so extreme rates are decomposed.
function buildAtempoFilter(playbackRate: number): string {
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
        throw new RangeError("Audio playback rate must be positive and finite");
    }
    const factors: number[] = [];
    let remaining = playbackRate;
    while (remaining < 0.5) {
        factors.push(0.5);
        remaining /= 0.5;
    }
    while (remaining > 2) {
        factors.push(2);
        remaining /= 2;
    }
    factors.push(remaining);
    return factors.map((factor) => `atempo=${factor}`).join(",");
}

function redactUrlCredentials(value: string): string {
    return value.replace(AUTHENTICATED_URL_PATTERN, "$1***:***@");
}

function cacheKey(source: string, offsetSeconds: number, durationSeconds?: number): string {
    return `${source}\u0000${offsetSeconds}\u0000${durationSeconds ?? "end"}`;
}

async function decodePcm(
    source: string,
    ffmpegPath: string,
    offsetSeconds: number,
    durationSeconds?: number,
): Promise<Float32Array> {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
    if (offsetSeconds > 0) args.push("-ss", String(offsetSeconds));
    args.push("-i", source, "-vn");
    if (durationSeconds !== undefined) args.push("-t", String(durationSeconds));
    args.push("-ac", "2", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1");

    await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const chunks: Buffer[] = [];
        const errors: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
        child.once("error", reject);
        child.once("close", (code) => {
            if (code !== 0) {
                const message = Buffer.concat(errors).toString("utf8").trim();
                reject(new Error(redactUrlCredentials(message) || `FFmpeg exited with code ${code}`));
                return;
            }
            const pcm = Buffer.concat(chunks);
            if (pcm.length === 0) {
                reject(new Error("Audio stream contains no decodable samples"));
                return;
            }
            const aligned = new Uint8Array(pcm.length);
            aligned.set(pcm);
            const samples = new Float32Array(aligned.buffer);
            cache.set(cacheKey(source, offsetSeconds, durationSeconds), Promise.resolve(samples));
            resolve();
        });
    });
    return cache.get(cacheKey(source, offsetSeconds, durationSeconds))!;
}

function getDecoded(
    ownerId: number,
    source: string,
    ffmpegPath: string,
    offsetSeconds: number,
    durationSeconds?: number,
): Promise<Float32Array> {
    const key = cacheKey(source, offsetSeconds, durationSeconds);
    let keys = ownerCacheKeys.get(ownerId);
    if (!keys) ownerCacheKeys.set(ownerId, (keys = new Set()));
    keys.add(key);
    let pending = cache.get(key);
    if (!pending && (offsetSeconds > 0 || durationSeconds !== undefined)) {
        const fullSource = cache.get(cacheKey(source, 0));
        if (fullSource) {
            pending = fullSource.then((samples) => {
                const start = Math.floor(offsetSeconds * SAMPLE_RATE) * CHANNELS;
                const length = durationSeconds === undefined
                    ? samples.length - start
                    : Math.floor(durationSeconds * SAMPLE_RATE) * CHANNELS;
                return samples.subarray(start, Math.min(samples.length, start + length));
            });
            cache.set(key, pending);
        }
    }
    if (!pending) {
        pending = decodePcm(source, ffmpegPath, offsetSeconds, durationSeconds);
        cache.set(key, pending);
        pending.catch(() => cache.delete(key));
    }
    return pending;
}

function postEvent(ownerId: number, event: string, id?: number, message?: string): void {
    port!.postMessage({ type: "event", ownerId, event, id, message });
}

function matchingVoices(ownerId: number, id?: number): Voice[] {
    if (id !== undefined) {
        const voice = voices.get(id);
        return voice && voice.ownerId === ownerId ? [voice] : [];
    }
    return [...voices.values()].filter((voice) => voice.ownerId === ownerId);
}

async function createVoice(command: Extract<WorkerCommand, { type: "createVoice" }>): Promise<void> {
    canceledVoiceIds.delete(command.id);
    if (command.streaming) {
        createStreamingVoice(command);
        return;
    }
    try {
        const data = await getDecoded(
            command.ownerId,
            command.source,
            command.ffmpegPath,
            command.offsetSeconds,
            command.durationSeconds,
        );
        if (canceledVoiceIds.delete(command.id)) return;
        voices.set(command.id, {
            ownerId: command.ownerId,
            id: command.id,
            data,
            spriteOffsetSeconds: command.offsetSeconds,
            positionFrames: 0,
            renderedFrames: 0,
            volume: command.volume,
            muted: command.muted,
            loop: command.loop,
            playing: true,
            playbackRate: command.playbackRate,
        });
        postEvent(command.ownerId, "play", command.id);
        const pending = pendingVoiceCommands.get(command.id) ?? [];
        pendingVoiceCommands.delete(command.id);
        for (const pendingCommand of pending) applyCommand(pendingCommand);
    } catch (error) {
        postEvent(
            command.ownerId,
            "playerror",
            command.id,
            error instanceof Error ? error.message : String(error),
        );
    }
}

function createStreamingVoice(command: Extract<WorkerCommand, { type: "createVoice" }>): void {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
    if (command.offsetSeconds > 0) args.push("-ss", String(command.offsetSeconds));
    args.push(...command.inputArgs);
    args.push("-i", command.source, "-vn");
    if (command.durationSeconds !== undefined) args.push("-t", String(command.durationSeconds));
    if (command.playbackRate !== 1) {
        args.push("-af", buildAtempoFilter(command.playbackRate));
    }
    args.push(...command.outputArgs);
    args.push("-ac", "2", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1");

    const child = spawn(command.ffmpegPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });
    const stream: StreamState = {
        child,
        chunks: [],
        chunkOffset: 0,
        queuedSamples: 0,
        ready: false,
        ended: false,
    };
    const voice: Voice = {
        ownerId: command.ownerId,
        id: command.id,
        stream,
        spriteOffsetSeconds: command.offsetSeconds,
        positionFrames: 0,
        renderedFrames: 0,
        volume: command.volume,
        muted: command.muted,
        loop: false,
        playing: true,
        playbackRate: command.playbackRate,
    };
    voices.set(command.id, voice);

    let carry: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    const errors: Buffer[] = [];
    child.stdout.on("data", (incoming: Buffer) => {
        const data = carry.length === 0 ? incoming : Buffer.concat([carry, incoming]);
        const alignedLength = data.length - (data.length % (Float32Array.BYTES_PER_ELEMENT * CHANNELS));
        carry = alignedLength === data.length ? Buffer.alloc(0) : data.subarray(alignedLength);
        if (alignedLength === 0) return;
        const bytes = new Uint8Array(alignedLength);
        bytes.set(data.subarray(0, alignedLength));
        const samples = new Float32Array(bytes.buffer);
        stream.chunks.push(samples);
        stream.queuedSamples += samples.length;
        if (stream.queuedSamples >= STREAM_PAUSE_SAMPLES) child.stdout.pause();
        if (!stream.ready && stream.queuedSamples >= 4096) {
            stream.ready = true;
            postEvent(command.ownerId, "play", command.id);
        }
    });
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", (error) => failStreamingVoice(voice, error.message));
    child.once("close", (code) => {
        stream.ended = true;
        if (code !== 0) {
            failStreamingVoice(
                voice,
                redactUrlCredentials(Buffer.concat(errors).toString("utf8").trim()) || `FFmpeg exited with code ${code}`,
            );
            return;
        }
        if (!stream.ready && stream.queuedSamples > 0) {
            stream.ready = true;
            postEvent(command.ownerId, "play", command.id);
        } else if (stream.queuedSamples === 0) {
            failStreamingVoice(voice, "Audio stream contains no decodable samples");
        }
    });
}

function failStreamingVoice(voice: Voice, message: string): void {
    if (!voices.delete(voice.id)) return;
    postEvent(voice.ownerId, "playerror", voice.id, message);
}

function readStreamFrame(stream: StreamState): readonly [number, number] | null {
    while (stream.chunks.length > 0) {
        const chunk = stream.chunks[0];
        if (stream.chunkOffset + 1 < chunk.length) {
            const left = chunk[stream.chunkOffset];
            const right = chunk[stream.chunkOffset + 1];
            stream.chunkOffset += CHANNELS;
            stream.queuedSamples -= CHANNELS;
            if (stream.queuedSamples <= STREAM_RESUME_SAMPLES) stream.child.stdout?.resume();
            if (stream.chunkOffset >= chunk.length) {
                stream.chunks.shift();
                stream.chunkOffset = 0;
            }
            return [left, right];
        }
        stream.chunks.shift();
        stream.chunkOffset = 0;
    }
    return null;
}

function applyCommand(command: Extract<WorkerCommand, { type: "command" }>): void {
    const targets = matchingVoices(command.ownerId, command.id);
    if (command.id !== undefined && targets.length === 0) {
        if (command.command === "stop") {
            canceledVoiceIds.add(command.id);
            pendingVoiceCommands.delete(command.id);
        } else {
            const pending = pendingVoiceCommands.get(command.id) ?? [];
            pending.push(command);
            pendingVoiceCommands.set(command.id, pending);
        }
        return;
    }
    for (const voice of targets) {
        switch (command.command) {
            case "play":
                voice.playing = true;
                postEvent(voice.ownerId, "play", voice.id);
                break;
            case "pause":
                voice.playing = false;
                postEvent(voice.ownerId, "pause", voice.id);
                break;
            case "stop":
                voice.stream?.child.kill();
                voices.delete(voice.id);
                postEvent(voice.ownerId, "stop", voice.id);
                break;
            case "volume":
                voice.volume = Number(command.value);
                voice.fade = undefined;
                postEvent(voice.ownerId, "volume", voice.id);
                break;
            case "mute":
                voice.muted = Boolean(command.value);
                postEvent(voice.ownerId, "mute", voice.id);
                break;
            case "loop":
                voice.loop = Boolean(command.value);
                break;
            case "seek":
                voice.positionFrames = Math.max(0, Math.floor(Number(command.value) * SAMPLE_RATE));
                voice.fade = undefined;
                postEvent(voice.ownerId, "seek", voice.id);
                break;
            case "fade":
                voice.volume = voice.fade ? voice.volume : (command.from ?? voice.volume);
                voice.fade = {
                    from: voice.volume,
                    to: command.to ?? voice.volume,
                    startFrame: voice.renderedFrames,
                    durationFrames: Math.max(1, Math.round((command.durationMs ?? 0) * SAMPLE_RATE / 1000)),
                    version: command.fadeVersion ?? 0,
                };
                break;
        }
    }
}

function render(frames: number, globalVolume: number, globalMuted: boolean, generation: number): void {
    const output = new Float32Array(frames * CHANNELS);
    const events: Array<{
        ownerId: number;
        event: string;
        id: number;
        fadeVersion?: number;
        final?: boolean;
    }> = [];
    for (let frame = 0; frame < frames; frame++) {
        let left = 0;
        let right = 0;
        for (const voice of [...voices.values()]) {
            if (!voice.playing || (voice.stream && !voice.stream.ready)) continue;
            const sourceFrames = voice.data ? voice.data.length / CHANNELS : Number.POSITIVE_INFINITY;
            if (voice.data && voice.positionFrames >= sourceFrames) {
                if (voice.loop) {
                    voice.positionFrames = 0;
                    events.push({ ownerId: voice.ownerId, event: "end", id: voice.id, final: false });
                } else {
                    voices.delete(voice.id);
                    events.push({ ownerId: voice.ownerId, event: "end", id: voice.id, final: true });
                    continue;
                }
            }
            const streamFrame = voice.stream ? readStreamFrame(voice.stream) : null;
            if (voice.stream && !streamFrame) {
                if (voice.stream.ended) {
                    voices.delete(voice.id);
                    events.push({ ownerId: voice.ownerId, event: "end", id: voice.id, final: true });
                }
                continue;
            }
            if (voice.fade) {
                const elapsed = voice.renderedFrames - voice.fade.startFrame;
                const progress = Math.min(1, Math.max(0, elapsed / voice.fade.durationFrames));
                voice.volume = voice.fade.from + (voice.fade.to - voice.fade.from) * progress;
                if (progress >= 1) {
                    const fadeVersion = voice.fade.version;
                    voice.volume = voice.fade.to;
                    voice.fade = undefined;
                    events.push({
                        ownerId: voice.ownerId,
                        event: "fade",
                        id: voice.id,
                        fadeVersion,
                    });
                }
            }
            const gain = voice.muted || globalMuted ? 0 : voice.volume * globalVolume;
            const sampleIndex = voice.positionFrames * CHANNELS;
            left += (streamFrame?.[0] ?? voice.data![sampleIndex]) * gain;
            right += (streamFrame?.[1] ?? voice.data![sampleIndex + 1]) * gain;
            voice.positionFrames++;
            voice.renderedFrames++;
        }
        output[frame * CHANNELS] = Math.max(-1, Math.min(1, left));
        output[frame * CHANNELS + 1] = Math.max(-1, Math.min(1, right));
    }
    const positions = [...voices.values()].map((voice) => ({
        id: voice.id,
        ownerId: voice.ownerId,
        seconds: voice.spriteOffsetSeconds + voice.positionFrames * voice.playbackRate / SAMPLE_RATE,
        playing: voice.playing,
        volume: voice.volume,
        playbackRate: voice.playbackRate,
    }));
    port!.postMessage(
        { type: "chunk", buffer: output.buffer, frames, positions, events, generation },
        [output.buffer],
    );
}

port.on("message", (command: WorkerCommand) => {
    switch (command.type) {
        case "createVoice":
            void createVoice(command);
            break;
        case "preload":
            void getDecoded(command.ownerId, command.source, command.ffmpegPath, command.offsetSeconds, command.durationSeconds)
                .then(() => port.postMessage({ type: "preloaded", ownerId: command.ownerId, requestId: command.requestId }))
                .catch((error) => postEvent(command.ownerId, "loaderror", undefined, error instanceof Error ? error.message : String(error)));
            break;
        case "render":
            render(command.frames, command.globalVolume, command.globalMuted, command.generation);
            break;
        case "command":
            applyCommand(command);
            break;
        case "unloadOwner": {
            for (const voice of matchingVoices(command.ownerId)) {
                voice.stream?.child.kill();
                voices.delete(voice.id);
            }
            for (const [id, commands] of pendingVoiceCommands) {
                if (commands[0]?.ownerId === command.ownerId) pendingVoiceCommands.delete(id);
            }
            for (const key of ownerCacheKeys.get(command.ownerId) ?? []) cache.delete(key);
            ownerCacheKeys.delete(command.ownerId);
            break;
        }
        case "clear":
            for (const voice of voices.values()) voice.stream?.child.kill();
            voices.clear();
            canceledVoiceIds.clear();
            pendingVoiceCommands.clear();
            cache.clear();
            ownerCacheKeys.clear();
            break;
        case "shutdown":
            for (const voice of voices.values()) voice.stream?.child.kill();
            voices.clear();
            cache.clear();
            pendingVoiceCommands.clear();
            process.exit(0);
    }
});
