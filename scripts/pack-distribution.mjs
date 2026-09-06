import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    FFMPEG_CHECKSUM_FILE,
    FFMPEG_PACKAGED_FILES,
    FFMPEG_TARGET_DIRECTORY,
} from "./ffmpeg-distribution.mjs";
import {
    FFMPEG_SOURCE_ARCHIVE,
    FFMPEG_SOURCE_REVISION,
} from "./ffmpeg-build-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactsDirectory = resolve(root, "artifacts");
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
const REQUIRED_PACKAGE_FILES = [
    "package.json",
    "README.md",
    "HISTORY.md",
    "THIRD_PARTY_NOTICES.md",
    "dist/pixi-native/v7.js",
    "dist/pixi-native/v7.d.ts",
    "dist/pixi-native/v8.js",
    "dist/pixi-native/v8.d.ts",
    "native/gpu/dist/win32-x64/pixi_native_gpu.node",
    "native/gpu/dist/win32-x64/d3dcompiler_47.dll",
    "native/window/dist/win32-x64/native_window.node",
    "native/audio/dist/win32-x64/native_audio.node",
    "native/video/dist/linux-x64/native_video.node",
    "native/video/dist/win32-x64/native_video.node",
    ...FFMPEG_PACKAGED_FILES.map(
        (filename) => `${FFMPEG_TARGET_DIRECTORY}/${filename}`,
    ),
    `${FFMPEG_TARGET_DIRECTORY}/${FFMPEG_CHECKSUM_FILE}`,
];

await mkdir(artifactsDirectory, { recursive: true });
const sourceArchivePath = resolve(artifactsDirectory, FFMPEG_SOURCE_ARCHIVE);
try {
    await access(sourceArchivePath);
} catch {
    throw new Error(
        `Missing corresponding FFmpeg source archive ${sourceArchivePath}; run pnpm ffmpeg:build first.`,
    );
}
const sourcePrefix = `ffmpeg-${FFMPEG_SOURCE_REVISION}/`;
const sourceEntries = execFileSync("tar", ["-tf", sourceArchivePath], {
    encoding: "utf8",
})
    .trimEnd()
    .split(/\r?\n/);
if (
    sourceEntries.some((entry) => !entry.startsWith(sourcePrefix)) ||
    !sourceEntries.includes(`${sourcePrefix}configure`) ||
    !sourceEntries.includes(`${sourcePrefix}COPYING.LGPLv2.1`) ||
    !sourceEntries.includes(`${sourcePrefix}RELEASE`)
) {
    throw new Error(
        `FFmpeg source archive does not contain the expected ${sourcePrefix} source tree.`,
    );
}
const sourceRelease = execFileSync(
    "tar",
    ["-xOf", sourceArchivePath, `${sourcePrefix}RELEASE`],
    { encoding: "utf8" },
).trim();
if (sourceRelease !== "8.0") {
    throw new Error(
        `FFmpeg source archive has unexpected release ${sourceRelease}.`,
    );
}
execSync("pnpm package:prepare", { cwd: root, stdio: "inherit" });

const packOutput = execSync(
    "npm pack --ignore-scripts --json --pack-destination artifacts",
    { cwd: root, encoding: "utf8" },
);

const [manifest] = JSON.parse(packOutput);
const packageFiles = new Set(manifest.files.map((file) => file.path));
const missing = REQUIRED_PACKAGE_FILES.filter(
    (file) => !packageFiles.has(file),
);
if (missing.length > 0) {
    throw new Error(
        `Packed archive is missing required files:\n- ${missing.join("\n- ")}`,
    );
}

const forbidden = manifest.files
    .map((file) => file.path)
    .filter(
        (path) =>
            path.startsWith("src/") ||
            (path.endsWith(".ts") && !path.endsWith(".d.ts")) ||
            path.includes("/dawn/") ||
            path.includes("/depot_tools/") ||
            path.includes("/build/") ||
            path.includes("/patches/") ||
            path.includes("/scripts/") ||
            path === "native/video/dist/native_video.node" ||
            (path.startsWith(`${FFMPEG_TARGET_DIRECTORY}/`) &&
                path.endsWith(".dll")),
    );
if (forbidden.length > 0) {
    throw new Error(
        `Packed archive contains forbidden files:\n- ${forbidden.join("\n- ")}`,
    );
}
if (manifest.unpackedSize > MAX_UNPACKED_BYTES) {
    throw new Error(
        `Packed archive is too large: ${manifest.unpackedSize} bytes exceeds ${MAX_UNPACKED_BYTES}.`,
    );
}

const archivePath = resolve(artifactsDirectory, manifest.filename);
const checksum = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
await writeFile(`${archivePath}.sha256`, `${checksum}  ${manifest.filename}\n`);
const sourceChecksum = createHash("sha256")
    .update(await readFile(sourceArchivePath))
    .digest("hex");
await writeFile(
    `${sourceArchivePath}.sha256`,
    `${sourceChecksum}  ${FFMPEG_SOURCE_ARCHIVE}\n`,
);

execFileSync(
    process.execPath,
    [resolve(root, "scripts/test-distribution.mjs"), archivePath],
    {
        cwd: root,
        stdio: "inherit",
    },
);

console.log(`Created ${archivePath}`);
console.log(
    `Package files: ${manifest.entryCount}; unpacked bytes: ${manifest.unpackedSize}`,
);
console.log(`SHA-256: ${checksum}`);
console.log(`FFmpeg source: ${sourceArchivePath}`);
console.log(`FFmpeg source SHA-256: ${sourceChecksum}`);
