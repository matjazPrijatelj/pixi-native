import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as canvas from "../src/pixi-native/canvas.ts";
import * as runtime from "../src/pixi-native/runtime.ts";
import * as v7 from "../src/pixi-native/v7.ts";
import * as v8 from "../src/pixi-native/v8.ts";

test("versioned facades expose compact APIs for the matching Pixi major", () => {
  assert.match(v7.VERSION, /^7\./);
  assert.match(v8.VERSION, /^8\./);

  for (const facade of [v7, v8]) {
    assert.equal(typeof facade.createApp, "function");
    assert.equal(typeof facade.createRenderer, "function");
    assert.equal(typeof facade.VideoSprite, "function");
    assert.equal("createNativePixiApplication" in facade, false);
    assert.equal("createPixiRenderer" in facade, false);
  }
});

test("runtime and canvas expose their public compatibility adapters", () => {
  assert.equal(typeof runtime.FrameScheduler, "function");
  assert.equal(typeof runtime.NodeDOMAdapter, "function");
  assert.equal(typeof runtime.resolveGpuBackend, "function");
  assert.equal(typeof canvas.NodeCanvas, "function");
  assert.equal(typeof canvas.NodeGPUCanvas, "function");
  assert.equal(typeof canvas.prepareRgbaPixelsForUpload, "function");
});

test("package exports only supported public entrypoints", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { exports: Record<string, unknown> };

  assert.deepEqual(Object.keys(packageJson.exports), [
    "./v7",
    "./v8",
    "./audio",
    "./video",
    "./files",
    "./runtime",
    "./canvas",
  ]);
});
