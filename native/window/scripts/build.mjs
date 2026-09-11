import { copyFile, mkdir, readdir } from "node:fs/promises";
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
const packageWindowRoot = resolve(packageOutput, "../..");
await mkdir(output, { recursive: true });
await mkdir(packageOutput, { recursive: true });
await mkdir(resolve(packageWindowRoot, "src"), { recursive: true });
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
for (const relativePath of [
  "binding-path.js",
  "package.json",
  "src/index.js",
  "src/index.d.ts",
  "src/key-mapping.js",
  "src/lib.rs",
]) {
  await copyFile(resolve(root, relativePath), resolve(packageWindowRoot, relativePath));
}

const releaseDirectory = resolve(root, "target", "release");
const runtimeLibraries = (await readdir(releaseDirectory)).filter((name) =>
  process.platform === "win32"
    ? name === "SDL3.dll"
    : name === "libSDL3.so" || name.startsWith("libSDL3.so."),
);
if (runtimeLibraries.length === 0) {
  throw new Error("SDL3 shared runtime was not produced by the native window build");
}
for (const runtimeLibrary of runtimeLibraries) {
  await copyFile(
    resolve(releaseDirectory, runtimeLibrary),
    resolve(output, runtimeLibrary),
  );
  await copyFile(
    resolve(releaseDirectory, runtimeLibrary),
    resolve(packageOutput, runtimeLibrary),
  );
}
