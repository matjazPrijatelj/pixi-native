import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runFfmpegSmokeTests,
  validateFfmpegCapabilities,
  validateFfmpegChecksums,
  validateFfmpegIdentity,
  getFfmpegDistribution,
} from "./ffmpeg-distribution.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = `${process.platform}-${process.arch}`;
const ffmpegDistribution = getFfmpegDistribution(target);
const REQUIRED_NATIVE_ARTIFACTS = [
  `native/gpu/dist/${target}/pixi_native_gpu.node`,
  ...(target === "win32-x64"
    ? [`native/gpu/dist/${target}/d3dcompiler_47.dll`]
    : []),
  `native/window/dist/${target}/native_window.node`,
  ...(target === "win32-x64"
    ? [`native/audio/dist/${target}/native_audio.node`]
    : []),
  `native/video/dist/${target}/native_video.node`,
];
const REQUIRED_FFMPEG_ARTIFACTS = [
  ...ffmpegDistribution.packagedFiles,
  ffmpegDistribution.checksumFile,
].map((filename) => `${ffmpegDistribution.targetDirectory}/${filename}`);

const missing = [];
for (const relativePath of [
  ...REQUIRED_NATIVE_ARTIFACTS,
  ...REQUIRED_FFMPEG_ARTIFACTS,
]) {
  try {
    await access(resolve(root, relativePath));
  } catch {
    missing.push(relativePath);
  }
}

if (missing.length > 0) {
  throw new Error(
    `Missing distribution native artifacts:\n- ${missing.join("\n- ")}`,
  );
}

const ffmpegDirectory = resolve(root, ffmpegDistribution.targetDirectory);
await validateFfmpegChecksums(
  ffmpegDirectory,
  ffmpegDistribution.packagedFiles,
  ffmpegDistribution.checksumFile,
);
await validateFfmpegIdentity(
  ffmpegDirectory,
  process.platform === "win32" || process.platform === "linux",
  ffmpegDistribution,
);
if (process.platform === "win32" || process.platform === "linux") {
  validateFfmpegCapabilities(ffmpegDirectory, ffmpegDistribution);
  await runFfmpegSmokeTests(
    ffmpegDirectory,
    resolve(root, "src/demo/assets/Big_Buck_Bunny_720_10s_20MB.mp4"),
    resolve(root, "src/demo/assets/audio/howler-test.wav"),
    resolve(root, "tests/fixtures/hevc-one-frame.mp4"),
    ffmpegDistribution,
  );
}

console.log(
  `Validated ${REQUIRED_NATIVE_ARTIFACTS.length} native artifacts and ${ffmpegDistribution.packagedFiles.length + 1} FFmpeg distribution files for ${target}.`,
);
