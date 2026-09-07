import test from "node:test";
import assert from "node:assert/strict";
import { manageNativeApplication } from "../src/pixi-native/ManagedNativeApplication.ts";

type Callback = () => void;
type FrameCallback = (timestamp: number) => void;

class FakeTicker {
    public readonly entries: Array<{ callback: Callback; priority: number }> =
        [];
    public started = false;

    public add(callback: Callback, _context?: unknown, priority = 0): void {
        this.entries.push({ callback, priority });
    }

    public remove(callback: Callback): void {
        const index = this.entries.findIndex(
            (entry) => entry.callback === callback,
        );
        if (index >= 0) this.entries.splice(index, 1);
    }

    public start(): void {
        this.started = true;
    }
    public stop(): void {
        this.started = false;
    }

    public update(): void {
        const entries = [...this.entries].sort(
            (a, b) => b.priority - a.priority,
        );
        for (const entry of entries) entry.callback();
    }
}

class FakeWindow {
    public readonly x = 0;
    public readonly y = 0;
    public readonly display = { frequency: 60 };
    public readonly destroyed = false;
    public pixelWidth = 800;
    public pixelHeight = 600;
    public pollEvents: () => void = () => undefined;
    public readonly listeners = new Map<
        string,
        Array<(event: unknown) => void>
    >();

    public on(type: string, listener: (event: unknown) => void): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    public emit(type: string, event: unknown = {}): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }

    public setPosition(): void {}
    public minimize(): void {}
    public maximize(): void {}
    public restore(): void {}
    public destroy(): void {}
}

function createFixture(): {
    ticker: FakeTicker;
    window: FakeWindow;
    order: string[];
    canvasEvents: Array<{ type: string; event: Event }>;
    globalEvents: Array<{ type: string; event: Event }>;
    destroy: () => Promise<void>;
    addDestroyListener: (listener: () => void | Promise<void>) => () => void;
    runFrame: (timestamp?: number) => void;
    pendingFrameCount: () => number;
    canceledFrames: number[];
} {
    const ticker = new FakeTicker();
    const window = new FakeWindow();
    const order: string[] = [];
    const canvasEvents: Array<{ type: string; event: Event }> = [];
    const globalEvents: Array<{ type: string; event: Event }> = [];
    const frameCallbacks = new Map<number, FrameCallback>();
    const canceledFrames: number[] = [];
    let nextFrameId = 1;
    const requestFrame = (callback: FrameCallback): number => {
        const requestId = nextFrameId++;
        frameCallbacks.set(requestId, callback);
        return requestId;
    };
    const cancelFrame = (requestId: number): void => {
        canceledFrames.push(requestId);
        frameCallbacks.delete(requestId);
    };
    const runFrame = (timestamp = 0): void => {
        const callbacks = [...frameCallbacks.values()];
        frameCallbacks.clear();
        for (const callback of callbacks) callback(timestamp);
    };
    ticker.add(() => order.push("render"), undefined, -25);
    const managed = manageNativeApplication({
        app: { ticker },
        native: {
            window,
            input: {
                dispatchCanvasEvent: (type, event) =>
                    canvasEvents.push({ type, event }),
                dispatchGlobalEvent: (type, event) =>
                    globalEvents.push({ type, event }),
            },
            device: null,
            swap: () => {
                order.push("swap");
            },
            destroy: () => {
                order.push("native-destroy");
            },
        },
        destroyApplication: () => {
            order.push("app-destroy");
        },
        requestFrame,
        cancelFrame,
    });
    window.pollEvents = () => order.push("poll");
    return {
        ticker,
        window,
        order,
        canvasEvents,
        globalEvents,
        runFrame,
        pendingFrameCount: () => frameCallbacks.size,
        canceledFrames,
        ...managed,
    };
}

test("managed runtime renders, presents, and polls on its own frame", async () => {
    const fixture = createFixture();
    assert.equal(fixture.ticker.started, true);
    fixture.ticker.update();
    fixture.runFrame();
    assert.deepEqual(fixture.order, ["render", "swap", "poll"]);
    assert.equal(fixture.pendingFrameCount(), 1);
    await fixture.destroy();
});

test("poll frame rearms before native polling and skips reentrant polling", async () => {
    const fixture = createFixture();
    fixture.window.pollEvents = () => {
        fixture.order.push("poll");
        assert.equal(fixture.pendingFrameCount(), 1);
        fixture.runFrame(16);
    };

    fixture.runFrame();

    assert.deepEqual(fixture.order, ["poll"]);
    assert.equal(fixture.pendingFrameCount(), 1);
    await fixture.destroy();
});

test("managed runtime forwards pointer, wheel, keyboard, and resize", async () => {
    const fixture = createFixture();
    fixture.window.emit("mouseButtonDown", { x: 12, y: 34, button: 1 });
    fixture.window.emit("mouseMove", { x: 20, y: 40 });
    fixture.window.emit("mouseWheel", { x: 20, y: 40, dx: 2, dy: -3 });
    fixture.window.emit("mouseButtonUp", { x: 20, y: 40, button: 1 });
    fixture.window.emit("keyDown", { key: "a", scancode: 4, ctrl: true });
    fixture.window.emit("keyUp", { key: "a", scancode: 4, ctrl: true });
    fixture.window.pixelWidth = 1280;
    fixture.window.pixelHeight = 720;
    fixture.window.emit("resize");

    assert.deepEqual(
        fixture.canvasEvents.map(({ type }) => type),
        ["mousedown", "wheel"],
    );
    assert.deepEqual(
        fixture.globalEvents.map(({ type }) => type),
        ["mousemove", "mouseup", "keydown", "keyup", "resize"],
    );
    assert.equal(
        (fixture.canvasEvents[0].event as unknown as { buttons: number })
            .buttons,
        1,
    );
    assert.equal(
        (fixture.canvasEvents[1].event as unknown as { deltaY: number }).deltaY,
        -3,
    );
    assert.equal(
        (fixture.globalEvents[1].event as unknown as { buttons: number })
            .buttons,
        0,
    );
    assert.equal(
        (fixture.globalEvents[2].event as unknown as { ctrlKey: boolean })
            .ctrlKey,
        true,
    );
    assert.equal(globalThis.innerWidth, 1280);
    assert.equal(globalThis.innerHeight, 720);
    await fixture.destroy();
});

test("managed destroy is idempotent and runs all cleanup in order", async () => {
    const fixture = createFixture();
    fixture.addDestroyListener(() => {
        fixture.order.push("resource-1");
    });
    fixture.addDestroyListener(async () => {
        fixture.order.push("resource-2");
    });
    const first = fixture.destroy();
    const second = fixture.destroy();
    assert.strictEqual(first, second);
    await first;
    assert.deepEqual(fixture.order, [
        "resource-1",
        "resource-2",
        "app-destroy",
        "native-destroy",
    ]);
    assert.equal(fixture.ticker.started, false);
    assert.equal(fixture.ticker.entries.length, 1);
    assert.equal(fixture.pendingFrameCount(), 0);
    assert.equal(fixture.canceledFrames.length, 1);
});

test("native close uses the same teardown path", async () => {
    const fixture = createFixture();
    fixture.window.emit("close");
    await fixture.destroy();
    assert.deepEqual(fixture.order, ["app-destroy", "native-destroy"]);
});
