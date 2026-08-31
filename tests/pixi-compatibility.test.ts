import test from "node:test";
import assert from "node:assert/strict";
import { FrameScheduler } from "../src/pixi-node/FrameScheduler.ts";
import { prepareRgbaPixelsForUpload } from "../src/pixi-node/rgbaUpload.ts";

test("Canvas RGBA pixels are reordered for BGRA textures", () => {
    const source = new Uint8ClampedArray([255, 32, 64, 255]);
    const result = prepareRgbaPixelsForUpload(
        source,
        "bgra8unorm",
        false,
    );

    assert.deepEqual(Array.from(result), [64, 32, 255, 255]);
    assert.deepEqual(Array.from(source), [255, 32, 64, 255]);
});

test("Canvas pixels retain RGBA order and support premultiplied alpha", () => {
    const source = new Uint8Array([200, 100, 50, 128]);
    const directUpload = prepareRgbaPixelsForUpload(
        source,
        "rgba8unorm",
        false,
    );

    assert.deepEqual(Array.from(directUpload), [200, 100, 50, 128]);
    assert.equal(directUpload.buffer, source.buffer);
    assert.deepEqual(
        Array.from(
            prepareRgbaPixelsForUpload(source, "rgba8unorm", true),
        ),
        [100, 50, 25, 128],
    );
});

test("frame scheduler skips missed slots without an immediate catch-up frame", () => {
    let now = 0;
    const timers: Array<{ callback: () => void; delayMS: number }> = [];
    const scheduler = new FrameScheduler({
        now: () => now,
        frameIntervalMS: 10,
        setTimer: (callback, delayMS) => {
            timers.push({ callback, delayMS });
            return timers.length;
        },
    });
    const timestamps: number[] = [];
    const animate = (timestamp: number): void => {
        timestamps.push(timestamp);
        scheduler.request(animate);
    };

    scheduler.request(animate);
    assert.equal(timers[0].delayMS, 10);

    now = 35;
    timers[0].callback();

    assert.deepEqual(timestamps, [35]);
    assert.equal(timers[1].delayMS, 5);
    assert.ok(timers[1].delayMS > 0);
});

test("canceling the final frame request clears its timer", () => {
    const clearedTimers: unknown[] = [];
    const scheduler = new FrameScheduler({
        now: () => 0,
        setTimer: () => 42,
        clearTimer: (timer) => clearedTimers.push(timer),
    });

    const id = scheduler.request(() => undefined);
    scheduler.cancel(id);

    assert.deepEqual(clearedTimers, [42]);
});
