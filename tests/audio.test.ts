import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

        const faded = waitForEvent(howl, "fade", 2_000, first);
        howl.fade(1, 0, 50, first);
        await faded;
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
