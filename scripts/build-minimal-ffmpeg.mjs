import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    createFfmpegBuildInfo,
    FFMPEG_BUILD_INFO_FILE,
    FFMPEG_CONFIGURE_OPTIONS,
    FFMPEG_SOURCE_ARCHIVE,
    FFMPEG_SOURCE_COMMIT,
    FFMPEG_SOURCE_REVISION,
    FFMPEG_SOURCE_URL,
} from "./ffmpeg-build-config.mjs";

if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error(
        `The minimal FFmpeg build supports only win32-x64, not ${process.platform}-${process.arch}.`,
    );
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const msysRoot = resolve(process.env.MSYS2_ROOT?.trim() || "C:\\msys64");
const bash = join(msysRoot, "usr", "bin", "bash.exe");
const requiredTools = [
    bash,
    ...[
        "awk.exe",
        "cygpath.exe",
        "dirname.exe",
        "grep.exe",
        "mkdir.exe",
        "sed.exe",
        "tr.exe",
        "uname.exe",
    ].map((executable) => join(msysRoot, "usr", "bin", executable)),
    join(msysRoot, "usr", "bin", "make.exe"),
    join(msysRoot, "usr", "bin", "nasm.exe"),
    join(msysRoot, "ucrt64", "bin", "gcc.exe"),
    join(msysRoot, "ucrt64", "bin", "g++.exe"),
    join(msysRoot, "ucrt64", "bin", "strip.exe"),
];

const missingTools = [];
for (const tool of requiredTools) {
    try {
        await access(tool);
    } catch {
        missingTools.push(tool);
    }
}
if (missingTools.length > 0) {
    throw new Error(
        "A healthy MSYS2 UCRT64 FFmpeg toolchain is required. Reinstall or update MSYS2, then install base-devel, nasm, and mingw-w64-ucrt-x86_64-toolchain. Missing:\n- " +
            missingTools.join("\n- "),
    );
}

const ffmpegRoot = resolve(root, "native/ffmpeg");
const sourceDirectory = resolve(ffmpegRoot, "source");
const buildDirectory = resolve(ffmpegRoot, "build/win32-x64");
const installDirectory = resolve(ffmpegRoot, "out/win32-x64");
const configureOptionsFile = resolve(buildDirectory, "configure-options.txt");
const artifactsDirectory = resolve(root, "artifacts");

let clonedSource = false;
try {
    await access(join(sourceDirectory, ".git"));
} catch {
    await mkdir(ffmpegRoot, { recursive: true });
    execFileSync(
        "git",
        [
            "clone",
            "--filter=blob:none",
            "--no-checkout",
            FFMPEG_SOURCE_URL,
            sourceDirectory,
        ],
        {
            cwd: root,
            stdio: "inherit",
        },
    );
    clonedSource = true;
}

const origin = execFileSync(
    "git",
    ["-C", sourceDirectory, "remote", "get-url", "origin"],
    { encoding: "utf8" },
).trim();
if (origin !== FFMPEG_SOURCE_URL) {
    throw new Error(`FFmpeg source checkout has unexpected origin ${origin}.`);
}
if (!clonedSource) {
    const sourceStatus = execFileSync(
        "git",
        ["-C", sourceDirectory, "status", "--porcelain"],
        { encoding: "utf8" },
    );
    if (sourceStatus.trim()) {
        throw new Error(
            `Generated FFmpeg source checkout contains local changes:\n${sourceStatus}`,
        );
    }
}
try {
    execFileSync(
        "git",
        [
            "-C",
            sourceDirectory,
            "cat-file",
            "-e",
            `${FFMPEG_SOURCE_COMMIT}^{commit}`,
        ],
        { stdio: "ignore" },
    );
} catch {
    execFileSync(
        "git",
        ["-C", sourceDirectory, "fetch", "--filter=blob:none", "origin"],
        {
            cwd: root,
            stdio: "inherit",
        },
    );
}
execFileSync(
    "git",
    ["-C", sourceDirectory, "checkout", "--detach", FFMPEG_SOURCE_COMMIT],
    {
        cwd: root,
        stdio: "inherit",
    },
);
const resolvedCommit = execFileSync(
    "git",
    ["-C", sourceDirectory, "rev-parse", "HEAD"],
    { encoding: "utf8" },
).trim();
if (resolvedCommit !== FFMPEG_SOURCE_COMMIT) {
    throw new Error(
        `FFmpeg source resolved to unexpected commit ${resolvedCommit}.`,
    );
}

for (const generatedDirectory of [buildDirectory, installDirectory]) {
    if (!generatedDirectory.startsWith(`${ffmpegRoot}\\`)) {
        throw new Error(
            `Refusing to replace FFmpeg output outside ${ffmpegRoot}: ${generatedDirectory}`,
        );
    }
    await rm(generatedDirectory, { recursive: true, force: true });
}
await mkdir(buildDirectory, { recursive: true });
await mkdir(installDirectory, { recursive: true });
await mkdir(artifactsDirectory, { recursive: true });
await writeFile(
    configureOptionsFile,
    `${FFMPEG_CONFIGURE_OPTIONS.join("\n")}\n`,
);

const shellScript = resolve(root, "scripts/build-minimal-ffmpeg.sh");
execFileSync(
    bash,
    [
        shellScript,
        sourceDirectory,
        buildDirectory,
        installDirectory,
        configureOptionsFile,
    ],
    {
        cwd: root,
        env: {
            ...process.env,
            MSYSTEM: "UCRT64",
            CHERE_INVOKING: "1",
            MSYS2_PATH_TYPE: "inherit",
        },
        stdio: "inherit",
        windowsHide: true,
    },
);

const compilerVersion = execFileSync(
    join(msysRoot, "ucrt64", "bin", "gcc.exe"),
    ["--version"],
    {
        encoding: "utf8",
        windowsHide: true,
    },
).split(/\r?\n/)[0];
await writeFile(
    resolve(installDirectory, FFMPEG_BUILD_INFO_FILE),
    createFfmpegBuildInfo(compilerVersion),
);
await writeFile(
    resolve(installDirectory, "FFMPEG_LICENSE.txt"),
    await readFile(resolve(sourceDirectory, "COPYING.LGPLv2.1")),
);

const sourceArchive = resolve(artifactsDirectory, FFMPEG_SOURCE_ARCHIVE);
execFileSync(
    "git",
    [
        "-C",
        sourceDirectory,
        "archive",
        "--format=tar.gz",
        `--prefix=ffmpeg-${FFMPEG_SOURCE_REVISION}/`,
        "-o",
        sourceArchive,
        "HEAD",
    ],
    {
        cwd: root,
        stdio: "inherit",
    },
);
const sourceArchiveChecksum = createHash("sha256")
    .update(await readFile(sourceArchive))
    .digest("hex");
await writeFile(
    `${sourceArchive}.sha256`,
    `${sourceArchiveChecksum}  ${FFMPEG_SOURCE_ARCHIVE}\n`,
);

execFileSync(
    process.execPath,
    [resolve(root, "scripts/stage-custom-ffmpeg.mjs")],
    {
        cwd: root,
        stdio: "inherit",
    },
);
console.log(`Built minimal FFmpeg and source archive ${sourceArchive}.`);
