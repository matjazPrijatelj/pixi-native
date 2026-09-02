import { mkdir, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFfmpegDependency, packageFfmpegRuntime } from "../../ffmpeg/scripts/dependency.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args, environment = process.env) => new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
});

const artifacts = {
    linux: "libpixi_node_video.so",
    win32: "pixi_node_video.dll"
};
const artifact = artifacts[process.platform];
if (!artifact || process.arch !== "x64") {
    throw new Error(`Native video builds are supported only on Linux x64 and Windows x64, not ${process.platform}-${process.arch}`);
}
const platformDirectory = `${process.platform}-${process.arch}`;
const ffmpeg = await ensureFfmpegDependency();
const environment = ffmpeg
    ? {
        ...process.env,
        FFMPEG_INCLUDE_DIR: ffmpeg.includeDirectory,
        FFMPEG_LIBS_DIR: ffmpeg.libraryDirectory,
        FFMPEG_LINK_MODE: "dynamic",
        PATH: `${ffmpeg.binDirectory};${process.env.PATH ?? ""}`,
    }
    : process.env;

await run("cargo", ["build", "--release"], environment);
const destination = resolve(root, "dist", platformDirectory);
await mkdir(destination, { recursive: true });
await copyFile(
    resolve(root, "target", "release", artifact),
    resolve(destination, "native_video.node")
);
await packageFfmpegRuntime(ffmpeg, destination);
