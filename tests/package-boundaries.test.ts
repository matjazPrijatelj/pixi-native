import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveNativePlatformModules,
  type NativePlatformModules,
} from "@pixi-native/core/runtime/platformNative.js";

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
    new URL("../packages/core/src", import.meta.url).pathname.slice(1),
  );
  assert.doesNotMatch(sources, /from ["']pixi\.js(?:-v7)?["']/);
});

test("each version package imports only its matching Pixi major", async () => {
  const pixi7 = await readTypeScriptSources(
    new URL("../packages/pixi7/src", import.meta.url).pathname.slice(1),
  );
  const pixi8 = await readTypeScriptSources(
    new URL("../packages/pixi8/src", import.meta.url).pathname.slice(1),
  );
  assert.doesNotMatch(pixi7, /from ["']pixi\.js["']/);
  assert.doesNotMatch(pixi8, /pixi\.js-v7/);
});

test("native platform resolver validates support, installation, and target", () => {
  assert.throws(
    () => resolveNativePlatformModules("linux", "x64"),
    /does not support linux-x64/,
  );
  assert.throws(
    () =>
      resolveNativePlatformModules("win32", "x64", () => {
        throw new Error("not installed");
      }),
    /Missing native package @pixi-native\/native-win32-x64/,
  );
  const wrongTarget = {
    target: "linux-x64",
  } as NativePlatformModules;
  assert.throws(
    () => resolveNativePlatformModules("win32", "x64", () => wrongTarget),
    /targets linux-x64, expected win32-x64/,
  );
});
