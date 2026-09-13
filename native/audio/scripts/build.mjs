import { copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if ((process.platform !== "win32" && process.platform !== "linux") || process.arch !== "x64") {
  throw new Error(
    `Native audio builds support only Windows/Linux x64, not ${process.platform}-${process.arch}`,
  );
}

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
const packageOutput = resolve(
  root,
  "../../packages",
  `native-${process.platform}-${process.arch}`,
  "native",
  "audio",
  "dist",
  `${process.platform}-${process.arch}`,
);
await mkdir(output, { recursive: true });
await mkdir(packageOutput, { recursive: true });
const libraryName = process.platform === "win32" ? "pixi_node_audio.dll" : "libpixi_node_audio.so";
const nativeBinary = resolve(output, "native_audio.node");
await copyFile(resolve(root, "target", "release", libraryName), nativeBinary);
await copyFile(nativeBinary, resolve(packageOutput, "native_audio.node"));
