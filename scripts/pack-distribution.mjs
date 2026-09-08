import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FFMPEG_CHECKSUM_FILE,
  FFMPEG_PACKAGED_FILES,
  FFMPEG_TARGET_DIRECTORY,
  getFfmpegDistribution,
} from "./ffmpeg-distribution.mjs";
import {
  FFMPEG_SOURCE_ARCHIVE,
  FFMPEG_SOURCE_REVISION,
} from "./ffmpeg-build-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
const PACKAGE_NAMES = ["core", "pixi7", "pixi8", nativePackageName];
const DOCUMENTATION_FILES = [
  "README.md",
  "HISTORY.md",
  "THIRD_PARTY_NOTICES.md",
];

const publishedExports = {
  core: {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./audio": {
      types: "./dist/audio/index.d.ts",
      default: "./dist/audio/index.js",
    },
    "./files": { types: "./dist/files.d.ts", default: "./dist/files.js" },
    "./runtime": {
      types: "./dist/runtime.d.ts",
      default: "./dist/runtime.js",
    },
    "./canvas": {
      types: "./dist/canvas.d.ts",
      default: "./dist/canvas.js",
    },
    "./application/*.js": {
      types: "./dist/application/*.d.ts",
      default: "./dist/application/*.js",
    },
    "./audio/*.js": {
      types: "./dist/audio/*.d.ts",
      default: "./dist/audio/*.js",
    },
    "./canvas/*.js": {
      types: "./dist/canvas/*.d.ts",
      default: "./dist/canvas/*.js",
    },
    "./renderers/*.js": {
      types: "./dist/renderers/*.d.ts",
      default: "./dist/renderers/*.js",
    },
    "./runtime/*.js": {
      types: "./dist/runtime/*.d.ts",
      default: "./dist/runtime/*.js",
    },
    "./video/*.js": {
      types: "./dist/video/*.d.ts",
      default: "./dist/video/*.js",
    },
  },
  pixi7: createVersionExports(),
  pixi8: createVersionExports(),
};

function createVersionExports() {
  return {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./audio": { types: "./dist/audio.d.ts", default: "./dist/audio.js" },
    "./files": { types: "./dist/files.d.ts", default: "./dist/files.js" },
    "./runtime": {
      types: "./dist/runtime.d.ts",
      default: "./dist/runtime.js",
    },
    "./canvas": { types: "./dist/canvas.d.ts", default: "./dist/canvas.js" },
  };
}

await mkdir(artifactsDirectory, { recursive: true });
await mkdir(temporaryRoot, { recursive: true });
await validateFfmpegSourceArchive();
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
    if (publishedExports[packageName]) {
      manifest.exports = publishedExports[packageName];
      await cp(
        resolve(packageRoot, "dist"),
        resolve(stagePackageRoot, "dist"),
        {
          recursive: true,
        },
      );
      for (const filename of DOCUMENTATION_FILES) {
        await cp(resolve(root, filename), resolve(stagePackageRoot, filename));
      }
      await cp(resolve(root, "docs"), resolve(stagePackageRoot, "docs"), {
        recursive: true,
      });
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
    }
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
    archives.push(archivePath);
    console.log(`Created ${archivePath}`);
    console.log(`SHA-256: ${checksum}`);
  }
} finally {
  await rm(stageRoot, { recursive: true, force: true });
}

execFileSync(
  process.execPath,
  [resolve(root, "scripts/test-distribution.mjs"), ...archives],
  { cwd: root, stdio: "inherit" },
);

const sourceArchivePath = resolve(artifactsDirectory, FFMPEG_SOURCE_ARCHIVE);
const sourceChecksum = createHash("sha256")
  .update(await readFile(sourceArchivePath))
  .digest("hex");
await writeFile(
  `${sourceArchivePath}.sha256`,
  `${sourceChecksum}  ${FFMPEG_SOURCE_ARCHIVE}\n`,
);
console.log(`FFmpeg source: ${sourceArchivePath}`);
console.log(`FFmpeg source SHA-256: ${sourceChecksum}`);

function validatePackedFiles(packageName, files) {
  const fileSet = new Set(files);
  const required =
    packageName.startsWith("native-")
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
        ]
      : [
          "dist/index.js",
          "dist/index.d.ts",
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
  const forbidden = files.filter(
    (filename) =>
      filename.startsWith("src/") ||
      (filename.endsWith(".ts") && !filename.endsWith(".d.ts")),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `${packageName} tarball contains source files:\n- ${forbidden.join("\n- ")}`,
    );
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
