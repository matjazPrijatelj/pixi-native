import assert from "node:assert/strict";
import test from "node:test";

import {
    attachWebGlResourceStats,
    installWebGlResourceTracker,
    type PixiNativeResourceStatsTarget,
} from "@pixi-native/core/renderers/webgl/webGlResourceTracker.js";

function createFakeWebGlContext(): Record<string, (...args: unknown[]) => unknown> {
    const context: Record<string, (...args: unknown[]) => unknown> = {
        bindBuffer: () => undefined,
        bufferData: () => undefined,
    };
    for (const type of [
        "Buffer",
        "Texture",
        "Framebuffer",
        "Renderbuffer",
        "Program",
        "Shader",
        "VertexArray",
    ]) {
        context[`create${type}`] = () => ({ type });
        context[`delete${type}`] = () => undefined;
    }
    return context;
}

test("WebGL resource tracker counts lifetimes and buffer storage", () => {
    const context = createFakeWebGlContext();
    const tracker = installWebGlResourceTracker(
        context as unknown as WebGL2RenderingContext,
    );
    const buffer = context.createBuffer() as object;
    context.bindBuffer(0x8892, buffer);
    context.bufferData(0x8892, 1024, 0x88e4);

    let stats = tracker.getStats();
    assert.equal(stats.webglBuffersCreated, 1);
    assert.equal(stats.webglBuffersLive, 1);
    assert.equal(stats.webglBuffersPeak, 1);
    assert.equal(stats.webglBufferBytesLive, 1024);
    assert.equal(stats.webglBufferBytesPeak, 1024);

    context.bufferData(0x8892, new Uint16Array(10), 0x88e4, 2, 4);
    stats = tracker.getStats();
    assert.equal(stats.webglBufferBytesLive, 8);
    assert.equal(stats.webglBufferBytesPeak, 1024);

    context.deleteBuffer(buffer);
    context.deleteBuffer(buffer);
    stats = tracker.getStats();
    assert.equal(stats.webglBuffersDeleted, 1);
    assert.equal(stats.webglBuffersLive, 0);
    assert.equal(stats.webglBufferBytesLive, 0);
});

test("WebGL resource tracker covers every requested object type", () => {
    const context = createFakeWebGlContext();
    const tracker = installWebGlResourceTracker(
        context as unknown as WebGL2RenderingContext,
    );
    for (const type of [
        "Texture",
        "Framebuffer",
        "Renderbuffer",
        "Program",
        "Shader",
        "VertexArray",
    ]) {
        const resource = context[`create${type}`]() as object;
        assert.equal(tracker.getStats()[`webgl${type}sLive`], 1);
        context[`delete${type}`](resource);
        assert.equal(tracker.getStats()[`webgl${type}sLive`], 0);
    }
});

test("Pixi 7 and Pixi 8 renderers can expose the shared diagnostics hook", () => {
    const renderer = {} as PixiNativeResourceStatsTarget;
    attachWebGlResourceStats(renderer, () => ({ webglBuffersLive: 3 }));
    assert.deepEqual(renderer.__pixiNativeResourceStats?.(), {
        webglBuffersLive: 3,
    });
});
