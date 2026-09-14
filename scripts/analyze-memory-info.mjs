import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function resolveMemoryInfoInput(
  requestedPath,
  logsDirectory = resolve("logs"),
) {
  if (requestedPath) return resolve(requestedPath);

  const defaultPath = resolve(logsDirectory, "memoryInfo.log");
  const entries = await readdir(logsDirectory, { withFileTypes: true }).catch(
    () => [],
  );
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (entry.name === "memoryInfo.log" ||
            /^memoryInfo-.+\.log$/iu.test(entry.name)),
      )
      .map(async (entry) => {
        const path = resolve(logsDirectory, entry.name);
        return { path, modified: (await stat(path)).mtimeMs };
      }),
  );
  candidates.sort((left, right) => right.modified - left.modified);
  return candidates[0]?.path ?? defaultPath;
}

export function analyzeRows(rows) {
  if (rows.length === 0) return { count: 0, lines: ["No valid memoryinfo entries."] };
  const first = rows[0];
  const last = rows.at(-1);
  const rss = rows.map((row) => row.memory?.rss ?? 0);
  const heap = rows.map((row) => row.memory?.heapUsed ?? 0);
  const external = rows.map((row) => row.memory?.external ?? 0);
  const gaps = [];
  const sequenceGaps = [];
  let pendingSceneExit;
  const interruptedSceneExits = [];
  for (const row of rows) {
    if (row.reason === "scene-exit:before") {
      if (pendingSceneExit) interruptedSceneExits.push(pendingSceneExit);
      pendingSceneExit = `${row.scene?.index ?? "?"}:${row.scene?.name ?? "unknown"} at sequence ${row.sequence ?? "?"}`;
    } else if (row.reason === "scene-exit:after") {
      pendingSceneExit = undefined;
    }
  }
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    const deltaMs = (current.timestampMs ?? Date.parse(current.timestamp)) -
      (previous.timestampMs ?? Date.parse(previous.timestamp));
    if (deltaMs > 180_000) gaps.push(`${Math.round(deltaMs / 1000)}s before ${current.reason}`);
    if (Number.isFinite(previous.sequence) && Number.isFinite(current.sequence) && current.sequence !== previous.sequence + 1) {
      sequenceGaps.push(`${previous.sequence}->${current.sequence}`);
    }
  }
  const scenes = new Map();
  const runtimes = new Map();
  const renderedSceneRss = new Map();
  for (const row of rows) {
    const name = row.scene ? `${row.scene.index}:${row.scene.name}` : "unknown";
    scenes.set(name, (scenes.get(name) ?? 0) + 1);
    if (row.reason === "scene-entry:rendered") {
      const values = renderedSceneRss.get(name) ?? [];
      values.push(row.memory?.rss ?? 0);
      renderedSceneRss.set(name, values);
    }
    if (row.runtime) {
      const runtime = `${row.runtime.backend ?? "unknown"}/${row.runtime.target ?? "unknown"}`;
      runtimes.set(runtime, (runtimes.get(runtime) ?? 0) + 1);
    }
  }
  const lines = [
    `Entries: ${rows.length}`,
    `Range: ${first.timestamp} -> ${last.timestamp}`,
    `RSS: ${formatBytes(first.memory?.rss)} -> ${formatBytes(last.memory?.rss)} (min ${formatBytes(Math.min(...rss))}, max ${formatBytes(Math.max(...rss))})`,
    `Heap used: ${formatBytes(first.memory?.heapUsed)} -> ${formatBytes(last.memory?.heapUsed)} (delta ${formatSigned(last.memory?.heapUsed - first.memory?.heapUsed)})`,
    `External: ${formatBytes(first.memory?.external)} -> ${formatBytes(last.memory?.external)} (delta ${formatSigned(last.memory?.external - first.memory?.external)})`,
    `ArrayBuffers: ${formatBytes(first.memory?.arrayBuffers)} -> ${formatBytes(last.memory?.arrayBuffers)} (delta ${formatSigned(last.memory?.arrayBuffers - first.memory?.arrayBuffers)})`,
    `Scenes: ${[...scenes.entries()].map(([name, count]) => `${name}=${count}`).join(", ")}`,
  ];
  if (runtimes.size) lines.push(`Runtimes: ${[...runtimes.entries()].map(([name, count]) => `${name}=${count}`).join(", ")}`);
  const gpuMetrics = [
    "gpuBindGroups",
    "gpuTextureBindGroups",
    "gpuManagedTextures",
    "gpuManagedBuffers",
    "gpuBindGroupCacheResets",
  ];
  const gpuTrends = gpuMetrics.flatMap((name) => {
    const values = rows.map((row) => row.extra?.[name]).filter(Number.isFinite);
    return values.length
      ? [`${name}=${values[0]}->${values.at(-1)} (max ${Math.max(...values)})`]
      : [];
  });
  if (gpuTrends.length) lines.push(`GPU resources: ${gpuTrends.join(", ")}`);
  const videoMetrics = [
    "activeNativeVideos",
    "nativeVideoFrameBufferAllocations",
    "nativeVideoFrameBufferReuses",
    "nativeVideoRecycledFrameBuffers",
  ];
  const videoPeaks = videoMetrics.flatMap((name) => {
    const values = rows.map((row) => row.extra?.[name]).filter(Number.isFinite);
    return values.length ? [`${name} max=${Math.max(...values)}`] : [];
  });
  if (videoPeaks.length) lines.push(`Native video buffers: ${videoPeaks.join(", ")}`);
  const shutdownMetrics = [
    "nativeVideoActiveDecoderWorkers",
    "nativeVideoPendingDecoderShutdowns",
    "nativeVideoCompletedDecoderShutdowns",
    "nativeVideoMaxDecoderShutdownMs",
  ];
  const shutdownTrends = shutdownMetrics.flatMap((name) => {
    const values = rows.map((row) => row.extra?.[name]).filter(Number.isFinite);
    return values.length
      ? [`${name}=${values[0]}->${values.at(-1)} (max ${Math.max(...values)})`]
      : [];
  });
  if (shutdownTrends.length) lines.push(`Native video shutdowns: ${shutdownTrends.join(", ")}`);
  if (renderedSceneRss.size) {
    lines.push(`Rendered-scene RSS: ${[...renderedSceneRss.entries()].map(([name, values]) =>
      `${name}=${formatBytes(values[0])}->${formatBytes(values.at(-1))}`,
    ).join(", ")}`);
  }
  if (gaps.length) lines.push(`WARNING time gaps: ${gaps.join(", ")}`);
  if (sequenceGaps.length) lines.push(`WARNING sequence gaps: ${sequenceGaps.join(", ")}`);
  if (pendingSceneExit) interruptedSceneExits.push(pendingSceneExit);
  if (interruptedSceneExits.length) {
    lines.push(`WARNING incomplete scene exits: ${interruptedSceneExits.join(", ")}`);
  }
  const finalPendingShutdowns = last.extra?.nativeVideoPendingDecoderShutdowns;
  if (Number.isFinite(finalPendingShutdowns) && finalPendingShutdowns > 0) {
    lines.push(`WARNING pending native video shutdowns at final entry: ${finalPendingShutdowns}`);
  }
  if (!gaps.length && !sequenceGaps.length && !interruptedSceneExits.length) {
    lines.push("Ordering: continuous timestamps, sequence, and scene exits.");
  }
  return { count: rows.length, lines };
}

function formatBytes(value = 0) {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatSigned(value = 0) {
  return `${value >= 0 ? "+" : ""}${formatBytes(value)}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputPath = await resolveMemoryInfoInput(process.argv[2]);
  try {
    const content = await readFile(inputPath, "utf8");
    const rows = content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    for (const line of analyzeRows(rows).lines) console.log(line);
  } catch (error) {
    console.error(`Cannot read ${inputPath}:`, error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
