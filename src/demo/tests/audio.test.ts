import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    DRUM_ATLAS,
    DRUM_PADS,
    DRUM_SOURCE_PATH,
    getDrumPadForKey,
} from "../v8/drumKit.ts";

const source = fileURLToPath(
    new URL("../assets/audio/howler-test.wav", import.meta.url),
);

test("generated audio fixture has a valid stereo 48 kHz WAV header", async () => {
    assert.equal(existsSync(source), true);
    const { readFile } = await import("node:fs/promises");
    const wav = await readFile(source);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 48_000);
});

test("drum MP3 atlas maps eight keys to valid sprites and transparent hit regions", async () => {
    const { readFile } = await import("node:fs/promises");
    const mp3 = await readFile(DRUM_SOURCE_PATH);
    assert.ok(
        mp3.subarray(0, 3).toString("ascii") === "ID3" ||
        (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0),
    );
    assert.deepEqual(
        DRUM_PADS.map(({ key, sprite }) => [key, sprite]),
        [
            ["u", "crash"],
            ["i", "closedHat"],
            ["o", "ride"],
            ["p", "highTom"],
            ["j", "snare"],
            ["k", "kick"],
            ["l", "floorTom"],
            ["č", "openHat"],
        ],
    );
    assert.equal(getDrumPadForKey("Č")?.sprite, "openHat");
    assert.equal(getDrumPadForKey("x"), undefined);
    for (const pad of DRUM_PADS) {
        assert.ok(DRUM_ATLAS.sprite[pad.sprite]);
        assert.ok(pad.hit.x - pad.hit.radiusX >= 0);
        assert.ok(pad.hit.x + pad.hit.radiusX <= 1);
        assert.ok(pad.hit.y - pad.hit.radiusY >= 0);
        assert.ok(pad.hit.y + pad.hit.radiusY <= 1);
    }

    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const texturePath = fileURLToPath(new URL("../assets/drum-kit.png", import.meta.url));
    const image = await loadImage(texturePath);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let transparentPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] === 0) transparentPixels++;
    }
    assert.ok(transparentPixels > pixels.length / 16);
});

test("Howler-compatible sprites overlap and fade through the native mixer", async () => {
    process.env.SDL_AUDIODRIVER = "dummy";
    const { Howl, Howler, nativeAudioEngine } = await import(
        "../../pixi-native/audio/index.ts"
    );
    const howl = new Howl({
        src: [source],
        sprite: {
            toneA: [0, 800],
            toneB: [1000, 800],
        },
        preloadSprites: true,
    });

    try {
        await waitForEvent(howl, "load", 5_000);
        assert.equal(howl.state(), "loaded");
        const first = howl.play("toneA");
        const second = howl.play("toneB");
        assert.notEqual(first, second);
        await Promise.all([
            waitForEvent(howl, "play", 5_000, first),
            waitForEvent(howl, "play", 5_000, second),
        ]);
        assert.equal(howl.playing(first), true);
        assert.equal(howl.playing(second), true);

        let fadeEvents = 0;
        howl.on("fade", () => { fadeEvents++; }, first);
        howl.fade(0, 1, 300, first);
        await delay(100);
        const volumeBeforeRepeat = howl.volume(undefined, first);
        assert.ok(volumeBeforeRepeat > 0.1);
        const faded = waitForEvent(howl, "fade", 2_000, first);
        howl.fade(0, 0.8, 250, first);
        await delay(40);
        const volumeAfterRepeat = howl.volume(undefined, first);
        assert.ok(volumeAfterRepeat >= volumeBeforeRepeat * 0.7);
        await faded;
        await delay(100);
        assert.equal(fadeEvents, 1);
        assert.ok(Math.abs(howl.volume(undefined, first) - 0.8) < 0.05);
        howl.stop();
        assert.equal(howl.playing(), false);
        assert.ok(nativeAudioEngine.diagnostics.queuedMs >= 0);

        const stream = new Howl({
            src: [source],
            sprite: { toneA: [0, 800] },
            html5: true,
            preload: false,
        });
        const streamId = stream.play("toneA");
        await waitForEvent(stream, "play", 5_000, streamId);
        await waitForEvent(stream, "end", 5_000, streamId);
        assert.equal(stream.playing(streamId), false);

        const looping = new Howl({
            src: [source],
            sprite: { looping: [0, 800, true] },
            preloadSprites: true,
        });
        await waitForEvent(looping, "load", 5_000);
        const loopingId = looping.play("looping");
        await waitForEvent(looping, "play", 5_000, loopingId);
        const loopFade = waitForEvent(looping, "fade", 3_000, loopingId);
        looping.fade(0, 1, 1_100, loopingId);
        await loopFade;
        assert.ok(Math.abs(looping.volume(undefined, loopingId) - 1) < 0.05);
        looping.stop(loopingId);

        const drums = new Howl({
            src: [DRUM_SOURCE_PATH],
            sprite: DRUM_ATLAS.sprite,
        });
        await waitForEvent(drums, "load", 5_000);
        const drumIds = DRUM_PADS.map((pad) => drums.play(pad.sprite));
        assert.equal(new Set(drumIds).size, DRUM_PADS.length);
        await Promise.all(
            drumIds.map((id) => waitForEvent(drums, "play", 5_000, id)),
        );
        assert.ok(drumIds.every((id) => drums.playing(id)));
        drums.stop();
    } finally {
        Howler.unload();
    }
});

test("Windows native audio advances while JS is blocked and batches audible events once", {
    skip: process.platform !== "win32" || process.arch !== "x64",
}, async () => {
    const { Howl, Howler } = await import("../../pixi-native/audio/index.ts");
    const howl = new Howl({
        src: [source],
        sprite: { blocked: [0, 350] },
        preloadSprites: true,
    });

    try {
        await waitForEvent(howl, "load", 5_000);
        const id = howl.play("blocked");
        await waitForEvent(howl, "play", 5_000, id);
        const events: string[] = [];
        howl.on("fade", () => events.push("fade"), id);
        howl.on("end", () => events.push("end"), id);
        howl.fade(1, 0.5, 100, id);

        const startedAt = performance.now();
        const initialTime = howl.seek(id) as number;
        let blockedTime = initialTime;
        while (performance.now() - startedAt < 500) {
            if (performance.now() - startedAt >= 150 && blockedTime === initialTime) {
                blockedTime = howl.seek(id) as number;
            }
        }

        assert.ok(blockedTime >= initialTime + 0.08);
        assert.deepEqual(events, []);
        await waitUntil(() => events.length === 2, 2_000);
        assert.deepEqual(events, ["fade", "end"]);
        await delay(50);
        assert.deepEqual(events, ["fade", "end"]);
    } finally {
        howl.unload();
        Howler.unload();
    }
});

test("Windows streaming audio keeps pace for fifteen seconds without underruns", {
    skip: process.platform !== "win32" || process.arch !== "x64",
    timeout: 25_000,
}, async () => {
    const { Howl, Howler, nativeAudioEngine } = await import(
        "../../pixi-native/audio/index.ts"
    );
    const videoSource = fileURLToPath(
        new URL("../assets/Big_Buck_Bunny_1080_30s.mp4", import.meta.url),
    );
    const audio = new Howl({
        src: [videoSource],
        sprite: { video: [0, 20_000] },
        html5: true,
        preload: false,
    });

    try {
        const id = audio.play("video");
        await waitForEvent(audio, "play", 5_000, id);
        const initialTime = audio.seek(id) as number;
        const initialUnderruns = nativeAudioEngine.diagnostics.underruns;
        const startedAt = performance.now();
        await delay(15_000);
        const elapsedSeconds = (performance.now() - startedAt) / 1000;
        const advancedSeconds = (audio.seek(id) as number) - initialTime;
        const diagnostics = nativeAudioEngine.diagnostics;

        assert.ok(Math.abs(advancedSeconds - elapsedSeconds) < 0.1);
        assert.equal(diagnostics.underruns, initialUnderruns);
        assert.ok(diagnostics.queuedMs >= 1_500);
        assert.ok(diagnostics.queuedMs <= 2_100);
    } finally {
        audio.unload();
        Howler.unload();
    }
});

test("Windows native audio binding preflight is platform-specific", async () => {
    const { resolveWindowsNativeAudioBindingPath } = await import(
        "../../pixi-native/audio/NativeAudioEngine.ts"
    );
    assert.throws(
        () => resolveWindowsNativeAudioBindingPath("linux", "x64"),
        /only Windows x64/,
    );
    assert.match(
        resolveWindowsNativeAudioBindingPath("win32", "x64"),
        /native[\\/]audio[\\/]dist[\\/]win32-x64[\\/]native_audio\.node$/,
    );
});

interface EventSource {
    once(event: AudioTestEvent, callback: (id?: number) => void, id?: number): unknown;
    off(event: AudioTestEvent, callback: (id?: number) => void, id?: number): unknown;
}

type AudioTestEvent = "load" | "play" | "fade" | "end";

function waitForEvent(
    source: EventSource,
    event: AudioTestEvent,
    timeoutMs: number,
    id?: number,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const callback = (): void => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            source.off(event, callback, id);
            reject(new Error(`Timed out waiting for audio ${event}`));
        }, timeoutMs);
        source.once(event, callback, id);
    });
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
        if (performance.now() >= deadline) throw new Error("Timed out waiting for condition");
        await delay(5);
    }
}
