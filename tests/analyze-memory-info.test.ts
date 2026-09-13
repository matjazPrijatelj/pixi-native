import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

test("memory analyzer reports trends and sequence gaps", () => {
  const fixture = resolve(".tmp-memory-info-fixture.log");
  writeFileSync(fixture, [
    JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", timestampMs: 0, sequence: 1, reason: "scene-entry:rendered", memory: { rss: 100, heapUsed: 40, external: 10, arrayBuffers: 2 }, extra: { gpuBindGroups: 2, gpuBindGroupCacheResets: 0, activeNativeVideos: 1, nativeVideoFrameBufferAllocations: 5, nativeVideoFrameBufferReuses: 10, nativeVideoRecycledFrameBuffers: 1 }, scene: { index: 1, name: "sprite-gsap" }, runtime: { backend: "webgl", target: "win32-x64" } }),
    JSON.stringify({ timestamp: "2026-01-01T00:05:00.000Z", timestampMs: 300_000, sequence: 3, reason: "scene-entry:rendered", memory: { rss: 130, heapUsed: 41, external: 20, arrayBuffers: 4 }, extra: { gpuBindGroups: 5, gpuBindGroupCacheResets: 1, activeNativeVideos: 0, nativeVideoFrameBufferAllocations: 0, nativeVideoFrameBufferReuses: 0, nativeVideoRecycledFrameBuffers: 0 }, scene: { index: 1, name: "sprite-gsap" }, runtime: { backend: "webgl", target: "win32-x64" } }),
  ].join("\n"));
  try {
    const output = execFileSync(process.execPath, ["scripts/analyze-memory-info.mjs", fixture], { encoding: "utf8" });
    assert.match(output, /RSS: 0\.0 MiB -> 0\.0 MiB/);
    assert.match(output, /WARNING time gaps/);
    assert.match(output, /WARNING sequence gaps: 1->3/);
    assert.match(output, /Runtimes: webgl\/win32-x64=2/);
    assert.match(output, /gpuBindGroups=2->5 \(max 5\)/);
    assert.match(output, /nativeVideoFrameBufferAllocations max=5/);
    assert.match(output, /Rendered-scene RSS: 1:sprite-gsap=/);
  } finally {
    unlinkSync(fixture);
  }
});
