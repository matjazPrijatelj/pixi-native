import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveNativePlatformModules,
  type NativePlatformModules,
} from "@pixi-native/core/runtime/platformNative.js";

const REPOSITORY_ROOT = new URL("..", import.meta.url);
const PUBLISHED_PACKAGE_NAMES = ["core", "pixi7", "pixi8"] as const;

async function readTypeScriptSources(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(await readTypeScriptSources(path));
    } else if (entry.name.endsWith(".ts")) {
      sources.push(await readFile(path, "utf8"));
    }
  }
  return sources.join("\n");
}

test("core has no Pixi runtime imports", async () => {
  const sources = await readTypeScriptSources(
    fileURLToPath(new URL("../packages/core/src", import.meta.url)),
  );
  assert.doesNotMatch(sources, /from ["']pixi\.js(?:-v7)?["']/);
});

test("core source contains no generated neighbors for TypeScript modules", async () => {
  for (const path of [
    "packages/core/src/audio/NativeAudioEngine.js",
    "packages/core/src/audio/NativeAudioEngine.d.ts",
    "packages/core/src/runtime/nativeTypes.d.ts",
    "packages/core/src/runtime/platformNative.d.ts",
  ]) {
    await assert.rejects(access(new URL(path, REPOSITORY_ROOT)), {
      code: "ENOENT",
    });
  }
});

test("each version package imports only its matching Pixi major", async () => {
  const pixi7 = await readTypeScriptSources(
    fileURLToPath(new URL("../packages/pixi7/src", import.meta.url)),
  );
  const pixi8 = await readTypeScriptSources(
    fileURLToPath(new URL("../packages/pixi8/src", import.meta.url)),
  );
  assert.doesNotMatch(pixi7, /from ["']pixi\.js["']/);
  assert.doesNotMatch(pixi8, /pixi\.js-v7/);
});

test("GSAP remains an optional consumer integration", async () => {
  const rootManifest = JSON.parse(
    await readFile(new URL("package.json", REPOSITORY_ROOT), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(rootManifest.dependencies?.gsap, undefined);
  assert.equal(rootManifest.devDependencies?.gsap, "^3.15.0");

  for (const packageName of PUBLISHED_PACKAGE_NAMES) {
    const packageRoot = new URL(`packages/${packageName}/`, REPOSITORY_ROOT);
    const manifest = JSON.parse(
      await readFile(new URL("package.json", packageRoot), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    assert.equal(manifest.dependencies?.gsap, undefined, packageName);
    assert.equal(manifest.peerDependencies?.gsap, undefined, packageName);
    assert.doesNotMatch(
      await readTypeScriptSources(fileURLToPath(new URL("src", packageRoot))),
      /from ["']gsap(?:\/[^"']*)?["']|import\(["']gsap(?:\/[^"']*)?["']\)/,
      packageName,
    );
  }
});

test("native platform resolver validates support, installation, and target", () => {
  const linux = resolveNativePlatformModules(
    "linux",
    "x64",
    () =>
      ({
        target: "linux-x64",
        gpuModule: "gpu",
        windowModule: "window",
        videoModule: "video",
        ffmpeg: "ffmpeg",
        ffprobe: "ffprobe",
      }) as NativePlatformModules,
  );
  assert.equal(linux.target, "linux-x64");
  assert.throws(
    () =>
      resolveNativePlatformModules("win32", "x64", () => {
        throw new Error("not installed");
      }),
    /Missing native package @matjash\/pixi-native-win32-x64/,
  );
  const wrongTarget = {
    target: "linux-x64",
  } as NativePlatformModules;
  assert.throws(
    () => resolveNativePlatformModules("win32", "x64", () => wrongTarget),
    /targets linux-x64, expected win32-x64/,
  );
});
