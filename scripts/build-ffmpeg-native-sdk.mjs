import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FFMPEG_NATIVE_SDK_CONFIGURE_OPTIONS,
  FFMPEG_SOURCE_COMMIT,
} from "./ffmpeg-build-config.mjs";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The native FFmpeg SDK build requires Windows x64.");
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ffmpegRoot = resolve(repositoryRoot, "native/ffmpeg");
const sourceDirectory = resolve(ffmpegRoot, "source");
const buildDirectory = resolve(ffmpegRoot, "build/win32-x64-shared");
const installDirectory = resolve(ffmpegRoot, "out/win32-x64-shared");
const optionsFile = resolve(buildDirectory, "configure-options.txt");
const msysRoot = resolve(process.env.MSYS2_ROOT?.trim() || "C:\\msys64");
const bash = join(msysRoot, "usr", "bin", "bash.exe");
const vswhere = join(
  process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  "Microsoft Visual Studio",
  "Installer",
  "vswhere.exe",
);

for (const requiredPath of [
  bash,
  vswhere,
  resolve(sourceDirectory, "configure"),
]) {
  await access(requiredPath).catch(() => {
    throw new Error(`Native FFmpeg SDK prerequisite is missing: ${requiredPath}`);
  });
}

const resolvedCommit = execFileSync(
  "git",
  ["-C", sourceDirectory, "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
if (resolvedCommit !== FFMPEG_SOURCE_COMMIT) {
  throw new Error(`FFmpeg source resolved to unexpected commit ${resolvedCommit}.`);
}

const visualStudio = execFileSync(
  vswhere,
  [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ],
  { encoding: "utf8" },
).trim();
if (!visualStudio) throw new Error("Visual Studio C++ tools were not found.");
const developerCommand = join(
  visualStudio,
  "Common7",
  "Tools",
  "VsDevCmd.bat",
);
const environmentScript = resolve(
  repositoryRoot,
  "scripts/print-vs-build-environment.cmd",
);
const environmentOutput = execFileSync(
  process.env.ComSpec || "cmd.exe",
  ["/d", "/c", environmentScript, developerCommand],
  { encoding: "utf8", windowsHide: true },
);
const buildEnvironment = { ...process.env };
for (const line of environmentOutput.split(/\r?\n/)) {
  const separator = line.indexOf("=");
  if (separator <= 0) continue;
  buildEnvironment[line.slice(0, separator)] = line.slice(separator + 1);
}

for (const generatedDirectory of [buildDirectory, installDirectory]) {
  if (!generatedDirectory.startsWith(`${ffmpegRoot}\\`)) {
    throw new Error(`Refusing to replace output outside ${ffmpegRoot}.`);
  }
  await rm(generatedDirectory, { recursive: true, force: true });
}
await mkdir(buildDirectory, { recursive: true });
await mkdir(installDirectory, { recursive: true });
await writeFile(
  optionsFile,
  `${FFMPEG_NATIVE_SDK_CONFIGURE_OPTIONS.join("\n")}\n`,
);

execFileSync(
  bash,
  [
    resolve(repositoryRoot, "scripts/build-ffmpeg-native-sdk.sh"),
    sourceDirectory,
    buildDirectory,
    installDirectory,
    optionsFile,
  ],
  {
    cwd: repositoryRoot,
    env: buildEnvironment,
    stdio: "inherit",
    windowsHide: true,
  },
);

for (const requiredOutput of [
  "include/libavcodec/avcodec.h",
  "bin/avcodec.lib",
  "bin/avformat.lib",
  "bin/avutil.lib",
]) {
  await access(resolve(installDirectory, requiredOutput)).catch(() => {
    throw new Error(`Native FFmpeg SDK output is missing ${requiredOutput}.`);
  });
}
await writeFile(
  resolve(installDirectory, "configure-options.txt"),
  await readFile(optionsFile),
);
console.log(`Built native FFmpeg SDK at ${installDirectory}.`);
