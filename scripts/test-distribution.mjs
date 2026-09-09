import { execFileSync, execSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runFfmpegSmokeTests,
  validateFfmpegChecksums,
  validateFfmpegIdentity,
  getFfmpegDistribution,
} from "./ffmpeg-distribution.mjs";

const archiveArguments = process.argv.slice(2);
const installCommand = [
  "pnpm install",
  process.env.PIXI_NATIVE_OFFLINE === "1" ? "--offline" : "",
  "--no-frozen-lockfile --ignore-workspace",
]
  .filter(Boolean)
  .join(" ");
if (archiveArguments.length !== 2) {
  throw new Error("Expected the facade and one native package archive");
}

const archives = new Map(
  archiveArguments.map((argument) => {
    const path = resolve(argument);
    const filename = basename(path);
    const key =
      filename.includes("native-win32-x64") ||
      filename.includes("native-linux-x64")
        ? "native"
        : "facade";
    return [key, path];
  }),
);
for (const key of ["facade", "native"]) {
  if (!archives.has(key)) throw new Error(`Missing ${key} archive`);
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeArchiveName = basename(archives.get("native"));
const nativePackageName = nativeArchiveName.includes("native-linux-x64")
  ? "@matjazprijatelj/pixi-native-linux-x64"
  : "@matjazprijatelj/pixi-native-win32-x64";
const nativeTarget = nativePackageName.includes("linux")
  ? "linux-x64"
  : "win32-x64";
const oppositeNativePackageName =
  nativeTarget === "linux-x64"
    ? "@matjazprijatelj/pixi-native-win32-x64"
    : "@matjazprijatelj/pixi-native-linux-x64";
const oppositeNativeTarget =
  nativeTarget === "linux-x64" ? "win32-x64" : "linux-x64";
const ffmpegDistribution = getFfmpegDistribution(nativeTarget);
const testDirectory = await mkdtemp(join(tmpdir(), "pn-"));
const generatedRoot = await mkdtemp(join(tmpdir(), "pixi-native-generated-"));
const localFacadeArchive = join(testDirectory, "p.tgz");
const localNativeArchive = join(testDirectory, "n.tgz");
await cp(archives.get("facade"), localFacadeArchive);
await cp(archives.get("native"), localNativeArchive);
const toFileSpecifier = (path) =>
  `file:${relative(testDirectory, path).replaceAll("\\", "/")}`;

try {
  const oppositeNativeStub = join(testDirectory, "opposite-native-stub");
  await mkdir(oppositeNativeStub, { recursive: true });
  await writeFile(
    join(oppositeNativeStub, "package.json"),
    `${JSON.stringify(
      {
        name: oppositeNativePackageName,
        version: "0.1.1",
        os: [oppositeNativeTarget.split("-")[0]],
        cpu: ["x64"],
      },
      null,
      2,
    )}\n`,
  );
  const packageJson = {
    name: "pixi-native-launcher-smoke",
    private: true,
    type: "module",
    packageManager: "pnpm@9.15.9",
    dependencies: {
      "@matjazprijatelj/pixi-native": toFileSpecifier(localFacadeArchive),
      "pixi.js": "8.20.0",
      "pixi.js-v7": "npm:pixi.js@7.4.3",
      [nativePackageName]: toFileSpecifier(localNativeArchive),
    },
    pnpm: {
      overrides: {
        [nativePackageName]: toFileSpecifier(localNativeArchive),
        [oppositeNativePackageName]: "file:./opposite-native-stub",
      },
    },
  };
  await writeFile(
    join(testDirectory, "package.json"),
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );

  await writeFile(
    join(testDirectory, "smoke-root.mjs"),
    createRuntimeSmoke("@matjazprijatelj/pixi-native", 8),
  );
  await writeFile(
    join(testDirectory, "smoke-v7.mjs"),
    createRuntimeSmoke("@matjazprijatelj/pixi-native/pixi7", 7),
  );
  await writeFile(
    join(testDirectory, "smoke-v8.mjs"),
    createRuntimeSmoke("@matjazprijatelj/pixi-native/pixi8", 8),
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
      'const entryPath = fileURLToPath(import.meta.resolve("@matjazprijatelj/pixi-native"));',
      'const packageRoot = resolve(dirname(entryPath), "../..");',
      'for (const documentationPath of ["docs/README.md", "docs/getting-started.md", "docs/application-and-api.md", "docs/media-and-files.md", "docs/integrations/gsap.md", "docs/deployment.md"]) {',
      "  assert.equal(existsSync(resolve(packageRoot, documentationPath)), true, documentationPath);",
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
      'import { createModuleFileAccess } from "@matjazprijatelj/pixi-native/pixi8/files";',
      "const files = createModuleFileAccess(import.meta.url);",
      'assert.equal(await files.readText("../assets/config.json"), \'{"renderer":"webgpu"}\\n\');',
      "",
    ].join("\n"),
  );
  await writeFile(
    join(testDirectory, "smoke.ts"),
    [
      'import { Container as ContainerRoot, createApp as createAppRoot } from "@matjazprijatelj/pixi-native";',
      'import { Container as Container7, NativeVideo as NativeVideo7, VideoSprite as VideoSprite7, createApp as createApp7, createRenderer as createRenderer7, type VideoSpriteOptions } from "@matjazprijatelj/pixi-native/pixi7";',
      'import { Container as Container8, NativeVideo as NativeVideo8, VideoSprite as VideoSprite8, createApp as createApp8, createRenderer as createRenderer8 } from "@matjazprijatelj/pixi-native/pixi8";',
      'import { Howl } from "@matjazprijatelj/pixi-native/pixi8/audio";',
      'import { createModuleFileAccess } from "@matjazprijatelj/pixi-native/pixi8/files";',
      'import { FrameScheduler } from "@matjazprijatelj/pixi-native/pixi8/runtime";',
      'import { NodeCanvas } from "@matjazprijatelj/pixi-native/pixi8/canvas";',
      'import { NativeVideo } from "@matjazprijatelj/pixi-native/core";',
      "const options: VideoSpriteOptions = {};",
      "void [ContainerRoot, createAppRoot, Container7, NativeVideo7, VideoSprite7, createApp7, createRenderer7, Container8, NativeVideo8, VideoSprite8, createApp8, createRenderer8, Howl, createModuleFileAccess, FrameScheduler, NodeCanvas, NativeVideo, options];",
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

  execSync(`${installCommand} --prod`, {
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
  for (const project of [
    {
      directory: "generated-v7",
      pixiPackage: "pixi.js-v7",
      arguments: ["--pixi", "7"],
    },
    {
      directory: "generated-v8",
      pixiPackage: "pixi.js",
      arguments: ["--pixi", "8", "--backend", "webgpu"],
    },
  ]) {
    execFileSync(
      process.execPath,
      [
        resolve(repositoryRoot, "packages/create-pixi-native/src/cli.ts"),
        project.directory,
        ...project.arguments,
      ],
      { cwd: generatedRoot, stdio: "inherit" },
    );
    const projectDirectory = resolve(generatedRoot, project.directory);
    const manifestPath = resolve(projectDirectory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const pixiDependencies = Object.keys(manifest.dependencies).filter((name) =>
      name.startsWith("pixi.js"),
    );
    if (
      manifest.dependencies["@matjazprijatelj/pixi-native"] !== "0.1.1" ||
      pixiDependencies.length !== 1 ||
      pixiDependencies[0] !== project.pixiPackage
    ) {
      throw new Error(`${project.directory} has invalid runtime dependencies`);
    }
    manifest.pnpm = {
      overrides: {
        "@matjazprijatelj/pixi-native": `file:${localFacadeArchive.replaceAll("\\", "/")}`,
        [nativePackageName]: `file:${localNativeArchive.replaceAll("\\", "/")}`,
        [oppositeNativePackageName]: `file:${oppositeNativeStub.replaceAll("\\", "/")}`,
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    execSync(installCommand, { cwd: projectDirectory, stdio: "inherit" });
    execSync("pnpm typecheck", { cwd: projectDirectory, stdio: "inherit" });
    execSync("pnpm build", { cwd: projectDirectory, stdio: "inherit" });
    await access(resolve(projectDirectory, "dist", "main.js"));
  }
  execSync("node smoke-root.mjs", { cwd: testDirectory, stdio: "inherit" });
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

  execSync(
    `${JSON.stringify(process.execPath)} ${JSON.stringify(
      resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
    )} -p tsconfig.json`,
    {
      cwd: testDirectory,
      stdio: "inherit",
    },
  );
  console.log("Verified the facade package with both Pixi majors.");
} finally {
  await rm(testDirectory, { recursive: true, force: true });
  await rm(generatedRoot, { recursive: true, force: true });
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
