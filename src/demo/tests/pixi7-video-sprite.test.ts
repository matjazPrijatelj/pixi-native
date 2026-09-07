import test from "node:test";
import assert from "node:assert/strict";
import { settings } from "pixi.js-v7";
import { NodeDOMAdapter } from "../../pixi-native/NodeDOMAdapter.ts";
import { NativeVideoSprite7 } from "../../pixi-native/video/NativeVideoSprite7.ts";

test("NativeVideoSprite7 uploads an NV12 frame through a Pixi 7 canvas resource", () => {
    new NodeDOMAdapter({} as never).installPixi7(settings);

    const frame = {
        width: 2,
        height: 2,
        timestampUs: 0,
        y: new Uint8Array([128, 128, 128, 128]),
        uv: new Uint8Array([128, 128]),
        yStride: 2,
        uvStride: 2,
        pixelFormat: "nv12" as const,
    };
    let presented = 0;
    let destroyed = 0;
    const events = new EventTarget();
    const video = {
        width: 2,
        height: 2,
        takeLatestFrame: () => frame,
        markFramePresented: () => presented++,
        destroy: () => destroyed++,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    } as never;

    const sprite = new NativeVideoSprite7(video);
    assert.doesNotThrow(() => sprite.updateFrame());
    assert.equal(presented, 1);
    const planes = sprite as unknown as {
        yPlane: { data: Uint8Array };
        uvPlane: { data: Uint8Array };
    };
    assert.deepEqual(Array.from(planes.yPlane.data), [128, 128, 128, 128]);
    assert.deepEqual(Array.from(planes.uvPlane.data), [128, 128]);
    assert.doesNotThrow(() => sprite.updateFrame());
    assert.equal(presented, 2);

    events.dispatchEvent(new Event("emptied"));
    assert.equal(sprite.updateFrame(), true);
    assert.equal(presented, 2);
    assert.deepEqual(Array.from(planes.yPlane.data), [16, 16, 16, 16]);
    assert.deepEqual(Array.from(planes.uvPlane.data), [128, 128]);

    assert.equal(sprite.updateFrame(), true);
    assert.equal(presented, 3);
    assert.deepEqual(Array.from(planes.yPlane.data), [128, 128, 128, 128]);
    sprite.destroy();
    assert.equal(destroyed, 1);
});

test("NativeVideoSprite7 renders packed alpha at the color-region width", () => {
    new NodeDOMAdapter({} as never).installPixi7(settings);
    let destroyed = 0;
    const events = new EventTarget();
    const video = {
        width: 1920,
        height: 768,
        takeLatestFrame: () => null,
        markFramePresented: () => undefined,
        destroy: () => destroyed++,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    } as never;

    const sprite = new NativeVideoSprite7(video, { alphaMaskScale: 0.5 });
    const positions = sprite.geometry.getBuffer("aVertexPosition").data;

    assert.equal(sprite.width, 1280);
    assert.deepEqual(Array.from(positions), [0, 0, 1280, 0, 1280, 768, 0, 768]);

    sprite.destroy();
    assert.equal(destroyed, 1);
});
