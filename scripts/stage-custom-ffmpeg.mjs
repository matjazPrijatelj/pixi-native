import { access, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FFMPEG_BUILD_INFO_FILE } from "./ffmpeg-build-config.mjs";
import {
    FFMPEG_BINARY_FILES,
    FFMPEG_CHECKSUM_FILE,
    FFMPEG_LICENSE_FILE,
    FFMPEG_PACKAGED_FILES,
    FFMPEG_TARGET_DIRECTORY,
    OBSOLETE_SHARED_FFMPEG_FILES,
    validateFfmpegCapabilities,
    validateFfmpegIdentity,
    writeFfmpegChecksums,
} from "./ffmpeg-distribution.mjs";

if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
        `FFmpeg staging supports only win32-x64, not ${process.platform}-${process.arch}.`,
    );
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = resolve(
    process.env.FFMPEG_BUILD_DIR?.trim() ||
        resolve(root, "native/ffmpeg/out/win32-x64"),
);
const binaryDirectory = resolve(buildDirectory, "bin");
const targetDirectory = resolve(root, FFMPEG_TARGET_DIRECTORY);
const requiredBuildFiles = [
    ...FFMPEG_BINARY_FILES.map((filename) => resolve(binaryDirectory, filename)),
    resolve(buildDirectory, FFMPEG_LICENSE_FILE),
    resolve(buildDirectory, FFMPEG_BUILD_INFO_FILE),
];
const missingBuildFiles = [];
for (const path of requiredBuildFiles) {
    try {
        await access(path);
    } catch {
        missingBuildFiles.push(path);
    }
}
if (missingBuildFiles.length > 0) {
    throw new Error(
        `Minimal FFmpeg build is incomplete; run pnpm ffmpeg:build first. Missing:\n- ${missingBuildFiles.join("\n- ")}`,
    );
}
const temporaryRoot = resolve(root, ".tmp");
await mkdir(temporaryRoot, { recursive: true });
const stagingDirectory = await mkdtemp(
    join(temporaryRoot, "minimal-ffmpeg-stage-"),
);

try {
    for (const filename of FFMPEG_BINARY_FILES) {
        await copyFile(
            resolve(binaryDirectory, filename),
            resolve(stagingDirectory, filename),
        );
    }
    for (const filename of [FFMPEG_LICENSE_FILE, FFMPEG_BUILD_INFO_FILE]) {
        await copyFile(
            resolve(buildDirectory, filename),
            resolve(stagingDirectory, filename),
        );
    }

    await validateFfmpegIdentity(stagingDirectory, true);
    validateFfmpegCapabilities(stagingDirectory);
    await writeFfmpegChecksums(stagingDirectory);

    await mkdir(targetDirectory, { recursive: true });
    for (const filename of [...FFMPEG_PACKAGED_FILES, FFMPEG_CHECKSUM_FILE]) {
        await copyFile(
            resolve(stagingDirectory, filename),
            resolve(targetDirectory, filename),
        );
    }
    for (const filename of OBSOLETE_SHARED_FFMPEG_FILES) {
        await rm(resolve(targetDirectory, filename), { force: true });
    }
} finally {
    await rm(stagingDirectory, { recursive: true, force: true });
}
console.log(
    `Staged verified minimal LGPL FFmpeg from ${buildDirectory} into ${targetDirectory}.`,
);
