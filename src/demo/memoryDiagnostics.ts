import { appendFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getHeapStatistics } from "node:v8";
import { nativeAudioEngine } from "@pixi-native/core/audio";
import { resolveMemoryLogPath } from "./memoryLogPaths.ts";

const SAMPLE_INTERVAL_MS = 150_000;
const DEFAULT_LOG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../logs/memoryInfo.log",
);
const diagnosticsStartedAt = performance.now();
let sequence = 0;
let writeQueue = Promise.resolve();

type DiagnosticRoot = unknown;
type GcFunction = (() => void) | undefined;

export interface MemoryDiagnostics {
  sample(reason?: string): Promise<void>;
  sceneEntry(reason?: string): Promise<void>;
  collect(reason?: string): Promise<void>;
  stop(): void;
}

export interface MemoryDiagnosticsOptions {
  readonly extra?: () => Record<string, number>;
  readonly scene?: () => { index: number; name: string };
  readonly runtime?: () => Record<string, string | number | boolean>;
}

interface MemorySnapshot {
  readonly timestamp: string;
  readonly timestampMs: number;
  readonly elapsedMs: number;
  readonly sequence: number;
  readonly processId: number;
  readonly reason: string;
  readonly gcAvailable: boolean;
  readonly gcExecuted: boolean;
  readonly memory: NodeJS.MemoryUsage;
  readonly heap: ReturnType<typeof getHeapStatistics>;
  readonly audio: {
    readonly activeVoices: number;
    readonly queuedMs: number;
    readonly underruns: number;
  };
  readonly objects: Record<string, number>;
  readonly extra: Record<string, number>;
  readonly runtime: Record<string, string | number | boolean>;
  readonly scene?: { index: number; name: string };
}

export function startMemoryDiagnostics(
  roots: () => readonly DiagnosticRoot[],
  options: MemoryDiagnosticsOptions = {},
): MemoryDiagnostics {
  const uniqueLog = process.env.PIXI_NATIVE_UNIQUE_MEMORY_LOG === "1";
  const logPath = resolveMemoryLogPath({
    backend: process.env.PIXI_NATIVE_MEMORY_LOG_BACKEND ?? "unknown",
    configuredPath: process.env.MEMORYINFO_LOG_PATH,
    defaultPath: DEFAULT_LOG_PATH,
    pid: process.pid,
    restart: Number(process.env.PIXI_NATIVE_MEMORY_LOG_RESTART) || 0,
    unique: uniqueLog,
  });
  if (uniqueLog) console.log(`Memory diagnostics instance log: ${logPath}`);
  const rotation = rotateLogOnStartup(logPath);
  let stopped = false;
  let lastSceneKey: string | undefined;
  let lastSceneEntryAt = performance.now();
  const timer = setInterval(() => {
    const currentSceneKey = getSceneKey(options.scene?.());
    if (performance.now() - lastSceneEntryAt < SAMPLE_INTERVAL_MS) return;
    void (currentSceneKey !== lastSceneKey
      ? sceneEntry("interval:scene-changed")
      : sample("interval:same-scene"));
  }, SAMPLE_INTERVAL_MS);
  timer.unref?.();

  const sample = async (reason = "manual"): Promise<void> => {
    if (stopped) return;
    await rotation;
    const gcExecuted = runGarbageCollection();
    await writeSnapshot(createSnapshot(reason, roots(), gcExecuted, options), logPath);
  };

  const sceneEntry = async (reason = "scene-entry"): Promise<void> => {
    if (stopped) return;
    lastSceneKey = getSceneKey(options.scene?.());
    lastSceneEntryAt = performance.now();
    await sample(reason);
  };

  const collect = async (reason = "manual-gc"): Promise<void> => {
    await rotation;
    const before = createSnapshot(`${reason}:before`, roots(), false, options);
    const beforeWriteGc = runGarbageCollection();
    const beforeRecord = { ...before, gcExecuted: beforeWriteGc };
    const afterWriteGc = runGarbageCollection();
    const afterRecord = createSnapshot(
      `${reason}:after`,
      roots(),
      afterWriteGc,
      options,
    );
    console.log(
      `Manual GC ${afterWriteGc ? "executed" : "unavailable"}: ` +
        `heapUsed ${formatBytes(before.memory.heapUsed)} -> ${formatBytes(afterRecord.memory.heapUsed)}, ` +
        `rss ${formatBytes(before.memory.rss)} -> ${formatBytes(afterRecord.memory.rss)}, ` +
        `objects ${formatObjects(afterRecord.objects)}`,
    );
    await writeSnapshot(beforeRecord, logPath);
    await writeSnapshot(afterRecord, logPath);
  };

  void sceneEntry("startup");

  return {
    sample,
    sceneEntry,
    collect,
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** Moves the previous memory log aside before the first sample is written. */
async function rotateLogOnStartup(logPath: string): Promise<void> {
  await mkdir(dirname(logPath), { recursive: true });
  if (logPath.toLowerCase() !== resolve("logs/memoryInfo.log").toLowerCase()) return;
  const previousPath = resolve(dirname(logPath), "memoryInfo-prev.log");
  try {
    await rm(previousPath, { force: true });
    await rename(logPath, previousPath);
  } catch (error) {
    const code = error as NodeJS.ErrnoException;
    if (code.code !== "ENOENT") {
      console.warn("Memory diagnostics could not rotate memoryInfo.log:", error);
    }
  }
}

function getSceneKey(
  scene: { index: number; name: string } | undefined,
): string | undefined {
  return scene ? `${scene.index}:${scene.name}` : undefined;
}

function createSnapshot(
  reason: string,
  roots: readonly DiagnosticRoot[],
  gcExecuted: boolean,
  options: MemoryDiagnosticsOptions,
): MemorySnapshot {
  const globalObject = globalThis as typeof globalThis & { gc?: GcFunction };
  return {
    timestamp: new Date().toISOString(),
    timestampMs: 0,
    elapsedMs: 0,
    sequence: 0,
    processId: process.pid,
    reason,
    gcAvailable: typeof globalObject.gc === "function",
    gcExecuted,
    memory: process.memoryUsage(),
    heap: getHeapStatistics(),
    audio: nativeAudioEngine.diagnostics,
    objects: countSceneObjects(roots),
    extra: options.extra?.() ?? {},
    runtime: options.runtime?.() ?? {},
    scene: options.scene?.(),
  };
}

function runGarbageCollection(): boolean {
  const gc = (globalThis as typeof globalThis & { gc?: GcFunction }).gc;
  if (!gc) {
    console.warn("Memory diagnostics: manual GC is unavailable.");
    return false;
  }
  gc();
  return true;
}

async function writeSnapshot(snapshot: MemorySnapshot, logPath: string): Promise<void> {
  const record = {
    ...snapshot,
    timestampMs: Date.now(),
    elapsedMs: performance.now() - diagnosticsStartedAt,
    sequence: ++sequence,
  };
  writeQueue = writeQueue.then(async () => {
    try {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      console.warn(`Memory diagnostics could not write ${logPath}:`, error);
    }
  });
  await writeQueue;
}

export function countSceneObjects(
  roots: readonly DiagnosticRoot[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  const visited = new Set<object>();
  const textures = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    const object = value as {
      constructor?: { name?: string };
      children?: readonly unknown[];
      texture?: unknown;
      textures?: readonly unknown[];
    };
    const name = object.constructor?.name ?? "Object";
    counts[name] = (counts[name] ?? 0) + 1;
    if (object.texture && typeof object.texture === "object") textures.add(object.texture);
    if (object.textures) {
      for (const texture of object.textures) {
        if (texture && typeof texture === "object") textures.add(texture);
      }
    }
    if (object.children) for (const child of object.children) visit(child);
  };
  for (const root of roots) visit(root);
  counts.uniqueTextures = textures.size;
  return counts;
}

/** Counts entries in Pixi's internal cache without depending on its versioned shape. */
export function countCacheEntries(cache: unknown): number {
  const value = cache as { _cache?: unknown; _cacheMap?: unknown } | null;
  for (const candidate of [value?._cacheMap, value?._cache]) {
    if (candidate instanceof Map) return candidate.size;
    if (candidate && typeof candidate === "object") {
      return Object.keys(candidate).length;
    }
  }
  return 0;
}

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatObjects(objects: Record<string, number>): string {
  return Object.entries(objects)
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
}
