import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    FFMPEG_CHECKSUM_FILE,
    FFMPEG_PACKAGED_FILES,
    FFMPEG_TARGET_DIRECTORY,
    runFfmpegSmokeTests,
    validateFfmpegCapabilities,
    validateFfmpegChecksums,
    validateFfmpegIdentity,
} from "./ffmpeg-distribution.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_NATIVE_ARTIFACTS = [
    "native/gpu/dist/win32-x64/pixi_native_gpu.node",
    "native/gpu/dist/win32-x64/d3dcompiler_47.dll",
    "native/window/dist/win32-x64/native_window.node",
    "native/audio/dist/win32-x64/native_audio.node",
    "native/video/dist/linux-x64/native_video.node",
    "native/video/dist/win32-x64/native_video.node",
];
const REQUIRED_FFMPEG_ARTIFACTS = [
    ...FFMPEG_PACKAGED_FILES,
    FFMPEG_CHECKSUM_FILE,
].map((filename) => `${FFMPEG_TARGET_DIRECTORY}/${filename}`);

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

const ffmpegDirectory = resolve(root, FFMPEG_TARGET_DIRECTORY);
await validateFfmpegChecksums(ffmpegDirectory);
await validateFfmpegIdentity(ffmpegDirectory, process.platform === "win32");
if (process.platform === "win32") {
    validateFfmpegCapabilities(ffmpegDirectory);
    await runFfmpegSmokeTests(
        ffmpegDirectory,
        resolve(root, "src/demo/assets/Big_Buck_Bunny_1080_30s.mp4"),
        resolve(root, "src/demo/assets/audio/howler-test.wav"),
        resolve(root, "src/demo/tests/fixtures/hevc-one-frame.mp4"),
    );
}

console.log(
    `Validated ${REQUIRED_NATIVE_ARTIFACTS.length} native artifacts and ${REQUIRED_FFMPEG_ARTIFACTS.length} FFmpeg distribution files.`,
);
