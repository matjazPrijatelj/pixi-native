import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeSourceFingerprint } from "./release-source-fingerprint.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = resolve(repositoryRoot, "packages/create-pixi-native");
const artifactsDirectory = resolve(repositoryRoot, "artifacts");
const localNpmCache = resolve(artifactsDirectory, ".npm-cache");
const manifest = JSON.parse(
  await readFile(resolve(packageRoot, "package.json"), "utf8"),
);
const expectedFiles = new Set([
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
]);

if (process.versions.node.split(".")[0] !== "24") {
  throw new Error("Generator packing requires Node.js 24 LTS.");
}
if (manifest.version !== "0.1.0") {
  throw new Error("The generator package version must be 0.1.0.");
}

execSync("pnpm typecheck", { cwd: repositoryRoot, stdio: "inherit" });
execFileSync(
  process.execPath,
  [
    "--test",
    "tests/create-pixi-native.test.ts",
    "tests/release-packages.test.ts",
  ],
  { cwd: repositoryRoot, stdio: "inherit" },
);
const tsc = resolve(repositoryRoot, "node_modules/typescript/bin/tsc");
for (const buildPackage of ["core", "pixi7", "pixi8", "create-pixi-native"]) {
  const buildRoot = resolve(repositoryRoot, "packages", buildPackage);
  await rm(resolve(buildRoot, "dist"), { recursive: true, force: true });
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
    cwd: buildRoot,
    stdio: "inherit",
  });
}

await mkdir(artifactsDirectory, { recursive: true });
const stageRoot = await mkdtemp(join(tmpdir(), "create-pixi-native-pack-"));
const consumerRoot = await mkdtemp(
  join(tmpdir(), "create-pixi-native-consumer-"),
);
const facadeStageRoot = await mkdtemp(join(tmpdir(), "pixi-native-facade-"));
try {
  for (const filename of ["dist", "templates", "README.md"]) {
    await cp(resolve(packageRoot, filename), resolve(stageRoot, filename), {
      recursive: true,
    });
  }
  await cp(resolve(repositoryRoot, "LICENSE"), resolve(stageRoot, "LICENSE"));
  await writeFile(
    resolve(stageRoot, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const [packResult] = JSON.parse(
    execSync("npm pack --ignore-scripts --json", {
      cwd: stageRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: localNpmCache },
    }),
  );
  const files = new Set(packResult.files.map((file) => file.path));
  const missingFiles = [...expectedFiles].filter(
    (filename) => !files.has(filename),
  );
  if (missingFiles.length > 0) {
    throw new Error(
      `Generator archive is missing:\n- ${missingFiles.join("\n- ")}`,
    );
  }
  const archivePath = resolve(artifactsDirectory, packResult.filename);
  await cp(resolve(stageRoot, packResult.filename), archivePath);
  const archiveBytes = await readFile(archivePath);
  const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
  await writeFile(
    `${archivePath}.sha256`,
    `${sha256}  ${packResult.filename}\n`,
  );

  await writeFile(
    resolve(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "create-pixi-native-archive-smoke",
        private: true,
        dependencies: {
          "@matjazprijatelj/create-pixi-native": `file:${archivePath.replaceAll("\\", "/")}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  execSync(
    `pnpm install ${process.env.PIXI_NATIVE_OFFLINE === "1" ? "--offline " : ""}--no-frozen-lockfile --ignore-workspace`,
    { cwd: consumerRoot, stdio: "inherit" },
  );
  const cliPath = resolve(
    consumerRoot,
    "node_modules/@matjazprijatelj/create-pixi-native/dist/cli.js",
  );
  const packedVersion = execFileSync(process.execPath, [cliPath, "--version"], {
    encoding: "utf8",
  }).trim();
  if (packedVersion !== manifest.version) {
    throw new Error(`Packed generator reports version ${packedVersion}.`);
  }

  const facadeManifest = JSON.parse(
    await readFile(
      resolve(repositoryRoot, "packages/pixi-native/package.json"),
      "utf8",
    ),
  );
  delete facadeManifest.devDependencies;
  for (const buildPackage of ["core", "pixi7", "pixi8"]) {
    await cp(
      resolve(repositoryRoot, "packages", buildPackage, "dist"),
      resolve(facadeStageRoot, "dist", buildPackage),
      { recursive: true },
    );
  }
  await rewriteFacadeImports(resolve(facadeStageRoot, "dist"));
  await cp(
    resolve(repositoryRoot, "LICENSE"),
    resolve(facadeStageRoot, "LICENSE"),
  );
  await writeFile(
    resolve(facadeStageRoot, "package.json"),
    `${JSON.stringify(facadeManifest, null, 2)}\n`,
  );
  const [facadePackResult] = JSON.parse(
    execSync("npm pack --ignore-scripts --json", {
      cwd: facadeStageRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: localNpmCache },
    }),
  );
  const facadeArchive = resolve(facadeStageRoot, facadePackResult.filename);
  const nativeOverrides = {};
  for (const target of ["win32-x64", "linux-x64"]) {
    const stubRoot = resolve(consumerRoot, `native-${target}-stub`);
    await mkdir(stubRoot, { recursive: true });
    const packageName = `@matjazprijatelj/pixi-native-${target}`;
    await writeFile(
      resolve(stubRoot, "package.json"),
      `${JSON.stringify(
        {
          name: packageName,
          version: "0.1.1",
          os: [target.split("-")[0]],
          cpu: ["x64"],
        },
        null,
        2,
      )}\n`,
    );
    nativeOverrides[packageName] = `file:${stubRoot.replaceAll("\\", "/")}`;
  }
  for (const [directory, pixi, expectedDependency] of [
    ["pixi7-app", "7", "pixi.js-v7"],
    ["pixi8-app", "8", "pixi.js"],
  ]) {
    const arguments_ = [cliPath, directory, "--pixi", pixi];
    if (pixi === "8") arguments_.push("--backend", "webgpu");
    execFileSync(process.execPath, arguments_, {
      cwd: consumerRoot,
      stdio: "inherit",
    });
    const generatedManifest = JSON.parse(
      await readFile(resolve(consumerRoot, directory, "package.json"), "utf8"),
    );
    const pixiDependencies = Object.keys(generatedManifest.dependencies).filter(
      (name) => name.startsWith("pixi.js"),
    );
    if (
      generatedManifest.dependencies["@matjazprijatelj/pixi-native"] !==
        "0.1.1" ||
      pixiDependencies.length !== 1 ||
      pixiDependencies[0] !== expectedDependency
    ) {
      throw new Error(`${directory} has invalid generated dependencies.`);
    }
    generatedManifest.pnpm = {
      overrides: {
        "@matjazprijatelj/pixi-native": `file:${facadeArchive.replaceAll("\\", "/")}`,
        ...nativeOverrides,
      },
    };
    const projectRoot = resolve(consumerRoot, directory);
    await writeFile(
      resolve(projectRoot, "package.json"),
      `${JSON.stringify(generatedManifest, null, 2)}\n`,
    );
    const offline = process.env.PIXI_NATIVE_OFFLINE === "1" ? "--offline " : "";
    execSync(`pnpm install ${offline}--no-frozen-lockfile --ignore-workspace`, {
      cwd: projectRoot,
      stdio: "inherit",
    });
    const oppositeDependency =
      expectedDependency === "pixi.js" ? "pixi.js-v7" : "pixi.js";
    await readFile(
      resolve(projectRoot, "node_modules", expectedDependency, "package.json"),
    );
    await assertPathMissing(
      resolve(projectRoot, "node_modules", oppositeDependency, "package.json"),
    );
    execSync("pnpm typecheck", { cwd: projectRoot, stdio: "inherit" });
    execSync("pnpm build", { cwd: projectRoot, stdio: "inherit" });
    await readFile(resolve(projectRoot, "dist/main.js"));
  }

  await writeFile(
    resolve(artifactsDirectory, "release-manifest-create-pixi-native.json"),
    `${JSON.stringify(
      {
        version: manifest.version,
        sourceFingerprint: computeSourceFingerprint(repositoryRoot),
        archive: {
          filename: packResult.filename,
          packageName: manifest.name,
          sha256,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Created ${archivePath}`);
  console.log(`SHA-256: ${sha256}`);
} finally {
  await rm(stageRoot, { recursive: true, force: true });
  await rm(consumerRoot, { recursive: true, force: true });
  await rm(facadeStageRoot, { recursive: true, force: true });
}

async function rewriteFacadeImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteFacadeImports(path);
      continue;
    }
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) continue;
    const source = await readFile(path, "utf8");
    const rewritten = source.replaceAll(
      "@pixi-native/core",
      "@matjazprijatelj/pixi-native/core",
    );
    if (source !== rewritten) await writeFile(path, rewritten);
  }
}

async function assertPathMissing(path) {
  try {
    await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Unexpected generated dependency at ${path}.`);
}
