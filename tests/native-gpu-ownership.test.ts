import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeGpuSource = readFileSync(
  new URL("../native/gpu/addon/Module.cpp", import.meta.url),
  "utf8",
);

test("native WebGPU surface textures transfer into RAII ownership", () => {
  assert.doesNotMatch(
    nativeGpuSource,
    /textureAddRef\(surfaceTexture\.texture\)/u,
  );
  assert.match(
    nativeGpuSource,
    /wgpu::Texture::Acquire\(surfaceTexture\.texture\)/u,
  );
  assert.match(nativeGpuSource, /texture\.CreateView\(&descriptor\)/u);
});

test("native WebGPU surfaces use explicit GLFW platform handles", () => {
  assert.doesNotMatch(nativeGpuSource, /Get\("_native"\)/u);
  assert.doesNotMatch(nativeGpuSource, /native SDL window object/u);
  assert.match(nativeGpuSource, /surface\.window/u);
  assert.match(nativeGpuSource, /WGPUSurfaceSourceWindowsHWND/u);
  assert.match(nativeGpuSource, /WGPUSurfaceSourceXlibWindow/u);
  assert.match(nativeGpuSource, /WGPUSurfaceSourceWaylandSurface/u);
});
