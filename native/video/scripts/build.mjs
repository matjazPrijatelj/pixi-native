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
    (process.platform === "win32"
      ? "../ffmpeg/out/win32-x64-shared"
      : "../ffmpeg/out/linux-x64-shared"),
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
  if (process.platform !== "win32" && process.platform !== "linux") {
    throw new Error(
      `Native FFmpeg backend builds support Windows and Linux x64, not ${process.platform}.`,
    );
  }
  const includeDirectory = resolve(nativeFfmpegSdk, "include");
  const binaryDirectory = resolve(nativeFfmpegSdk, "bin");
  // The MSVC SDK places import libraries beside DLLs; Linux shared SDKs keep
  // their runtime libraries and pkg-config metadata under lib/.
  const libraryDirectory =
    process.platform === "win32" ? binaryDirectory : resolve(nativeFfmpegSdk, "lib");
  for (const requiredPath of [
    resolve(includeDirectory, "libavcodec", "avcodec.h"),
    process.platform === "win32"
      ? resolve(libraryDirectory, "avcodec.lib")
      : resolve(libraryDirectory, "pkgconfig", "libavcodec.pc"),
    process.platform === "win32"
      ? resolve(libraryDirectory, "avformat.lib")
      : resolve(libraryDirectory, "pkgconfig", "libavformat.pc"),
    process.platform === "win32"
      ? resolve(libraryDirectory, "avutil.lib")
      : resolve(libraryDirectory, "pkgconfig", "libavutil.pc"),
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
    ...(process.platform === "win32"
      ? {
          FFMPEG_INCLUDE_DIR: includeDirectory,
          FFMPEG_LIBS_DIR: libraryDirectory,
          PATH: `${binaryDirectory};${process.env.PATH ?? ""}`,
        }
      : {
          FFMPEG_PKG_CONFIG_PATH: resolve(libraryDirectory, "pkgconfig"),
          FFMPEG_LINK_MODE: "dynamic",
          LD_LIBRARY_PATH: `${libraryDirectory}:${process.env.LD_LIBRARY_PATH ?? ""}`,
          // The package stages FFmpeg .so files beside native_video.node.
          // Keep that directory in the addon's runtime lookup path.
          RUSTFLAGS: `${process.env.RUSTFLAGS ?? ""} -C link-arg=-Wl,-rpath,$ORIGIN`.trim(),
        }),
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

if (nativeFfmpegEnabled && process.platform === "win32") {
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

if (nativeFfmpegEnabled && process.platform === "linux") {
  const libraryDirectory = resolve(nativeFfmpegSdk, "lib");
  const libraryFiles = await readdir(libraryDirectory);
  const sharedLibraries = libraryFiles.filter((filename) =>
    /^lib(?:avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale)\.so\.\d+(?:\.\d+)*$/u.test(filename),
  );
  if (sharedLibraries.length === 0) {
    throw new Error(
      `Native FFmpeg SDK is incomplete at ${nativeFfmpegSdk}: no FFmpeg shared libraries found in ${libraryDirectory}`,
    );
  }
  for (const filename of sharedLibraries) {
    await copyFile(
      resolve(libraryDirectory, filename),
      resolve(root, "dist", platformDirectory, filename),
    );
    await copyFile(
      resolve(libraryDirectory, filename),
      resolve(packageOutput, filename),
    );
  }
}
