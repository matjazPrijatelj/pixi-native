import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getFfmpegDistribution } from "./ffmpeg-distribution.mjs";
import {
  FFMPEG_SOURCE_ARCHIVE,
  FFMPEG_SOURCE_REVISION,
} from "./ffmpeg-build-config.mjs";
import { computeSourceFingerprint } from "./release-source-fingerprint.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseVersion = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
).version;
const artifactsDirectory = resolve(root, "artifacts");
const temporaryRoot = resolve(root, ".tmp");
const localNpmCache = resolve(artifactsDirectory, ".npm-cache");
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
const nativeTarget = `${process.platform}-${process.arch}`;
const nativePackageName =
  nativeTarget === "linux-x64"
    ? "native-linux-x64"
    : nativeTarget === "win32-x64"
      ? "native-win32-x64"
      : null;
if (!nativePackageName) {
  throw new Error(`Distribution packing supports only ${nativeTarget}.`);
}
const ffmpegDistribution = getFfmpegDistribution(nativeTarget);
const PACKAGE_NAMES = ["pixi-native", "create-pixi-native", nativePackageName];
const DOCUMENTATION_FILES = [
  "README.md",
  "HISTORY.md",
  "THIRD_PARTY_NOTICES.md",
];

await mkdir(artifactsDirectory, { recursive: true });
await mkdir(temporaryRoot, { recursive: true });
await validateFfmpegSourceArchive();
const sourceArchivePath = resolve(artifactsDirectory, FFMPEG_SOURCE_ARCHIVE);
const sourceChecksum = createHash("sha256")
  .update(await readFile(sourceArchivePath))
  .digest("hex");
await writeFile(
  `${sourceArchivePath}.sha256`,
  `${sourceChecksum}  ${FFMPEG_SOURCE_ARCHIVE}\n`,
);
execSync("pnpm package:prepare", { cwd: root, stdio: "inherit" });

const stageRoot = await mkdtemp(join(temporaryRoot, "pixi-native-pack-"));
const archives = [];
try {
  for (const packageName of PACKAGE_NAMES) {
    const packageRoot = resolve(root, "packages", packageName);
    const stagePackageRoot = resolve(stageRoot, packageName);
    await mkdir(stagePackageRoot, { recursive: true });
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    );
    delete manifest.devDependencies;
    if (packageName === "pixi-native") {
      for (const buildPackageName of ["core", "pixi7", "pixi8"]) {
        await cp(
          resolve(root, "packages", buildPackageName, "dist"),
          resolve(stagePackageRoot, "dist", buildPackageName),
          { recursive: true },
        );
      }
      await rewriteFacadeImports(resolve(stagePackageRoot, "dist"));
      for (const filename of DOCUMENTATION_FILES) {
        await cp(resolve(root, filename), resolve(stagePackageRoot, filename));
      }
      await cp(resolve(root, "docs"), resolve(stagePackageRoot, "docs"), {
        recursive: true,
      });
    } else if (packageName === "create-pixi-native") {
      for (const filename of ["dist", "templates", "README.md"]) {
        await cp(
          resolve(packageRoot, filename),
          resolve(stagePackageRoot, filename),
          { recursive: true },
        );
      }
    } else {
      for (const filename of [
        "index.cjs",
        "index.d.ts",
        "native",
        "THIRD_PARTY_NOTICES.md",
      ]) {
        await cp(
          resolve(packageRoot, filename),
          resolve(stagePackageRoot, filename),
          {
            recursive: true,
          },
        );
      }
      const thirdPartyDirectory = resolve(stagePackageRoot, "third_party");
      await mkdir(thirdPartyDirectory, { recursive: true });
      await cp(
        sourceArchivePath,
        resolve(thirdPartyDirectory, FFMPEG_SOURCE_ARCHIVE),
      );
      await cp(
        `${sourceArchivePath}.sha256`,
        resolve(thirdPartyDirectory, `${FFMPEG_SOURCE_ARCHIVE}.sha256`),
      );
    }
    await cp(resolve(root, "LICENSE"), resolve(stagePackageRoot, "LICENSE"));
    await writeFile(
      resolve(stagePackageRoot, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const [packResult] = JSON.parse(
      execSync("npm pack --ignore-scripts --json", {
        cwd: stagePackageRoot,
        encoding: "utf8",
        env: { ...process.env, npm_config_cache: localNpmCache },
      }),
    );
    if (packResult.unpackedSize > MAX_UNPACKED_BYTES) {
      throw new Error(
        `${manifest.name} is too large: ${packResult.unpackedSize} bytes`,
      );
    }
    validatePackedFiles(
      packageName,
      packResult.files.map((file) => file.path),
    );
    const packedPath = resolve(stagePackageRoot, packResult.filename);
    const archivePath = resolve(artifactsDirectory, packResult.filename);
    await cp(packedPath, archivePath);
    const checksum = createHash("sha256")
      .update(await readFile(archivePath))
      .digest("hex");
    await writeFile(
      `${archivePath}.sha256`,
      `${checksum}  ${packResult.filename}\n`,
    );
    archives.push({
      path: archivePath,
      filename: packResult.filename,
      packageName: manifest.name,
      sha256: checksum,
    });
    console.log(`Created ${archivePath}`);
    console.log(`SHA-256: ${checksum}`);
  }
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}

execFileSync(
  process.execPath,
  [
    resolve(root, "scripts/test-distribution.mjs"),
    ...archives.map((archive) => archive.path),
  ],
  { cwd: root, stdio: "inherit" },
);

// An isolated cross-OS checkout can receive the fingerprint from the source checkout.
const sourceFingerprint =
  process.env.PIXI_NATIVE_SOURCE_FINGERPRINT ?? computeSourceFingerprint(root);
// Platform-neutral packages are published from the Windows manifest. Linux
// still packs and tests them locally, but contributes only its native archive.
const releaseArchives =
  nativeTarget === "linux-x64"
    ? archives.filter((archive) =>
        archive.packageName.startsWith(
          "@matjazprijatelj/pixi-native-linux-",
        ),
      )
    : archives;
await writeFile(
  resolve(artifactsDirectory, `release-manifest-${nativeTarget}.json`),
  `${JSON.stringify(
    {
      version: releaseVersion,
      target: nativeTarget,
      sourceFingerprint,
      archives: releaseArchives.map(({ filename, packageName, sha256 }) => ({
        filename,
        packageName,
        sha256,
      })),
      ffmpegSource: {
        filename: FFMPEG_SOURCE_ARCHIVE,
        sha256: sourceChecksum,
      },
    },
    null,
    2,
  )}\n`,
);
console.log(`FFmpeg source: ${sourceArchivePath}`);
console.log(`FFmpeg source SHA-256: ${sourceChecksum}`);

function validatePackedFiles(packageName, files) {
  const fileSet = new Set(files);
  const required = packageName === "create-pixi-native"
    ? [
        "dist/cli.js",
        "dist/cli.d.ts",
        "dist/generator.js",
        "templates/common/.prettierrc.json",
        "templates/common/gitignore.template",
        "templates/common/npmrc.template",
        "templates/common/package.json.template",
        "templates/common/prettierignore.template",
        "templates/common/README.md",
        "templates/common/tsconfig.build.json",
        "templates/common/tsconfig.json",
        "templates/pixi7/src/main.ts",
        "templates/pixi8/src/main.ts",
        "README.md",
        "LICENSE",
      ]
    : packageName.startsWith("native-")
    ? [
        "index.cjs",
        "index.d.ts",
        `native/gpu/dist/${nativeTarget}/pixi_native_gpu.node`,
        `native/window/dist/${nativeTarget}/native_window.node`,
        ...(nativeTarget === "win32-x64"
          ? [`native/audio/dist/${nativeTarget}/native_audio.node`]
          : []),
        `native/video/dist/${nativeTarget}/native_video.node`,
        ...ffmpegDistribution.packagedFiles.map(
          (filename) => `${ffmpegDistribution.targetDirectory}/${filename}`,
        ),
        `${ffmpegDistribution.targetDirectory}/${ffmpegDistribution.checksumFile}`,
        `third_party/${FFMPEG_SOURCE_ARCHIVE}`,
        `third_party/${FFMPEG_SOURCE_ARCHIVE}.sha256`,
      ]
    : [
        "dist/core/index.js",
        "dist/core/index.d.ts",
        "dist/pixi7/index.js",
        "dist/pixi7/index.d.ts",
        "dist/pixi8/index.js",
        "dist/pixi8/index.d.ts",
        "docs/README.md",
        "docs/getting-started.md",
        "docs/application-and-api.md",
        "docs/media-and-files.md",
        "docs/integrations/gsap.md",
        "docs/deployment.md",
      ];
  const missing = required.filter((filename) => !fileSet.has(filename));
  if (missing.length > 0) {
    throw new Error(
      `${packageName} tarball is missing:\n- ${missing.join("\n- ")}`,
    );
  }
  const forbidden = files.filter((filename) => {
    if (filename.startsWith("src/")) return true;
    if (!filename.endsWith(".ts") || filename.endsWith(".d.ts")) return false;
    return !(
      packageName === "create-pixi-native" &&
      filename.startsWith("templates/")
    );
  });
  if (forbidden.length > 0) {
    throw new Error(
      `${packageName} tarball contains source files:\n- ${forbidden.join("\n- ")}`,
    );
  }
}

async function rewriteFacadeImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteFacadeImports(path);
      continue;
    }
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) {
      continue;
    }
    const source = await readFile(path, "utf8");
    const rewritten = source.replaceAll(
      "@pixi-native/core",
      "@matjazprijatelj/pixi-native/core",
    );
    if (rewritten !== source) await writeFile(path, rewritten);
  }
}

async function validateFfmpegSourceArchive() {
  const sourceArchivePath = resolve(artifactsDirectory, FFMPEG_SOURCE_ARCHIVE);
  await access(sourceArchivePath);
  const sourcePrefix = `ffmpeg-${FFMPEG_SOURCE_REVISION}/`;
  const entries = execFileSync("tar", ["-tf", sourceArchivePath], {
    encoding: "utf8",
  })
    .trimEnd()
    .split(/\r?\n/);
  if (
    entries.some((entry) => !entry.startsWith(sourcePrefix)) ||
    !entries.includes(`${sourcePrefix}configure`) ||
    !entries.includes(`${sourcePrefix}COPYING.LGPLv2.1`) ||
    !entries.includes(`${sourcePrefix}RELEASE`)
  ) {
    throw new Error("FFmpeg source archive has an unexpected structure");
  }
  const release = execFileSync(
    "tar",
    ["-xOf", sourceArchivePath, `${sourcePrefix}RELEASE`],
    { encoding: "utf8" },
  ).trim();
  if (release !== "8.0") {
    throw new Error(`FFmpeg source archive has unexpected release ${release}`);
  }
}
