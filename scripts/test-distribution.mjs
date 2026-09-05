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
      "pixi.js": toFileSpecifier(
        resolve(repositoryRoot, "node_modules/pixi.js"),
      ),
      typescript: toFileSpecifier(
        resolve(repositoryRoot, "node_modules/typescript"),
      ),
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
      '    "pixi-native",',
      '    "pixi-native/webgpu",',
      '    "pixi-native/webgl",',
      '    "pixi-native/webgl-pixi7",',
      '    "pixi-native/audio",',
      '    "pixi-native/video",',
      "];",
      "for (const entrypoint of entrypoints) await import(entrypoint);",
      'const packageRequire = createRequire(import.meta.resolve("pixi-native"));',
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
    join(testDirectory, "smoke.ts"),
    [
      'import { createPixiRenderer } from "pixi-native";',
      'import { createPixiWebGPU } from "pixi-native/webgpu";',
      'import { createPixiWebGL } from "pixi-native/webgl";',
      'import { createPixiWebGL7 } from "pixi-native/webgl-pixi7";',
      'import { Howl } from "pixi-native/audio";',
      'import { NativeVideo } from "pixi-native/video";',
      "void [createPixiRenderer, createPixiWebGPU, createPixiWebGL, createPixiWebGL7, Howl, NativeVideo];",
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
  if (process.platform === "win32") {
    const bundledFfmpeg = smokeOutput.trimEnd().split(/\r?\n/).at(-1);
    const ffmpegDirectory = dirname(bundledFfmpeg);
    await validateFfmpegChecksums(ffmpegDirectory);
    await validateFfmpegIdentity(ffmpegDirectory, true);
    await runFfmpegSmokeTests(
      ffmpegDirectory,
      resolve(repositoryRoot, "src/demo/assets/Big_Buck_Bunny_1080_30s.mp4"),
      resolve(repositoryRoot, "src/demo/assets/audio/howler-test.wav"),
      resolve(repositoryRoot, "src/demo/tests/fixtures/hevc-one-frame.mp4"),
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
