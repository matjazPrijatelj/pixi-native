import { copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, args) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });

await run("cargo", ["build", "--release"]);
const output = resolve(root, "dist", `${process.platform}-${process.arch}`);
await mkdir(output, { recursive: true });
await copyFile(
  resolve(
    root,
    "target",
    "release",
    process.platform === "win32"
      ? "pixi_node_window.dll"
      : "libpixi_node_window.so",
  ),
  resolve(output, "native_window.node"),
);
