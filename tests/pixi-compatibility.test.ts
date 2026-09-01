import test from "node:test";
import assert from "node:assert/strict";
import {
    FrameScheduler,
    VSyncFrameScheduler,
} from "../src/pixi-node/FrameScheduler.ts";
import {
    getReusableUploadBuffer,
    prepareRgbaPixelsForUpload,
} from "../src/pixi-node/rgbaUpload.ts";
import { normalizeGpuBindGroupIndex } from "../src/pixi-node/gpuCompatibility.ts";
import { requireWindowsModalFrameSupport } from "../src/pixi-node/modalFrame.ts";

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

test("Canvas conversion reuses bounded staging buffers by byte length", () => {
    const buffers = new Map<number, Uint8Array>();
    const first = getReusableUploadBuffer(buffers, 4);
    const second = getReusableUploadBuffer(buffers, 4);
    const converted = prepareRgbaPixelsForUpload(
        new Uint8Array([10, 20, 30, 255]),
        "bgra8unorm",
        false,
        first,
    );

    assert.equal(first, second);
    assert.equal(converted, first);
    assert.deepEqual(Array.from(converted), [30, 20, 10, 255]);
    assert.equal(buffers.size, 1);
});

test("native Dawn bind-group indices are normalized to numbers", () => {
    assert.equal(normalizeGpuBindGroupIndex("2"), 2);
    assert.equal(normalizeGpuBindGroupIndex(1), 1);
    assert.throws(() => normalizeGpuBindGroupIndex("invalid"), /Invalid/);
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
    assert.equal(timers[1].delayMS, 9.5);
    assert.ok(timers[1].delayMS > 0);
});

test("frame scheduler rearms when a timer fires before its deadline", () => {
    let now = 0;
    const timers: Array<{ callback: () => void; delayMS: number }> = [];
    const timestamps: number[] = [];
    const scheduler = new FrameScheduler({
        now: () => now,
        frameIntervalMS: 10,
        earlyToleranceMS: 0,
        setTimer: (callback, delayMS) => {
            timers.push({ callback, delayMS });
            return timers.length;
        },
    });

    scheduler.request((timestamp) => timestamps.push(timestamp));
    now = 8;
    timers[0].callback();

    assert.deepEqual(timestamps, []);
    assert.equal(timers[1].delayMS, 2);

    now = 10;
    timers[1].callback();
    assert.deepEqual(timestamps, [10]);
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

test("modal timer dispatch runs the current RAF batch exactly once", () => {
    const clearedTimers: unknown[] = [];
    const scheduler = new FrameScheduler({
        now: () => 0,
        setTimer: () => 42,
        clearTimer: (timer) => clearedTimers.push(timer),
    });
    const timestamps: number[] = [];

    scheduler.request((timestamp) => {
        timestamps.push(timestamp);
        scheduler.request((nextTimestamp) => timestamps.push(nextTimestamp));
    });

    assert.equal(scheduler.dispatchNow(25), 1);
    assert.deepEqual(timestamps, [25]);
    assert.deepEqual(clearedTimers, [42]);
    assert.equal(scheduler.dispatchNow(40), 1);
    assert.deepEqual(timestamps, [25, 40]);
});

test("VSync frame scheduler batches callbacks on the native present signal", async () => {
    const waiters: Array<(signaled: boolean) => void> = [];
    const scheduler = new VSyncFrameScheduler({
        now: () => 123.5,
        waitForPresent: () =>
            new Promise<boolean>((resolve) => waiters.push(resolve)),
    });
    const timestamps: number[] = [];

    scheduler.request((timestamp) => timestamps.push(timestamp));
    scheduler.request((timestamp) => timestamps.push(timestamp));
    assert.equal(waiters.length, 1);

    waiters[0](true);
    await Promise.resolve();
    assert.deepEqual(timestamps, [123.5, 123.5]);
});

test("VSync frame scheduler falls back to a timer and honors cancellation", async () => {
    const waiters: Array<(signaled: boolean) => void> = [];
    const timers: Array<{ callback: () => void; delayMS: number }> = [];
    const scheduler = new VSyncFrameScheduler({
        now: () => 200,
        waitForPresent: () =>
            new Promise<boolean>((resolve) => waiters.push(resolve)),
        fallbackFrameIntervalMS: 10,
        setTimer: (callback, delayMS) => {
            timers.push({ callback, delayMS });
            return timers.length;
        },
    });
    const timestamps: number[] = [];
    const canceledId = scheduler.request(() => timestamps.push(-1));
    scheduler.cancel(canceledId);
    scheduler.request((timestamp) => timestamps.push(timestamp));

    waiters[0](false);
    await Promise.resolve();
    assert.equal(waiters.length, 1);
    assert.equal(timers[0].delayMS, 10);

    timers[0].callback();
    assert.deepEqual(timestamps, [200]);
});

test("modal VSync dispatch does not duplicate callbacks when its wait resolves", async () => {
    const waiters: Array<(signaled: boolean) => void> = [];
    const scheduler = new VSyncFrameScheduler({
        waitForPresent: () =>
            new Promise<boolean>((resolve) => waiters.push(resolve)),
    });
    const timestamps: number[] = [];

    scheduler.request((timestamp) => timestamps.push(timestamp));
    assert.equal(scheduler.dispatchNow(12), 1);
    assert.equal(scheduler.dispatchNow(13), 0);
    assert.deepEqual(timestamps, [12]);

    waiters[0](true);
    await Promise.resolve();
    assert.deepEqual(timestamps, [12]);
});

test("Windows startup rejects a Dawn addon without modal frame support", () => {
    assert.throws(
        () => requireWindowsModalFrameSupport({}, "win32"),
        /pnpm native:build/,
    );
    assert.doesNotThrow(() =>
        requireWindowsModalFrameSupport({}, "linux"),
    );
    assert.doesNotThrow(() =>
        requireWindowsModalFrameSupport(
            { setModalFrameCallback: () => undefined },
            "win32",
        ),
    );
});
