import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "packages/native-win32-x64");
const stagedNativeRoot = resolve(packageRoot, "native");
const target = "win32-x64";
const sources = [
  ["native/gpu/package.json", "native/gpu/package.json"],
  ["native/gpu/src", "native/gpu/src"],
  [`native/gpu/dist/${target}`, `native/gpu/dist/${target}`],
  ["native/window/package.json", "native/window/package.json"],
  ["native/window/binding-path.js", "native/window/binding-path.js"],
  ["native/window/src", "native/window/src"],
  [`native/window/dist/${target}`, `native/window/dist/${target}`],
  ["native/audio/package.json", "native/audio/package.json"],
  ["native/audio/binding-path.js", "native/audio/binding-path.js"],
  ["native/audio/src", "native/audio/src"],
  [`native/audio/dist/${target}`, `native/audio/dist/${target}`],
  ["native/video/package.json", "native/video/package.json"],
  ["native/video/src", "native/video/src"],
  [`native/video/dist/${target}`, `native/video/dist/${target}`],
];

await rm(stagedNativeRoot, { recursive: true, force: true });
for (const [source, destination] of sources) {
  const sourcePath = resolve(root, source);
  await access(sourcePath);
  const destinationPath = resolve(packageRoot, destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}
await cp(
  resolve(root, "THIRD_PARTY_NOTICES.md"),
  resolve(packageRoot, "THIRD_PARTY_NOTICES.md"),
);
