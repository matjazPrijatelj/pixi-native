import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runFfmpegSmokeTests,
  validateFfmpegChecksums,
  validateFfmpegIdentity,
} from "./ffmpeg-distribution.mjs";

const archiveArgument = process.argv[2];
if (!archiveArgument) throw new Error("Expected the packed .tgz path");

const archivePath = resolve(archiveArgument);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = resolve(repositoryRoot, ".tmp");
await mkdir(temporaryRoot, { recursive: true });
const testDirectory = await mkdtemp(
  join(temporaryRoot, "pixi-native-package-"),
);
const toFileSpecifier = (path) =>
  `file:${relative(testDirectory, path).replaceAll("\\", "/")}`;

try {
  const packageJson = {
    name: "pixi-native-package-smoke",
    private: true,
    type: "module",
    packageManager: "pnpm@9.15.9",
    dependencies: {
      "pixi-native": toFileSpecifier(archivePath),
      "pixi.js": "8.20.0",
      typescript: "7.0.2",
    },
  };
  await writeFile(
    join(testDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  await writeFile(
    join(testDirectory, "smoke.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { existsSync } from "node:fs";',
      'import { createRequire } from "node:module";',
      'import { basename, dirname, join } from "node:path";',
      "const entrypoints = [",
      '    "pixi-native/audio",',
      '    "pixi-native/video",',
      '    "pixi-native/files",',
      "];",
      "for (const entrypoint of entrypoints) await import(entrypoint);",
      'for (const removed of ["pixi-native", "pixi-native/webgpu", "pixi-native/webgl", "pixi-native/webgl-pixi7"]) {',
      "    await assert.rejects(import(removed), (error) => error?.code === \"ERR_PACKAGE_PATH_NOT_EXPORTED\");",
      "}",
      'const packageRequire = createRequire(import.meta.resolve("pixi-native/files"));',
      'const nativeGlesDirectory = join(dirname(packageRequire.resolve("native-gles")), "dist");',
      'for (const file of ["gles.node", "libEGL.dll", "libGLESv2.dll"]) {',
      "    assert.equal(existsSync(join(nativeGlesDirectory, file)), true, `Missing ANGLE runtime ${file}`);",
      "}",
      'const { resolveFfmpegPath } = await import("pixi-native/video");',
      "const bundledFfmpeg = resolveFfmpegPath({ environment: {} });",
      'if (process.platform === "win32") {',
      '    assert.equal(basename(bundledFfmpeg), "ffmpeg.exe");',
      "    assert.equal(existsSync(bundledFfmpeg), true);",
      "}",
      "console.log(`Imported ${entrypoints.length} package entrypoints.`);",
      'if (process.platform === "win32") console.log(bundledFfmpeg);',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(testDirectory, "smoke-v7.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { VERSION, VideoSprite, createApp, createRenderer } from "pixi-native/v7";',
      'assert.match(VERSION, /^7\\./);',
      'assert.equal(typeof VideoSprite, "function");',
      'assert.equal(typeof createApp, "function");',
      'assert.equal(typeof createRenderer, "function");',
      'console.log(`Imported Pixi ${VERSION} through pixi-native/v7.`);',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(testDirectory, "smoke-v8.mjs"),
    [
      'import assert from "node:assert/strict";',
      'import { VERSION, VideoSprite, createApp, createRenderer } from "pixi-native/v8";',
      'assert.match(VERSION, /^8\\./);',
      'assert.equal(typeof VideoSprite, "function");',
      'assert.equal(typeof createApp, "function");',
      'assert.equal(typeof createRenderer, "function");',
      'console.log(`Imported Pixi ${VERSION} through pixi-native/v8.`);',
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
      'import { createModuleFileAccess } from "pixi-native/files";',
      "const files = createModuleFileAccess(import.meta.url);",
      'assert.equal(await files.readText("../assets/config.json"), \'{"renderer":"webgpu"}\\n\');',
      'assert.deepEqual(await files.readJson("../assets/config.json"), { renderer: "webgpu" });',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(testDirectory, "smoke.ts"),
    [
      'import { Container as Container7, VideoSprite as VideoSprite7, createApp as createApp7, createRenderer as createRenderer7 } from "pixi-native/v7";',
      'import { Container as Container8, VideoSprite as VideoSprite8, createApp as createApp8, createRenderer as createRenderer8 } from "pixi-native/v8";',
      'import { Howl } from "pixi-native/audio";',
      'import { NativeVideo } from "pixi-native/video";',
      'import { createModuleFileAccess } from "pixi-native/files";',
      "void [Container7, VideoSprite7, createApp7, createRenderer7, Container8, VideoSprite8, createApp8, createRenderer8, Howl, NativeVideo, createModuleFileAccess];",
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

  execSync("pnpm install --no-frozen-lockfile", {
    cwd: testDirectory,
    stdio: "inherit",
  });
  const smokeOutput = execSync("node smoke.mjs", {
    cwd: testDirectory,
    encoding: "utf8",
  });
  process.stdout.write(smokeOutput);
  execSync("node smoke-v7.mjs", { cwd: testDirectory, stdio: "inherit" });
  execSync("node smoke-v8.mjs", { cwd: testDirectory, stdio: "inherit" });
  execSync("node displays/example/dist/file-smoke.mjs", {
    cwd: testDirectory,
    stdio: "inherit",
  });
  if (process.platform === "win32") {
    const bundledFfmpeg = smokeOutput.trimEnd().split(/\r?\n/).at(-1);
    const ffmpegDirectory = dirname(bundledFfmpeg);
    await validateFfmpegChecksums(ffmpegDirectory);
    await validateFfmpegIdentity(ffmpegDirectory, true);
    await runFfmpegSmokeTests(
      ffmpegDirectory,
      resolve(repositoryRoot, "src/demo/assets/Big_Buck_Bunny_1080_30s.mp4"),
      resolve(repositoryRoot, "src/demo/assets/audio/howler-test.wav"),
      resolve(repositoryRoot, "tests/fixtures/hevc-one-frame.mp4"),
    );
  }
  execSync("pnpm exec tsc -p tsconfig.json", {
    cwd: testDirectory,
    stdio: "inherit",
  });
  console.log(`Verified fresh installation of ${basename(archivePath)}.`);
} finally {
  await rm(testDirectory, { recursive: true, force: true });
}
