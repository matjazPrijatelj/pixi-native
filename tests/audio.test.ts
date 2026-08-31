import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    DRUM_ATLAS,
    DRUM_PADS,
    DRUM_SOURCE_PATH,
    getDrumPadForKey,
} from "../src/demo/drumKit.ts";

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
        "../src/pixi-node/audio/index.ts"
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
