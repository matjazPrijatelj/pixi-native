import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const durationSeconds = readPositiveNumber("--duration-seconds", 600);
const startupGraceMs = 15_000;
const requestedBackend =
  process.argv
    .find((value) => value.startsWith("--backend="))
    ?.split("=", 2)[1] ?? "both";
const requestedScenes = process.argv
  .find((value) => value.startsWith("--scenes="))
  ?.slice("--scenes=".length)
  .trim();
const backends =
  requestedBackend === "both" ? ["webgl", "webgpu"] : [requestedBackend];
const outputDir = resolve("logs", "native-memory-isolation");
const sceneRunName = requestedScenes
  ?.split(",")
  .map((name) => name.trim().replaceAll(/[^a-z0-9-]/gi, "-"))
  .filter(Boolean)
  .join("-");
const runOutputDir = sceneRunName ? resolve(outputDir, sceneRunName) : outputDir;

if (backends.some((backend) => backend !== "webgl" && backend !== "webgpu")) {
  throw new Error("Use --backend=webgl, --backend=webgpu, or --backend=both");
}

await rm(runOutputDir, { recursive: true, force: true });
await mkdir(runOutputDir, { recursive: true });
if (existsSync(".env")) process.loadEnvFile(".env");

for (const backend of backends) {
  const logPath = resolve(runOutputDir, `${backend}.log`);
  console.log(
    `Starting visible ${backend} isolation run for ${durationSeconds} seconds.`,
  );
  const isWindows = process.platform === "win32";
  // Invoke the demo entrypoint directly so the child PID owns the visible
  // application and can be terminated reliably after the soak.
  const child = spawn(
    process.execPath,
    ["--expose-gc", "--enable-source-maps", "src/demo/v8/main.ts", backend],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: false,
      env: {
        ...process.env,
        MEMORYINFO_LOG_PATH: logPath,
        AUTOTOGGLE_INTERVAL: process.env.AUTOTOGGLE_INTERVAL ?? "15",
        ...(requestedScenes ? { MEMORY_TEST_SCENES: requestedScenes } : {}),
        MEMORY_ISOLATION_DURATION_MS: String(
          durationSeconds * 1000 + startupGraceMs,
        ),
      },
    },
  );
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  let timedOut = false;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      if (isWindows && child.pid) {
        execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
      } else {
        child.kill("SIGTERM");
      }
    },
    durationSeconds * 1000 + startupGraceMs,
  );
  timeout.unref?.();
  const result = await exit;
  clearTimeout(timeout);
  if (!timedOut && result.code !== 0 && result.signal !== "SIGTERM") {
    throw new Error(
      `${backend} isolation run exited with code ${result.code ?? result.signal}`,
    );
  }
  console.log(
    `Completed ${backend}; analyze with: pnpm analyze-memory-info ${logPath}`,
  );
}

const reportPath = resolve(runOutputDir, "report.md");
const reportSections = [];
for (const backend of backends) {
  const logPath = resolve(runOutputDir, `${backend}.log`);
  if (!existsSync(logPath)) {
    throw new Error(
      `${backend} isolation run ended without creating ${logPath}; increase the duration or inspect the child output.`,
    );
  }
  const summary = execFileSync(
    process.execPath,
    ["scripts/analyze-memory-info.mjs", logPath],
    { encoding: "utf8" },
  );
  reportSections.push(`## ${backend}\n\n${summary.trim()}`);
}
const report =
  `# Pixi Native memory isolation report\n\n` +
  `Generated: ${new Date().toISOString()}\n\n` +
  reportSections.join("\n\n");
await writeFile(reportPath, `${report}\n`, "utf8");
console.log(`Wrote report: ${reportPath}`);

if (process.platform === "win32" && process.argv.includes("--email")) {
  const recipients = process.env.MEMORY_REPORT_EMAIL?.trim();
  if (!recipients) {
    throw new Error(
      "MEMORY_REPORT_EMAIL is missing from .env; refusing to send the report.",
    );
  }
  const attachments = [
    reportPath,
    ...backends.map((backend) => resolve(runOutputDir, `${backend}.log`)),
  ];
  const powershell = [
    "$ErrorActionPreference = 'Stop'",
    "$outlook = New-Object -ComObject Outlook.Application",
    "$mail = $outlook.CreateItem(0)",
    `$mail.To = '${recipients}'`,
    "$mail.Subject = 'Pixi Native memory isolation report'",
    `$mail.Body = ${quotePowerShell(report)}`,
    ...attachments.map(
      (path) => `$mail.Attachments.Add(${quotePowerShell(path)})`,
    ),
    "$mail.Send()",
  ].join("; ");
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", powershell],
    {
      stdio: "inherit",
    },
  );
  console.log(`Sent Outlook report with ${attachments.length} attachments.`);
}

function readPositiveNumber(flag, fallback) {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function quotePowerShell(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
