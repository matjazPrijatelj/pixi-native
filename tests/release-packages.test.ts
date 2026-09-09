import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  archiveDigests,
  getNpmInvocation,
  registryCopyMatches,
  sanitizeNpmEnvironment,
} from "../scripts/publish-github-packages.mjs";

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
      registry: "https://npm.pkg.github.com",
    });
  }
  assert.deepEqual(names, [
    "@matjazprijatelj/create-pixi-native",
    "@matjazprijatelj/pixi-native",
    "@matjazprijatelj/pixi-native-win32-x64",
    "@matjazprijatelj/pixi-native-linux-x64",
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
  };
  assert.equal(manifest.exports["."].default, "./dist/pixi8/index.js");
  for (const path of ["./pixi8", "./pixi7", "./core"]) {
    assert.ok(manifest.exports[path], path);
  }
  assert.deepEqual(manifest.optionalDependencies, {
    "@matjazprijatelj/pixi-native-linux-x64": "0.1.1",
    "@matjazprijatelj/pixi-native-win32-x64": "0.1.1",
  });
});

test("publisher strips inherited npm config and compares immutable digests", () => {
  const environment = sanitizeNpmEnvironment(
    {
      PATH: "bin",
      npm_config_registry: "https://wrong.invalid",
      NPM_CONFIG_TOKEN: "secret",
      GITHUB_PACKAGES_TOKEN: "secret",
    },
    "temporary-npmrc",
    "temporary-cache",
  );
  assert.deepEqual(environment, {
    PATH: "bin",
    NPM_CONFIG_USERCONFIG: "temporary-npmrc",
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
