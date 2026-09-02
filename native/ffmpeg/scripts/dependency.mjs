import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const FFMPEG_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const PROJECT_ROOT = resolve(FFMPEG_ROOT, "..", "..");
const MANIFEST_PATH = join(FFMPEG_ROOT, "dependency.json");
const CACHE_ROOT = join(PROJECT_ROOT, ".cache", "ffmpeg");
const COMPLETION_MARKER = ".dependency.json";

function run(command, args) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
        child.once("error", reject);
        child.once("exit", (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                reject(new Error(`${command} exited with ${code}`));
            }
        });
    });
}

async function readManifest() {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
}

async function isDirectory(path) {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}

async function sha256(path) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
        hash.update(chunk);
    }
    return hash.digest("hex");
}

async function download(url, destination) {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
        throw new Error(`FFmpeg download failed with HTTP ${response.status}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: "wx" }));
}

async function findSdkRoot(extractRoot) {
    const candidates = [extractRoot];
    for (const entry of await readdir(extractRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(join(extractRoot, entry.name));
    }

    for (const candidate of candidates) {
        if (
            await isDirectory(join(candidate, "bin"))
            && await isDirectory(join(candidate, "include"))
            && await isDirectory(join(candidate, "lib"))
        ) {
            return candidate;
        }
    }
    throw new Error("FFmpeg archive does not contain bin, include, and lib directories");
}

async function validateInstallation(root, expectedSha256) {
    try {
        const marker = JSON.parse(await readFile(join(root, COMPLETION_MARKER), "utf8"));
        return marker.sha256 === expectedSha256
            && await isDirectory(join(root, "bin"))
            && await isDirectory(join(root, "include"))
            && await isDirectory(join(root, "lib"));
    } catch {
        return false;
    }
}

export async function ensureFfmpegDependency({
    platform = process.platform,
    arch = process.arch,
    fetchArchive = download,
} = {}) {
    const target = `${platform}-${arch}`;
    const manifest = await readManifest();
    const dependency = manifest.platforms[target];
    if (!dependency) return null;

    const installRoot = join(CACHE_ROOT, target, dependency.sha256);
    if (await validateInstallation(installRoot, dependency.sha256)) {
        return createDependencyPaths(installRoot, manifest.version, dependency);
    }

    await mkdir(CACHE_ROOT, { recursive: true });
    const temporaryRoot = await mkdtemp(join(CACHE_ROOT, ".download-"));
    const archivePath = join(temporaryRoot, basename(new URL(dependency.url).pathname));
    const extractRoot = join(temporaryRoot, "extract");
    try {
        await mkdir(extractRoot, { recursive: true });
        await fetchArchive(dependency.url, archivePath);
        const actualBytes = (await stat(archivePath)).size;
        if (actualBytes !== dependency.archiveBytes) {
            throw new Error(`FFmpeg archive has ${actualBytes} bytes; expected ${dependency.archiveBytes}`);
        }
        const actualSha256 = await sha256(archivePath);
        if (actualSha256 !== dependency.sha256) {
            throw new Error(`FFmpeg archive SHA-256 mismatch: ${actualSha256}`);
        }

        await run("tar.exe", ["-xf", archivePath, "-C", extractRoot]);
        const sdkRoot = await findSdkRoot(extractRoot);
        await writeFile(
            join(sdkRoot, COMPLETION_MARKER),
            `${JSON.stringify({ version: manifest.version, sha256: dependency.sha256 }, null, 4)}\n`,
        );
        await mkdir(dirname(installRoot), { recursive: true });
        await rm(installRoot, { recursive: true, force: true });
        await rename(sdkRoot, installRoot);
        return createDependencyPaths(installRoot, manifest.version, dependency);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
}

function createDependencyPaths(root, version, dependency) {
    return {
        root,
        version,
        license: dependency.license,
        binDirectory: join(root, "bin"),
        includeDirectory: join(root, "include"),
        libraryDirectory: join(root, "lib"),
        ffmpegPath: join(root, "bin", "ffmpeg.exe"),
        ffprobePath: join(root, "bin", "ffprobe.exe"),
    };
}

export async function packageFfmpegRuntime(dependency, destination) {
    if (!dependency) return [];
    await mkdir(destination, { recursive: true });
    const copied = [];
    for (const entry of await readdir(dependency.binDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^(?:ffmpeg|ffprobe)\.exe$|\.dll$/i.test(entry.name)) continue;
        await copyFile(join(dependency.binDirectory, entry.name), join(destination, entry.name));
        copied.push(entry.name);
    }

    for (const licenseName of ["LICENSE.txt", "COPYING.LGPLv2.1"]) {
        try {
            await copyFile(join(dependency.root, licenseName), join(destination, `FFmpeg-${licenseName}`));
            copied.push(`FFmpeg-${licenseName}`);
        } catch {
            // Upstream archives do not use the same license filename on every release.
        }
    }
    await writeFile(
        join(destination, "FFmpeg-dependency.json"),
        `${JSON.stringify({ version: dependency.version, license: dependency.license }, null, 4)}\n`,
    );
    copied.push("FFmpeg-dependency.json");
    return copied;
}
