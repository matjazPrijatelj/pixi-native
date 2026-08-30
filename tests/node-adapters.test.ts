import test from "node:test";
import assert from "node:assert/strict";
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
});
