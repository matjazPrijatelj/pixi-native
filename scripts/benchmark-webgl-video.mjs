import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const durationSeconds = readPositiveNumber("--duration-seconds", 30);
const startupGraceSeconds = readNonNegativeNumber("--startup-grace-seconds", 8);
const asset = readOption("--asset") ?? "4k_60fps.mp4";
const requestedBackend = readOption("--decoder") ?? "both";
const decoderBackends = resolveDecoderBackends(requestedBackend);
const runId = new Date().toISOString().replaceAll(/[:.]/gu, "-");
const outputDirectory = resolve("artifacts", "video-benchmarks", runId);

if (process.platform !== "win32") {
  throw new Error("WebGL video benchmarks run on Windows native presentation only.");
}

await mkdir(outputDirectory, { recursive: true });
const summaries = [];
for (const decoderBackend of decoderBackends) {
  summaries.push(
    await runBenchmark({
      decoderBackend,
      asset,
      durationSeconds,
      outputDirectory,
    }),
  );
}

const summaryPath = resolve(outputDirectory, "summary.json");
await writeFile(
  summaryPath,
  `${JSON.stringify({ asset, durationSeconds, summaries }, null, 2)}\n`,
  "utf8",
);
console.log(`Video benchmark results: ${summaryPath}`);
for (const summary of summaries) {
  console.log(
    `${summary.decoderBackend}: decoded=${summary.decodedFrames ?? "n/a"}, presented=${summary.presentedFrames ?? "n/a"}, skipped=${summary.skippedFrames ?? "n/a"}, dropped=${summary.droppedFrames ?? "n/a"}`,
  );
}

async function runBenchmark({
  decoderBackend,
  asset: videoAsset,
  durationSeconds: duration,
  outputDirectory: directory,
}) {
  const logPath = resolve(directory, `${decoderBackend}.log`);
  const log = createWriteStream(logPath, { flags: "w" });
  const child = spawn(
    process.execPath,
    ["--expose-gc", "--enable-source-maps", "src/demo/v8/main.ts", "webgl"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_TEST_SCENES: "video",
        // The demo initializes its renderer and D3D11VA worker before the
        // first presentation, so allow it to start before automatic shutdown.
        MEMORY_ISOLATION_DURATION_MS: String(
          (duration + startupGraceSeconds) * 1000,
        ),
        PIXI_NATIVE_VIDEO_ASSET: videoAsset,
        PIXI_NATIVE_VIDEO_BACKEND: decoderBackend,
        PIXI_NATIVE_VIDEO_STATS_LOG: "1",
      },
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const result = await new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code, signal }));
  });
  await new Promise((resolveClose) => log.end(resolveClose));
  if (result.code !== 0) {
    throw new Error(
      `${decoderBackend} benchmark exited with ${result.code ?? result.signal}; inspect ${logPath}`,
    );
  }
  const text = await readFile(logPath, "utf8");
  return {
    decoderBackend,
    logPath,
    ...extractLastStats(text),
  };
}

function extractLastStats(text) {
  return Object.fromEntries(
    ["decodedFrames", "presentedFrames", "skippedFrames", "droppedFrames"]
      .map((name) => {
        const matches = [...text.matchAll(new RegExp(`${name}: (\\d+)`, "gu"))];
        return [name, matches.at(-1)?.[1] ? Number(matches.at(-1)[1]) : null];
      }),
  );
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function readPositiveNumber(name, fallback) {
  const value = Number(readOption(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeNumber(name, fallback) {
  const value = Number(readOption(name));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveDecoderBackends(value) {
  if (value === "both") return ["lib", "cli"];
  if (value === "lib" || value === "cli") return [value];
  throw new Error("--decoder must be lib, cli, or both.");
}
