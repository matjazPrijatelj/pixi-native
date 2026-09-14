import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  analyzeRows,
  resolveMemoryInfoInput,
} from "../scripts/analyze-memory-info.mjs";

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

test("memory analyzer selects the newest unique instance log", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "pixi-memory-logs-"));
  const fixed = resolve(directory, "memoryInfo.log");
  const older = resolve(directory, "memoryInfo-webgl-old-p1-r0.log");
  const newer = resolve(directory, "memoryInfo-webgpu-new-p2-r0.log");
  try {
    await writeFile(fixed, "{}\n");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    await writeFile(older, "{}\n");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    await writeFile(newer, "{}\n");
    assert.equal(await resolveMemoryInfoInput(undefined, directory), newer);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory analyzer reports an incomplete video exit and pending cleanup", () => {
  const result = analyzeRows([
    {
      timestamp: "2026-01-01T00:00:00.000Z",
      timestampMs: 0,
      sequence: 1,
      reason: "scene-entry:rendered",
      memory: {},
      extra: { nativeVideoPendingDecoderShutdowns: 0 },
      scene: { index: 4, name: "video" },
    },
    {
      timestamp: "2026-01-01T00:00:15.000Z",
      timestampMs: 15_000,
      sequence: 2,
      reason: "scene-exit:before",
      memory: {},
      extra: { nativeVideoPendingDecoderShutdowns: 1 },
      scene: { index: 4, name: "video" },
    },
  ]);

  assert.match(result.lines.join("\n"), /WARNING incomplete scene exits: 4:video/u);
  assert.match(result.lines.join("\n"), /WARNING pending native video shutdowns/u);
});
