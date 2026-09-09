import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  archiveDigests,
  getReleaseConfiguration,
  getNpmInvocation,
  registryCopyMatches,
  sanitizeNpmEnvironment,
} from "../scripts/publish-npm-packages.mjs";

const REPOSITORY_ROOT = new URL("..", import.meta.url);

test("public package metadata defines the generator, facade, and native packages", async () => {
  const packagePaths = [
    "packages/create-pixi-native/package.json",
    "packages/pixi-native/package.json",
    "packages/native-win32-x64/package.json",
    "packages/native-linux-x64/package.json",
  ];
  const names = [];
  for (const packagePath of packagePaths) {
    const manifest = JSON.parse(
      await readFile(new URL(packagePath, REPOSITORY_ROOT), "utf8"),
    ) as Record<string, unknown>;
    names.push(manifest.name);
    assert.equal(manifest.license, "MIT", packagePath);
    assert.deepEqual(manifest.publishConfig, {
      registry: "https://registry.npmjs.org",
      access: "public",
    });
  }
  assert.deepEqual(names, [
    "@matjash/create-pixi-native",
    "@matjash/pixi-native",
    "@matjash/pixi-native-win32-x64",
    "@matjash/pixi-native-linux-x64",
  ]);
});

test("facade exports root Pixi 8 and explicit version and core paths", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("packages/pixi-native/package.json", REPOSITORY_ROOT),
      "utf8",
    ),
  ) as {
    exports: Record<string, { default: string }>;
    optionalDependencies: Record<string, string>;
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    peerDependenciesMeta: Record<string, { optional: boolean }>;
  };
  assert.equal(manifest.exports["."].default, "./dist/pixi8/index.js");
  for (const path of ["./pixi8", "./pixi7", "./core"]) {
    assert.ok(manifest.exports[path], path);
  }
  assert.ok(manifest.exports["./core/audio"]);
  assert.equal(manifest.exports["./core/audio/*.js"], undefined);
  assert.deepEqual(manifest.optionalDependencies, {
    "@matjash/pixi-native-linux-x64": "0.1.2",
    "@matjash/pixi-native-win32-x64": "0.1.2",
  });
  assert.equal(manifest.dependencies["pixi.js"], undefined);
  assert.equal(manifest.dependencies["pixi.js-v7"], undefined);
  assert.deepEqual(manifest.peerDependencies, {
    "pixi.js": "^8.20.0",
    "pixi.js-v7": "npm:pixi.js@^7.4.3",
  });
  assert.deepEqual(manifest.peerDependenciesMeta, {
    "pixi.js": { optional: true },
    "pixi.js-v7": { optional: true },
  });
});

test("private Pixi facades use ranged peers and exact development versions", async () => {
  for (const [packagePath, peerName, peerVersion, developmentVersion] of [
    [
      "packages/pixi7/package.json",
      "pixi.js-v7",
      "npm:pixi.js@^7.4.3",
      "npm:pixi.js@7.4.3",
    ],
    ["packages/pixi8/package.json", "pixi.js", "^8.20.0", "8.20.0"],
  ] as const) {
    const manifest = JSON.parse(
      await readFile(new URL(packagePath, REPOSITORY_ROOT), "utf8"),
    );
    assert.equal(manifest.dependencies?.[peerName], undefined, packagePath);
    assert.equal(manifest.peerDependencies[peerName], peerVersion, packagePath);
    assert.equal(
      manifest.devDependencies[peerName],
      developmentVersion,
      packagePath,
    );
  }
});

test("generator has an independent package version", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("packages/create-pixi-native/package.json", REPOSITORY_ROOT),
      "utf8",
    ),
  );
  assert.equal(manifest.version, "0.1.4");
});

test("WSL release commands use temporary LF scripts", async () => {
  const source = await readFile(
    new URL("scripts/package-release-linux-wsl.ps1", REPOSITORY_ROOT),
    "utf8",
  );
  assert.doesNotMatch(source, /bash -lc \$Command/);
  assert.match(source, /UTF8Encoding\(\$false\)/);
  assert.match(source, /--exec bash \$wslCommandPath/);
  assert.match(source, /Remove-Item -LiteralPath \$windowsCommandPath/);
});

test("publisher isolates npm configuration and compares immutable digests", () => {
  const environment = sanitizeNpmEnvironment(
    {
      PATH: "bin",
      npm_config_registry: "https://wrong.invalid",
      NPM_CONFIG_TOKEN: "secret",
    },
    "temporary-cache",
  );
  assert.deepEqual(environment, {
    PATH: "bin",
    NPM_CONFIG_CACHE: "temporary-cache",
    NODE_OPTIONS: "--use-system-ca",
  });

  assert.deepEqual(getNpmInvocation("win32", "C:\\Node\\node.exe"), {
    command: "C:\\Node\\node.exe",
    argumentPrefix: [
      "--use-system-ca",
      "C:\\Node\\node_modules\\npm\\bin\\npm-cli.js",
    ],
  });

  const digests = archiveDigests(Buffer.from("archive"));
  assert.equal(registryCopyMatches(digests, digests), true);
  assert.equal(
    registryCopyMatches(digests, { ...digests, shasum: "different" }),
    false,
  );
  assert.equal(registryCopyMatches(digests, null), false);
});

test("publisher selects package-specific versions, archives, and tags", () => {
  assert.deepEqual(getReleaseConfiguration(true, "0.1.2", "0.1.4"), {
    version: "0.1.4",
    tag: "create-pixi-native-v0.1.4",
    expectedPackages: ["@matjash/create-pixi-native"],
  });
  assert.deepEqual(getReleaseConfiguration(false, "0.1.2", "0.1.4"), {
    version: "0.1.2",
    tag: "v0.1.2",
    expectedPackages: [
      "@matjash/pixi-native-win32-x64",
      "@matjash/pixi-native-linux-x64",
      "@matjash/pixi-native",
    ],
  });
});
