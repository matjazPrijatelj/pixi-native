import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeSourceFingerprint } from "./release-source-fingerprint.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS_DIRECTORY = resolve(REPOSITORY_ROOT, "artifacts");
const REGISTRY = "https://registry.npmjs.org";
const commandArguments = process.argv.slice(2);
const generatorMode = commandArguments.includes("--generator");
const win32Only = commandArguments.includes("--win32-only");
if (generatorMode && win32Only) {
  throw new Error(
    "Generator and Win32-only publication modes cannot be combined.",
  );
}
const runtimeVersion = JSON.parse(
  await readFile(resolve(REPOSITORY_ROOT, "package.json"), "utf8"),
).version;
const generatorVersion = JSON.parse(
  await readFile(
    resolve(REPOSITORY_ROOT, "packages/create-pixi-native/package.json"),
    "utf8",
  ),
).version;
const releaseConfiguration = getReleaseConfiguration(
  generatorMode,
  runtimeVersion,
  generatorVersion,
  win32Only,
);
const VERSION = releaseConfiguration.version;
const TAG = releaseConfiguration.tag;
const EXPECTED_PACKAGES = releaseConfiguration.expectedPackages;
const MANIFEST_TARGETS = releaseConfiguration.manifestTargets;
const NPM_INVOCATION = getNpmInvocation();

export function getReleaseConfiguration(
  useGenerator,
  runtimePackageVersion,
  generatorPackageVersion,
  useWin32Only = false,
) {
  return useGenerator
    ? {
        version: generatorPackageVersion,
        tag: `create-pixi-native-v${generatorPackageVersion}`,
        expectedPackages: ["@matjash/create-pixi-native"],
        manifestTargets: [],
      }
    : {
        version: runtimePackageVersion,
        tag: `v${runtimePackageVersion}`,
        expectedPackages: useWin32Only
          ? ["@matjash/pixi-native-win32-x64", "@matjash/pixi-native"]
          : [
              "@matjash/pixi-native-win32-x64",
              "@matjash/pixi-native-linux-x64",
              "@matjash/pixi-native",
            ],
        manifestTargets: useWin32Only
          ? ["win32-x64"]
          : ["win32-x64", "linux-x64"],
      };
}

export function getNpmInvocation(
  platform = process.platform,
  execPath = process.execPath,
) {
  if (platform !== "win32") {
    return { command: "npm", argumentPrefix: [] };
  }
  return {
    command: execPath,
    argumentPrefix: [
      "--use-system-ca",
      win32.resolve(
        win32.dirname(execPath),
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      ),
    ],
  };
}

export function sanitizeNpmEnvironment(environment, cache) {
  const sanitized = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!/^npm_config_/i.test(key)) {
      sanitized[key] = value;
    }
  }
  sanitized.NPM_CONFIG_CACHE = cache;
  const nodeOptions = (environment.NODE_OPTIONS ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (!nodeOptions.includes("--use-system-ca")) {
    nodeOptions.push("--use-system-ca");
  }
  sanitized.NODE_OPTIONS = nodeOptions.join(" ");
  return sanitized;
}

export function archiveDigests(bytes) {
  return {
    shasum: createHash("sha1").update(bytes).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
  };
}

export function registryCopyMatches(localDigests, registryDistribution) {
  return (
    registryDistribution?.shasum === localDigests.shasum &&
    registryDistribution?.integrity === localDigests.integrity
  );
}

async function main() {
  const checkOnly = commandArguments.includes("--check");
  if (process.versions.node.split(".")[0] !== "24") {
    throw new Error("Publishing requires Node.js 24 LTS.");
  }
  assertGitReleaseState();
  const archives = await loadReleaseArchives();
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pixi-native-npm-"));
  const cache = join(temporaryDirectory, "cache");
  try {
    const npmEnvironment = sanitizeNpmEnvironment(process.env, cache);
    runNpm(["whoami", "--registry", REGISTRY], npmEnvironment);

    for (const archive of archives) {
      const registryDistribution = queryRegistryDistribution(
        archive.packageName,
        archive.version,
        npmEnvironment,
      );
      if (registryDistribution) {
        if (!registryCopyMatches(archive.digests, registryDistribution)) {
          throw new Error(
            `${archive.packageName}@${archive.version} exists with different content.`,
          );
        }
        console.log(
          `${archive.packageName}@${archive.version} already matches.`,
        );
        continue;
      }
      if (checkOnly) {
        console.log(
          `${archive.packageName}@${archive.version} is ready to publish.`,
        );
        continue;
      }
      runNpm(
        [
          "publish",
          archive.path,
          "--registry",
          REGISTRY,
          "--access",
          "public",
          "--ignore-scripts",
        ],
        npmEnvironment,
        true,
      );
      const published = queryRegistryDistribution(
        archive.packageName,
        archive.version,
        npmEnvironment,
      );
      if (!registryCopyMatches(archive.digests, published)) {
        throw new Error(
          `Registry verification failed for ${archive.packageName}.`,
        );
      }
      console.log(
        `Published and verified ${archive.packageName}@${archive.version}.`,
      );
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function assertGitReleaseState() {
  const status = runGit(["status", "--porcelain"]);
  if (status.trim()) throw new Error("The release working tree must be clean.");
  const head = runGit(["rev-parse", "HEAD"]).trim();
  const tagged = runGit(["rev-list", "-n", "1", TAG]).trim();
  if (head !== tagged) throw new Error(`${TAG} must point to HEAD.`);
}

async function loadReleaseArchives() {
  if (generatorMode) {
    const releaseManifest = JSON.parse(
      await readFile(
        resolve(
          ARTIFACTS_DIRECTORY,
          "release-manifest-create-pixi-native.json",
        ),
        "utf8",
      ),
    );
    if (
      releaseManifest.version !== VERSION ||
      releaseManifest.sourceFingerprint !==
        computeSourceFingerprint(REPOSITORY_ROOT)
    ) {
      throw new Error("Invalid generator release manifest.");
    }
    return loadArchiveEntries([releaseManifest.archive]);
  }
  const manifests = await Promise.all(
    MANIFEST_TARGETS.map(async (target) => {
      const path = resolve(
        ARTIFACTS_DIRECTORY,
        `release-manifest-${target}.json`,
      );
      const manifest = JSON.parse(await readFile(path, "utf8"));
      if (manifest.version !== VERSION || manifest.target !== target) {
        throw new Error(`Invalid release manifest for ${target}.`);
      }
      return manifest;
    }),
  );
  if (
    manifests.some(
      (manifest) =>
        manifest.sourceFingerprint !== manifests[0].sourceFingerprint,
    )
  ) {
    throw new Error("Release source fingerprints differ.");
  }
  if (
    manifests[0].sourceFingerprint !== computeSourceFingerprint(REPOSITORY_ROOT)
  ) {
    throw new Error("Release manifests do not match the current source tree.");
  }

  const entries = new Map();
  for (const manifest of manifests) {
    for (const archive of manifest.archives) {
      const existing = entries.get(archive.packageName);
      if (existing && existing.sha256 !== archive.sha256) {
        throw new Error(
          `${archive.packageName} differs between platform manifests.`,
        );
      }
      entries.set(archive.packageName, archive);
    }
  }
  return loadArchiveEntries([...entries.values()]);
}

async function loadArchiveEntries(archiveEntries) {
  const entries = new Map(
    archiveEntries.map((entry) => [entry.packageName, entry]),
  );
  if (
    entries.size !== EXPECTED_PACKAGES.length ||
    EXPECTED_PACKAGES.some((name) => !entries.has(name))
  ) {
    throw new Error("Release manifests do not contain the expected packages.");
  }

  const archives = [];
  for (const packageName of EXPECTED_PACKAGES) {
    const entry = entries.get(packageName);
    const path = resolve(ARTIFACTS_DIRECTORY, entry.filename);
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${entry.filename}.`);
    }
    const manifest = JSON.parse(runTar(["-xOf", path, "package/package.json"]));
    if (entry.version !== manifest.version) {
      throw new Error(`${entry.filename} has an invalid manifest version.`);
    }
    validatePackedManifest(manifest, packageName, entry.version);
    archives.push({
      packageName,
      path,
      version: manifest.version,
      digests: archiveDigests(bytes),
    });
  }
  return archives;
}

function validatePackedManifest(manifest, packageName, expectedVersion) {
  if (
    manifest.name !== packageName ||
    manifest.version !== expectedVersion ||
    manifest.license !== "MIT" ||
    manifest.publishConfig?.registry !== REGISTRY ||
    manifest.publishConfig?.access !== "public" ||
    manifest.repository?.url !==
      "git+https://github.com/matjazPrijatelj/pixi-native.git"
  ) {
    throw new Error(`${packageName} has invalid publication metadata.`);
  }
}

function queryRegistryDistribution(packageName, version, environment) {
  const result = runNpmProcess(
    [
      "view",
      `${packageName}@${version}`,
      "dist",
      "--json",
      "--registry",
      REGISTRY,
    ],
    environment,
  );
  if (result.status === 0) return JSON.parse(result.stdout);
  const failure = processFailure(result);
  if (/E404|404 Not Found/i.test(failure)) return null;
  throw new Error(`Registry lookup failed for ${packageName}: ${failure}`);
}

function runNpm(arguments_, environment, interactive = false) {
  const result = runNpmProcess(arguments_, environment, interactive);
  if (result.status !== 0) {
    throw new Error(`npm ${arguments_[0]} failed: ${processFailure(result)}`);
  }
  if (result.stdout?.trim()) process.stdout.write(result.stdout);
}

function runNpmProcess(arguments_, environment, interactive = false) {
  return spawnSync(
    NPM_INVOCATION.command,
    [...NPM_INVOCATION.argumentPrefix, ...arguments_],
    {
      cwd: REPOSITORY_ROOT,
      env: environment,
      shell: false,
      ...(interactive ? { stdio: "inherit" } : { encoding: "utf8" }),
    },
  );
}

function processFailure(result) {
  if (result.error) {
    const code = result.error.code ? `${result.error.code}: ` : "";
    return `${code}${result.error.message}`;
  }
  const output = [result.stderr, result.stdout]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n");
  if (output) return output;
  return `exit code ${result.status ?? "unknown"}`;
}

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) throw new Error(`git ${arguments_[0]} failed.`);
  return result.stdout;
}

function runTar(arguments_) {
  const result = spawnSync("tar", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0)
    throw new Error("Unable to inspect package archive.");
  return result.stdout;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
