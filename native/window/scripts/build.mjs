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
const platformDirectory = `${process.platform}-${process.arch}`;
const output = resolve(root, "dist", platformDirectory);
const packageOutput = resolve(
  root,
  "../../packages",
  `native-${platformDirectory}`,
  "native",
  "window",
  "dist",
  platformDirectory,
);
await mkdir(output, { recursive: true });
await mkdir(packageOutput, { recursive: true });
const nativeBinary = resolve(output, "native_window.node");
await copyFile(
  resolve(
    root,
    "target",
    "release",
    process.platform === "win32"
      ? "pixi_node_window.dll"
      : "libpixi_node_window.so",
  ),
  nativeBinary,
);
await copyFile(nativeBinary, resolve(packageOutput, "native_window.node"));
