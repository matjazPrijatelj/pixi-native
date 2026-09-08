import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(root, "packages/native-win32-x64");
const stagedNativeRoot = resolve(packageRoot, "native");
const target = "win32-x64";
const nativeBinaries = [
  `gpu/dist/${target}/pixi_native_gpu.node`,
  `window/dist/${target}/native_window.node`,
  `audio/dist/${target}/native_audio.node`,
  `video/dist/${target}/native_video.node`,
];
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

const packagedBinaries = new Map();
for (const relativePath of nativeBinaries) {
  const binary = await readFile(resolve(stagedNativeRoot, relativePath));
  if (isNativeBinary(binary)) packagedBinaries.set(relativePath, binary);
}

await rm(stagedNativeRoot, { recursive: true, force: true });
for (const [source, destination] of sources) {
  const sourcePath = resolve(root, source);
  await access(sourcePath);
  const destinationPath = resolve(packageRoot, destination);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}
for (const relativePath of nativeBinaries) {
  const destinationPath = resolve(stagedNativeRoot, relativePath);
  const stagedBinary = await readFile(destinationPath);
  if (isNativeBinary(stagedBinary)) continue;
  const packagedBinary = packagedBinaries.get(relativePath);
  if (!packagedBinary) {
    throw new Error(
      `Native artifact is not a Windows binary: ${relativePath}. Run git lfs pull or rebuild it.`,
    );
  }
  await writeFile(destinationPath, packagedBinary);
}
await cp(
  resolve(root, "THIRD_PARTY_NOTICES.md"),
  resolve(packageRoot, "THIRD_PARTY_NOTICES.md"),
);

function isNativeBinary(binary) {
  return binary.length >= 2 && binary[0] === 0x4d && binary[1] === 0x5a;
}
