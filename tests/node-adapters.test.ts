import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { NodeDOMAdapter } from "../src/pixi-node/NodeDOMAdapter.ts";
import { NodeGPUCanvas } from "../src/pixi-node/NodeGPUCanvas.ts";
import { NodeTextCanvas } from "../src/pixi-node/NodeTextCanvas.ts";

test("NodeGPUCanvas exposes the native WebGPU context and resizes", () => {
    const context = {} as GPUCanvasContext;
    const renderer = { resize() {}, getCurrentTexture() { return context as unknown as GPUTexture; } };
    const canvas = new NodeGPUCanvas(renderer as never, 1280, 720);
    assert.notEqual(canvas.getContext("webgpu"), null);
    assert.equal(canvas.getContext("webgpu"), canvas.getContext("webgpu"));
    assert.equal(canvas.getContext("2d"), null);
    canvas.resize(640.8, 360.2);
    assert.equal(canvas.width, 640);
    assert.equal(canvas.height, 360);
});

test("NodeTextCanvas provides a native Canvas2D context", () => {
    const canvas = new NodeTextCanvas(64, 32);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    assert.ok(context);
    assert.equal(canvas.width, 64);
    assert.equal(canvas.height, 32);
    assert.equal(typeof context.measureText, "function");
    assert.ok(context.measureText("Pixi").width > 0);
    canvas.width = 31.9;
    canvas.height = 15.9;
    assert.equal(canvas.width, 31);
    assert.equal(canvas.height, 15);
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 1, 1);
    assert.deepEqual(Array.from(context.getImageData(0, 0, 1, 1).data), [255, 0, 0, 255]);
});

test("NodeDOMAdapter loads a local image into a Canvas2D context", async () => {
    const adapter = new NodeDOMAdapter({} as never);
    const image = adapter.createImage();
    await new Promise<void>((resolve, reject) => {
        image.onload = (): void => {
            Promise.resolve().then(() => image.decode()).then(resolve, reject);
        };
        image.onerror = reject;
        image.src = fileURLToPath(new URL("../assets/test-texture.png", import.meta.url));
    });

    assert.ok(image.width > 0);
    assert.ok(image.height > 0);
    const canvas = new NodeTextCanvas(image.width, image.height);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.drawImage(image, 0, 0);
    assert.equal(context.getImageData(0, 0, 1, 1).data.length, 4);
});
