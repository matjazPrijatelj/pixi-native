import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeGpuSource = readFileSync(
  new URL("../native/gpu/addon/Module.cpp", import.meta.url),
  "utf8",
);
const videoSpriteSource = readFileSync(
  new URL("../packages/pixi8/src/VideoSprite.ts", import.meta.url),
  "utf8",
);
const nativeVideoSource = readFileSync(
  new URL("../packages/core/src/video/NativeVideo.ts", import.meta.url),
  "utf8",
);
const pixi8RendererSource = readFileSync(
  new URL("../packages/pixi8/src/createPixiRenderer.ts", import.meta.url),
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

test("shared NV12 surfaces end access only after submitted work completes", () => {
  const swapBody = nativeGpuSource.match(
    /Napi::Value Swap\([\s\S]*?\n    \}\n\n    Napi::Value Resize/u,
  )?.[0];
  assert.ok(swapBody, "Renderer::Swap body was not found");
  assert.doesNotMatch(swapBody, /EndAccess\(/u);
  assert.match(swapBody, /entry\.releaseQueued = true/u);
  assert.match(nativeGpuSource, /Napi::Value CompleteVideoFrameReleases/u);
  assert.match(nativeGpuSource, /entry\.memory\.EndAccess\(entry\.texture/u);
  assert.match(pixi8RendererSource, /queue\s*\.\s*onSubmittedWorkDone\(\)/u);
  assert.match(
    pixi8RendererSource,
    /completeVideoFrameReleases\?\.\(\s*pendingSurfaces/u,
  );
});

test("VideoSprite defers renderer-owned surfaces before CPU fallback", () => {
  assert.doesNotMatch(
    videoSpriteSource,
    /if \(previousGpuFrame && this\.gpuFrameAwaitingRelease !== frame\) \{\s*this\.video\.releaseFrame\(previousGpuFrame\);\s*\}/u,
  );
  assert.match(videoSpriteSource, /retireNativeVideoGpuTexture/u);
  assert.match(
    videoSpriteSource,
    /this\.video\.fallbackFromGpuFrame\(frame, error, rendererOwnedFrames\)/u,
  );
  assert.match(
    videoSpriteSource,
    /setPresentationSuspended\(suspended: boolean\)/u,
  );
  assert.match(nativeVideoSource, /private pendingGpuFallback/u);
  assert.match(nativeVideoSource, /completeGpuFallbackSurface/u);
  assert.match(
    nativeVideoSource,
    /if \(surfaceKeys\.size > 0\) \{[\s\S]*?this\.pendingGpuFallback/u,
  );
});
