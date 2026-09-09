import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nativeAudioEngine } from "@pixi-native/pixi8/audio";
import * as canvas from "@pixi-native/pixi8/canvas";
import * as runtime from "@pixi-native/pixi8/runtime";
import * as v7 from "@pixi-native/pixi7";
import * as v8 from "@pixi-native/pixi8";

test("version packages expose compact APIs for their matching Pixi major", () => {
  assert.match(v7.VERSION, /^7\./);
  assert.match(v8.VERSION, /^8\./);
  for (const facade of [v7, v8]) {
    assert.equal(typeof facade.createApp, "function");
    assert.equal(typeof facade.createRenderer, "function");
    assert.equal(typeof facade.VideoSprite, "function");
    assert.equal(typeof facade.NativeVideo, "function");
    assert.equal(typeof facade.VideoFpsMeter, "function");
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

test("public audio engine access is limited to diagnostics", () => {
  assert.equal(typeof nativeAudioEngine.diagnostics.activeVoices, "number");
  if (false) {
    // @ts-expect-error Playback ownership belongs to Howl and Howler.
    nativeAudioEngine.stopAll();
  }
});

test("version packages expose the same supported public entrypoints", async () => {
  for (const packageName of ["pixi7", "pixi8"]) {
    const packageJson = JSON.parse(
      await readFile(
        new URL(`../packages/${packageName}/package.json`, import.meta.url),
        "utf8",
      ),
    ) as { exports: Record<string, unknown> };
    assert.deepEqual(Object.keys(packageJson.exports), [
      ".",
      "./audio",
      "./files",
      "./runtime",
      "./canvas",
    ]);
  }
});
