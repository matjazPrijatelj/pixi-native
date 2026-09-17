import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
    analyzeRows,
    analyzeRssTrend,
    createHtmlReport,
    resolveMemoryInfoInput,
} from "../scripts/analyze-memory-info.mjs";

const MIB = 1024 * 1024;

function createTrendRows(
  rssAtMinute: (minute: number) => number,
  durationMinutes = 240,
) {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: durationMinutes + 1 }, (_, minute) => ({
    timestamp: new Date(start + minute * 60_000).toISOString(),
    timestampMs: start + minute * 60_000,
    sequence: minute + 1,
    reason: "scene-exit:after",
    memory: {
      rss: rssAtMinute(minute) * MIB,
      heapUsed: 40 * MIB,
      external: 10 * MIB,
      arrayBuffers: 2 * MIB,
    },
    scene: { index: minute % 3, name: `scene-${minute % 3}` },
    runtime: { backend: "webgl", target: "win32-x64" },
    extra: {
      webglBuffersCreated: 4 + minute,
      webglBuffersDeleted: minute,
      webglBuffersLive: 4,
      webglBuffersPeak: 5,
      webglBufferBytesLive: (8 + minute / 60) * MIB,
      webglBufferBytesPeak: 12 * MIB,
    },
  }));
}

test("memory analyzer reports trends and sequence gaps", () => {
  const fixture = resolve(".tmp-memory-info-fixture.log");
  writeFileSync(fixture, [
    JSON.stringify({ timestamp: "2026-01-01T00:00:00.000Z", timestampMs: 0, sequence: 1, reason: "scene-entry:rendered", memory: { rss: 100, heapUsed: 40, external: 10, arrayBuffers: 2 }, extra: { gpuBindGroups: 2, gpuBindGroupCacheResets: 0, webglBuffersCreated: 2, webglBuffersDeleted: 0, webglBuffersLive: 2, webglBuffersPeak: 2, webglBufferBytesLive: MIB, webglBufferBytesPeak: MIB, activeNativeVideos: 1, nativeVideoFrameBufferAllocations: 5, nativeVideoFrameBufferReuses: 10, nativeVideoRecycledFrameBuffers: 1 }, scene: { index: 1, name: "sprite-gsap" }, runtime: { backend: "webgl", target: "win32-x64" } }),
    JSON.stringify({ timestamp: "2026-01-01T00:05:00.000Z", timestampMs: 300_000, sequence: 3, reason: "scene-entry:rendered", memory: { rss: 130, heapUsed: 41, external: 20, arrayBuffers: 4 }, extra: { gpuBindGroups: 5, gpuBindGroupCacheResets: 1, webglBuffersCreated: 4, webglBuffersDeleted: 1, webglBuffersLive: 3, webglBuffersPeak: 3, webglBufferBytesLive: 2 * MIB, webglBufferBytesPeak: 2 * MIB, activeNativeVideos: 0, nativeVideoFrameBufferAllocations: 0, nativeVideoFrameBufferReuses: 0, nativeVideoRecycledFrameBuffers: 0 }, scene: { index: 1, name: "sprite-gsap" }, runtime: { backend: "webgl", target: "win32-x64" } }),
  ].join("\n"));
  try {
    const output = execFileSync(process.execPath, ["scripts/analyze-memory-info.mjs", fixture], { encoding: "utf8" });
    assert.match(output, /│ RSS\s+│ 0\.0 MiB/u);
    assert.match(output, /Time gaps/u);
    assert.match(output, /Sequence gaps: 1->3/u);
    assert.match(output, /webgl\/win32-x64=2/u);
    assert.match(output, /gpuBindGroups/u);
    assert.match(output, /webglBuffersLive/u);
    assert.match(output, /webglBufferBytesLive\s+│ 1\.0 MiB\s+│ 2\.0 MiB/u);
    assert.match(output, /nativeVideoFrameBufferAllocations/u);
    assert.match(output, /Native and GPU resources/u);
  } finally {
    unlinkSync(fixture);
  }
});

test("memory analyzer accepts an explicit log path option", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "pixi-external-memory-log-"));
  const fixture = resolve(directory, "memoryInfo-webgl-external.log");
  try {
    await writeFile(fixture, `${JSON.stringify({
      timestamp: "2026-01-01T00:00:00.000Z",
      sequence: 1,
      reason: "startup",
      memory: { rss: 100, heapUsed: 40, external: 10, arrayBuffers: 2 },
    })}\n`);
    const output = execFileSync(
      process.execPath,
      ["scripts/analyze-memory-info.mjs", "--path", fixture],
      { encoding: "utf8" },
    );
    assert.match(output, /│ Entries\s+│ 1/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory analyzer classifies plateau, growth, decline, and instability", () => {
  const plateau = analyzeRssTrend(createTrendRows((minute) =>
    minute < 30 ? 200 + minute : 230 + (Math.floor(minute / 5) % 2 ? 1 : -1),
  ));
  assert.equal(plateau.status, "PLATEAU");
  assert.ok(plateau.settledAtMs);

  assert.equal(
    analyzeRssTrend(createTrendRows((minute) => 200 + minute / 60)).status,
    "SLOW GROWTH",
  );
  assert.equal(
    analyzeRssTrend(createTrendRows((minute) => 200 + minute / 6)).status,
    "GROWING",
  );
  assert.equal(
    analyzeRssTrend(createTrendRows((minute) => 300 - minute / 30)).status,
    "DECLINING",
  );
  assert.equal(
    analyzeRssTrend(createTrendRows((minute) =>
      Math.floor(minute / 5) % 2 ? 220 : 190,
    )).status,
    "UNSTABLE",
  );
  assert.equal(analyzeRssTrend(createTrendRows(() => 200, 10)).status, "INSUFFICIENT DATA");
});

test("memory analyzer can color tables without changing plain output", () => {
  const rows = createTrendRows(() => 200);
  const plain = analyzeRows(rows).lines.join("\n");
  const colored = analyzeRows(rows, { color: true }).lines.join("\n");
  assert.doesNotMatch(plain, /\u001B\[/u);
  assert.match(colored, /\u001B\[32m/u);
});

test("memory analyzer writes a detailed HTML report beside an external log", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "pixi-memory-html-"));
  const fixture = resolve(directory, "memoryInfo-webgl-external.log");
  const reportPath = resolve(directory, "memoryInfo-webgl-external.report.html");
  const rows = createTrendRows(() => 200);
  rows[0].scene.name = "</script><script>alert(1)</script>";
  try {
    await writeFile(fixture, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    await writeFile(reportPath, "stale report", "utf8");
    const output = execFileSync(
      process.execPath,
      ["scripts/analyze-memory-info.mjs", "--path", fixture, "--html"],
      { encoding: "utf8" },
    );
    const html = await readFile(reportPath, "utf8");
    assert.match(output, /HTML report:/u);
    assert.match(html, /chart\.js@4\.5\.1\/dist\/chart\.umd\.min\.js/u);
    assert.match(html, /RSS plateau analysis/u);
    assert.match(html, /rss-chart/u);
    assert.match(html, /webgl-buffer-chart/u);
    assert.match(html, /webglBufferBytesLive/u);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
    assert.match(html, /\\u003c\/script\\u003e/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("HTML report keeps its textual analysis when charts cannot load", () => {
  const html = createHtmlReport(createTrendRows(() => 200), "memoryInfo.log");
  assert.match(html, /Charts require an internet connection/u);
  assert.match(html, /Scene baselines/u);
  assert.match(html, /Live WebGL buffer storage/u);
  assert.match(html, /PLATEAU/u);
});

test("HTML report initializes each available chart with independent options", () => {
  const html = createHtmlReport(createTrendRows(() => 200), "memoryInfo.log");
  const script = html.match(/<script>\s*(const report = .*?)\s*<\/script>/su)?.[1];
  assert.ok(script);

  const chartIds: string[] = [];
  class ChartMock {
    public constructor(
      element: { id: string },
      configuration: { options: Record<string, unknown> },
    ) {
      chartIds.push(element.id);
      configuration.options.nonCloneable = (): void => undefined;
    }
  }
  const elements = new Set([
    "rss-chart",
    "js-chart",
    "scene-chart",
    "resource-chart",
    "webgl-buffer-chart",
  ]);
  runInNewContext(script, {
    Chart: ChartMock,
    window: { Chart: ChartMock },
    document: {
      documentElement: { dataset: {} },
      getElementById: (id: string): { id: string } | null =>
        elements.has(id) ? { id } : null,
    },
  });

  assert.deepEqual(chartIds, [...elements]);
  assert.doesNotMatch(html, /structuredClone/u);
});

test("HTML report replaces backend-specific empty charts with explanations", () => {
  const webGpuRows = createTrendRows(() => 200).map((row, index) => ({
    ...row,
    runtime: { backend: "webgpu", target: "win32-x64" },
    extra: {
      gpuBindGroups: 2 + index,
      gpuTextureBindGroups: 1,
      gpuManagedTextures: 9,
      gpuManagedBuffers: 4,
      gpuBindGroupCacheResets: 0,
    },
  }));
  const webGpuHtml = createHtmlReport(webGpuRows, "memoryInfo-webgpu.log");
  assert.match(webGpuHtml, /<canvas id="resource-chart"><\/canvas>/u);
  assert.doesNotMatch(webGpuHtml, /<canvas id="webgl-buffer-chart"><\/canvas>/u);
  assert.match(webGpuHtml, /Not applicable for WebGPU/u);

  const webGlHtml = createHtmlReport(
    createTrendRows(() => 200),
    "memoryInfo-webgl.log",
  );
  assert.match(webGlHtml, /<canvas id="webgl-buffer-chart"><\/canvas>/u);
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

  assert.match(result.lines.join("\n"), /Incomplete scene exits: 4:video/u);
  assert.match(result.lines.join("\n"), /Pending native video shutdowns/u);
});
