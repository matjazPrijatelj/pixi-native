import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runFfmpegSmokeTests,
  validateFfmpegChecksums,
  validateFfmpegIdentity,
  getFfmpegDistribution,
} from "./ffmpeg-distribution.mjs";

const archiveArguments = process.argv.slice(2);
if (archiveArguments.length !== 4) {
  throw new Error(
    "Expected core, pixi7, pixi8, and one native package archive",
  );
}

const archives = new Map(
  archiveArguments.map((argument) => {
    const path = resolve(argument);
    const filename = basename(path);
    const key =
      filename.includes("native-win32-x64") ||
      filename.includes("native-linux-x64")
        ? "native"
        : filename.includes("pixi7")
          ? "pixi7"
          : filename.includes("pixi8")
            ? "pixi8"
            : "core";
    return [key, path];
  }),
);
for (const key of ["core", "pixi7", "pixi8", "native"]) {
  if (!archives.has(key)) throw new Error(`Missing ${key} archive`);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeArchiveName = basename(archives.get("native"));
const nativePackageName = nativeArchiveName.includes("native-linux-x64")
  ? "@pixi-native/native-linux-x64"
  : "@pixi-native/native-win32-x64";
const nativeTarget = nativePackageName.includes("linux")
  ? "linux-x64"
  : "win32-x64";
const ffmpegDistribution = getFfmpegDistribution(nativeTarget);
const temporaryRoot = resolve(repositoryRoot, ".tmp");
await mkdir(temporaryRoot, { recursive: true });
const testDirectory = await mkdtemp(
  join(temporaryRoot, "pixi-native-packages-"),
);
const toFileSpecifier = (path) =>
  `file:${relative(testDirectory, path).replaceAll("\\", "/")}`;

try {
  const packageJson = {
    name: "pixi-native-launcher-smoke",
    private: true,
    type: "module",
    packageManager: "pnpm@9.15.9",
    dependencies: {
      "@pixi-native/core": toFileSpecifier(archives.get("core")),
      "@pixi-native/pixi7": toFileSpecifier(archives.get("pixi7")),
      "@pixi-native/pixi8": toFileSpecifier(archives.get("pixi8")),
      [nativePackageName]: toFileSpecifier(archives.get("native")),
    },
    devDependencies: { typescript: "7.0.2" },
  };
  await writeFile(
    join(testDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );

  await writeFile(
    join(testDirectory, "smoke-v7.mjs"),
    createRuntimeSmoke("@pixi-native/pixi7", 7),
  );
  await writeFile(
    join(testDirectory, "smoke-v8.mjs"),
    createRuntimeSmoke("@pixi-native/pixi8", 8),
  );
  await writeFile(
    join(testDirectory, "smoke-native.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { existsSync } from "node:fs";',
      `import native from "${nativePackageName}";`,
      `assert.equal(native.target, "${nativeTarget}");`,
      "for (const path of [native.gpuModule, native.windowModule, native.videoModule, native.audioBinding, native.ffmpeg, native.ffprobe].filter(Boolean)) assert.equal(existsSync(path), true, path);",
      "console.log(native.ffmpeg);",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(testDirectory, "smoke-optional-gsap-and-docs.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { existsSync } from "node:fs";',
      'import { dirname, resolve } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      'for (const packageName of ["@pixi-native/core", "@pixi-native/pixi7", "@pixi-native/pixi8"]) {',
      "  const entryPath = fileURLToPath(import.meta.resolve(packageName));",
      '  const packageRoot = resolve(dirname(entryPath), "..");',
      '  for (const documentationPath of ["docs/README.md", "docs/getting-started.md", "docs/application-and-api.md", "docs/media-and-files.md", "docs/integrations/gsap.md", "docs/deployment.md"]) {',
      "    assert.equal(existsSync(resolve(packageRoot, documentationPath)), true, `${packageName}/${documentationPath}`);",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  const displayDirectory = join(testDirectory, "displays", "example");
  await mkdir(join(displayDirectory, "dist"), { recursive: true });
  await mkdir(join(displayDirectory, "assets"), { recursive: true });
  await writeFile(
    join(displayDirectory, "assets", "config.json"),
    '{"renderer":"webgpu"}\n',
  );
  await writeFile(
    join(displayDirectory, "dist", "file-smoke.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { createModuleFileAccess } from "@pixi-native/pixi8/files";',
      "const files = createModuleFileAccess(import.meta.url);",
      'assert.equal(await files.readText("../assets/config.json"), \'{"renderer":"webgpu"}\\n\');',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(testDirectory, "smoke.ts"),
    [
      'import { Container as Container7, NativeVideo as NativeVideo7, VideoSprite as VideoSprite7, createApp as createApp7, createRenderer as createRenderer7, type VideoSpriteOptions } from "@pixi-native/pixi7";',
      'import { Container as Container8, NativeVideo as NativeVideo8, VideoSprite as VideoSprite8, createApp as createApp8, createRenderer as createRenderer8 } from "@pixi-native/pixi8";',
      'import { Howl } from "@pixi-native/pixi8/audio";',
      'import { createModuleFileAccess } from "@pixi-native/pixi8/files";',
      'import { FrameScheduler } from "@pixi-native/pixi8/runtime";',
      'import { NodeCanvas } from "@pixi-native/pixi8/canvas";',
      "const options: VideoSpriteOptions = {};",
      "void [Container7, NativeVideo7, VideoSprite7, createApp7, createRenderer7, Container8, NativeVideo8, VideoSprite8, createApp8, createRenderer8, Howl, createModuleFileAccess, FrameScheduler, NodeCanvas, options];",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(testDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          target: "ES2022",
        },
        files: ["smoke.ts"],
      },
      null,
      2,
    )}\n`,
  );

  execSync("pnpm install --prod --no-frozen-lockfile --ignore-workspace", {
    cwd: testDirectory,
    stdio: "inherit",
  });
  const productionGraph = JSON.parse(
    execSync("pnpm list gsap --prod --depth Infinity --json", {
      cwd: testDirectory,
      encoding: "utf8",
    }),
  );
  if (containsPackage(productionGraph, "gsap")) {
    throw new Error("GSAP must not be installed in the production fixture");
  }
  execSync("node smoke-v7.mjs", { cwd: testDirectory, stdio: "inherit" });
  execSync("node smoke-v8.mjs", { cwd: testDirectory, stdio: "inherit" });
  const nativeOutput = execSync("node smoke-native.mjs", {
    cwd: testDirectory,
    encoding: "utf8",
  });
  process.stdout.write(nativeOutput);
  execSync("node displays/example/dist/file-smoke.mjs", {
    cwd: testDirectory,
    stdio: "inherit",
  });
  execSync("node smoke-optional-gsap-and-docs.mjs", {
    cwd: testDirectory,
    stdio: "inherit",
  });

  const ffmpegPath = nativeOutput.trimEnd().split(/\r?\n/).at(-1);
  const ffmpegDirectory = dirname(ffmpegPath);
  await validateFfmpegChecksums(
    ffmpegDirectory,
    ffmpegDistribution.packagedFiles,
    ffmpegDistribution.checksumFile,
  );
  await validateFfmpegIdentity(ffmpegDirectory, true, ffmpegDistribution);
  await runFfmpegSmokeTests(
    ffmpegDirectory,
    resolve(repositoryRoot, "src/demo/assets/Sync_Check-720p30fps.mp4"),
    resolve(repositoryRoot, "src/demo/assets/audio/howler-test.wav"),
    resolve(repositoryRoot, "tests/fixtures/hevc-one-frame.mp4"),
    ffmpegDistribution,
  );

  execSync("pnpm install --no-frozen-lockfile --ignore-workspace", {
    cwd: testDirectory,
    stdio: "inherit",
  });
  execSync("pnpm exec tsc -p tsconfig.json", {
    cwd: testDirectory,
    stdio: "inherit",
  });
  console.log("Verified fresh launcher installation with both Pixi majors.");
} finally {
  await rm(testDirectory, { recursive: true, force: true });
}

function createRuntimeSmoke(packageName, major) {
  return [
    'import assert from "node:assert/strict";',
    `import { VERSION, NativeVideo, VideoFpsMeter, VideoSprite, createApp, createRenderer } from "${packageName}";`,
    `assert.match(VERSION, /^${major}\\./);`,
    'for (const value of [NativeVideo, VideoFpsMeter, VideoSprite, createApp, createRenderer]) assert.equal(typeof value, "function");',
    `console.log("Imported ${packageName} with Pixi " + VERSION);`,
    "",
  ].join("\n");
}

function containsPackage(value, packageName) {
  if (Array.isArray(value)) {
    return value.some((entry) => containsPackage(entry, packageName));
  }
  if (!value || typeof value !== "object") return false;
  if (value.name === packageName) return true;
  return Object.entries(value).some(
    ([key, entry]) =>
      key === packageName || containsPackage(entry, packageName),
  );
}
