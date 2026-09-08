import { copyFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error(
    `Native audio builds support only Windows x64, not ${process.platform}-${process.arch}`,
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
await mkdir(output, { recursive: true });
await copyFile(
  resolve(root, "target", "release", "pixi_node_audio.dll"),
  resolve(output, "native_audio.node"),
);
