import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targetArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--target="));
const target = targetArgument
  ? targetArgument.slice("--target=".length)
  : `${process.platform}-${process.arch}`;
if (target !== "win32-x64" && target !== "linux-x64") {
  throw new Error(`Native package staging supports only ${target}.`);
}
const packageRoot = resolve(root, `packages/native-${target}`);
const stagedNativeRoot = resolve(packageRoot, "native");
const temporaryRoot = resolve(root, ".tmp");
const sdlRuntime = target === "win32-x64" ? "SDL3.dll" : "libSDL3.so.0";
const nativeBinaries = [
  `gpu/dist/${target}/pixi_native_gpu.node`,
  `window/dist/${target}/native_window.node`,
  `window/dist/${target}/${sdlRuntime}`,
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
  const binary = await readFile(resolve(stagedNativeRoot, relativePath)).catch(
    (error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    },
  );
  if (!binary) continue;
  if (isNativeBinary(binary)) packagedBinaries.set(relativePath, binary);
}

await mkdir(temporaryRoot, { recursive: true });
const temporaryPackageRoot = await mkdtemp(
  resolve(temporaryRoot, "stage-native-package-"),
);
const temporaryNativeRoot = resolve(temporaryPackageRoot, "native");
try {
  for (const [source, destination] of sources) {
    const sourcePath = resolve(root, source);
    await access(sourcePath);
    const destinationPath = resolve(temporaryPackageRoot, destination);
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { recursive: true });
  }
  for (const relativePath of nativeBinaries) {
    const destinationPath = resolve(temporaryNativeRoot, relativePath);
    const stagedBinary = await readFile(destinationPath);
    if (isNativeBinary(stagedBinary)) continue;
    const packagedBinary = packagedBinaries.get(relativePath);
    if (!packagedBinary) {
      throw new Error(
        `Native artifact is not a ${target} binary: ${relativePath}. Run git lfs pull or rebuild it.`,
      );
    }
    await writeFile(destinationPath, packagedBinary);
  }
  const stagedFingerprint = await fingerprintDirectory(stagedNativeRoot);
  const candidateFingerprint = await fingerprintDirectory(temporaryNativeRoot);
  if (stagedFingerprint !== candidateFingerprint) {
    await syncDirectory(temporaryNativeRoot, stagedNativeRoot);
    const synchronizedFingerprint = await fingerprintDirectory(stagedNativeRoot);
    if (synchronizedFingerprint !== candidateFingerprint) {
      throw new Error(`Could not synchronize the ${target} native package.`);
    }
  }
} finally {
  await rm(temporaryPackageRoot, { recursive: true, force: true });
}
await cp(
  resolve(root, "THIRD_PARTY_NOTICES.md"),
  resolve(packageRoot, "THIRD_PARTY_NOTICES.md"),
);

function isNativeBinary(binary) {
  if (target === "win32-x64") {
    return binary.length >= 2 && binary[0] === 0x4d && binary[1] === 0x5a;
  }
  return (
    binary.length >= 4 &&
    binary[0] === 0x7f &&
    binary[1] === 0x45 &&
    binary[2] === 0x4c &&
    binary[3] === 0x46
  );
}

/** Synchronizes files in place so loaded native package directories need not move. */
async function syncDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  const sourceEntries = await readdir(source, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));
  const destinationEntries = await readdir(destination, { withFileTypes: true });
  for (const entry of destinationEntries) {
    if (!sourceNames.has(entry.name)) {
      await rm(resolve(destination, entry.name), { recursive: true, force: true });
    }
  }
  for (const entry of sourceEntries) {
    const sourcePath = resolve(source, entry.name);
    const destinationPath = resolve(destination, entry.name);
    if (entry.isDirectory()) {
      await syncDirectory(sourcePath, destinationPath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported staged native entry: ${entry.name}`);
    }
    const existing = await readFile(destinationPath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    const candidate = await readFile(sourcePath);
    if (!existing?.equals(candidate)) {
      await writeFile(destinationPath, candidate);
    }
  }
}

/** Hashes a staged tree so an identical, possibly loaded Windows tree is left untouched. */
async function fingerprintDirectory(directory) {
  const hash = createHash("sha256");
  await appendDirectory(directory, "", hash);
  return hash.digest("hex");
}

async function appendDirectory(directory, relativeDirectory, hash) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await appendDirectory(path, relativePath, hash);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported staged native entry: ${relativePath}`);
    }
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
}
