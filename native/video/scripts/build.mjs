import { mkdir, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (command, args) => new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
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

await run("cargo", ["build", "--release"]);
await mkdir(resolve(root, "dist", platformDirectory), { recursive: true });
await copyFile(
    resolve(root, "target", "release", artifact),
    resolve(root, "dist", platformDirectory, "native_video.node")
);
