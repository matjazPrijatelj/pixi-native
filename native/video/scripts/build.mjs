import { access, mkdir, copyFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WIN32_NATIVE_VIDEO_FFMPEG_DLLS } from "../../../scripts/native-video-runtime.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args, environment = process.env) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });

const artifacts = {
  linux: "libpixi_node_video.so",
  win32: "pixi_node_video.dll",
};
const artifact = artifacts[process.platform];
if (!artifact || process.arch !== "x64") {
  throw new Error(
    `Native video builds are supported only on Linux x64 and Windows x64, not ${process.platform}-${process.arch}`,
  );
}
const platformDirectory = `${process.platform}-${process.arch}`;
const nativeFfmpegEnabled =
  process.env.PIXI_NATIVE_VIDEO_NATIVE_FFMPEG?.trim() === "1";
const nativeFfmpegSdk = resolve(
  root,
  process.env.PIXI_NATIVE_FFMPEG_SDK?.trim() ||
    "../ffmpeg/out/win32-x64-shared",
);
const packageOutput = resolve(
  root,
  "../../packages",
  `native-${platformDirectory}`,
  "native",
  "video",
  "dist",
  platformDirectory,
);

const cargoArguments = ["build", "--release"];
let cargoEnvironment = process.env;
if (nativeFfmpegEnabled) {
  if (process.platform !== "win32") {
    throw new Error(
      "The native FFmpeg backend build currently supports Windows only.",
    );
  }
  const includeDirectory = resolve(nativeFfmpegSdk, "include");
  const binaryDirectory = resolve(nativeFfmpegSdk, "bin");
  // FFmpeg's MSVC install places import libraries next to the DLLs.
  const libraryDirectory = binaryDirectory;
  for (const requiredPath of [
    resolve(includeDirectory, "libavcodec", "avcodec.h"),
    resolve(libraryDirectory, "avcodec.lib"),
    resolve(libraryDirectory, "avformat.lib"),
    resolve(libraryDirectory, "avutil.lib"),
  ]) {
    try {
      await access(requiredPath);
    } catch {
      throw new Error(
        `Native FFmpeg SDK is incomplete at ${nativeFfmpegSdk}: missing ${requiredPath}`,
      );
    }
  }
  cargoArguments.push("--features", "native-ffmpeg");
  cargoEnvironment = {
    ...process.env,
    FFMPEG_INCLUDE_DIR: includeDirectory,
    FFMPEG_LIBS_DIR: libraryDirectory,
    PATH: `${binaryDirectory};${process.env.PATH ?? ""}`,
  };
}

await run("cargo", cargoArguments, cargoEnvironment);
await mkdir(resolve(root, "dist", platformDirectory), { recursive: true });
await mkdir(packageOutput, { recursive: true });
const nativeBinary = resolve(
  root,
  "dist",
  platformDirectory,
  "native_video.node",
);
await copyFile(resolve(root, "target", "release", artifact), nativeBinary);
await copyFile(nativeBinary, resolve(packageOutput, "native_video.node"));

if (nativeFfmpegEnabled) {
  const binaryDirectory = resolve(nativeFfmpegSdk, "bin");
  const availableFiles = new Set(await readdir(binaryDirectory));
  const sharedLibraries = WIN32_NATIVE_VIDEO_FFMPEG_DLLS;
  for (const filename of sharedLibraries) {
    if (!availableFiles.has(filename)) {
      throw new Error(
        `Native FFmpeg SDK did not provide ${filename} in ${binaryDirectory}`,
      );
    }
    await copyFile(
      resolve(binaryDirectory, filename),
      resolve(root, "dist", platformDirectory, filename),
    );
    await copyFile(
      resolve(binaryDirectory, filename),
      resolve(packageOutput, filename),
    );
  }
}
