import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getHeapStatistics } from "node:v8";
import { nativeAudioEngine } from "@pixi-native/core/audio";

const SAMPLE_INTERVAL_MS = 150_000;
const LOG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../memoryinfo.log",
);

type DiagnosticRoot = unknown;
type GcFunction = (() => void) | undefined;

export interface MemoryDiagnostics {
  sample(reason?: string): Promise<void>;
  collect(reason?: string): Promise<void>;
  stop(): void;
}

interface MemorySnapshot {
  readonly timestamp: string;
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
}

export function startMemoryDiagnostics(
  roots: () => readonly DiagnosticRoot[],
): MemoryDiagnostics {
  let stopped = false;
  const timer = setInterval(() => {
    void sample("interval");
  }, SAMPLE_INTERVAL_MS);
  timer.unref?.();

  const sample = async (reason = "manual"): Promise<void> => {
    if (stopped) return;
    const gcExecuted = runGarbageCollection();
    await writeSnapshot(createSnapshot(reason, roots(), gcExecuted));
  };

  const collect = async (reason = "manual-gc"): Promise<void> => {
    const before = createSnapshot(`${reason}:before`, roots(), false);
    const beforeWriteGc = runGarbageCollection();
    const beforeRecord = { ...before, gcExecuted: beforeWriteGc };
    const afterWriteGc = runGarbageCollection();
    const afterRecord = createSnapshot(`${reason}:after`, roots(), afterWriteGc);
    console.log(
      `Manual GC ${afterWriteGc ? "executed" : "unavailable"}: ` +
        `heapUsed ${formatBytes(before.memory.heapUsed)} -> ${formatBytes(afterRecord.memory.heapUsed)}, ` +
        `rss ${formatBytes(before.memory.rss)} -> ${formatBytes(afterRecord.memory.rss)}, ` +
        `objects ${formatObjects(afterRecord.objects)}`,
    );
    await writeSnapshot(beforeRecord);
    await writeSnapshot(afterRecord);
  };

  void sample("startup");

  return {
    sample,
    collect,
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

function createSnapshot(
  reason: string,
  roots: readonly DiagnosticRoot[],
  gcExecuted: boolean,
): MemorySnapshot {
  const globalObject = globalThis as typeof globalThis & { gc?: GcFunction };
  return {
    timestamp: new Date().toISOString(),
    reason,
    gcAvailable: typeof globalObject.gc === "function",
    gcExecuted,
    memory: process.memoryUsage(),
    heap: getHeapStatistics(),
    audio: nativeAudioEngine.diagnostics,
    objects: countSceneObjects(roots),
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

async function writeSnapshot(snapshot: MemorySnapshot): Promise<void> {
  try {
    await mkdir(dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, `${JSON.stringify(snapshot)}\n`, "utf8");
  } catch (error) {
    console.warn("Memory diagnostics could not write memoryinfo.log:", error);
  }
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

function formatBytes(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatObjects(objects: Record<string, number>): string {
  return Object.entries(objects)
    .map(([name, count]) => `${name}=${count}`)
    .join(", ");
}
