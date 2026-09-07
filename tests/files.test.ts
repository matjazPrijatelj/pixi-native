import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createModuleFileAccess } from "../src/pixi-native/files.ts";

test("module file access resolves relative, absolute, and file URL sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixi-native-files-"));
  try {
    const modulePath = join(root, "display", "dist", "main.js");
    const files = createModuleFileAccess(pathToFileURL(modulePath));
    const assetPath = join(root, "display", "assets", "sprite.png");

    assert.equal(files.resolvePath("../assets/sprite.png"), assetPath);
    assert.equal(files.resolvePath(assetPath), assetPath);
    assert.equal(files.resolvePath(pathToFileURL(assetPath)), assetPath);

    if (process.platform === "win32") {
      assert.equal(
        files.resolvePath("Z:\\external\\config.json"),
        normalize("Z:\\external\\config.json"),
      );
      assert.equal(
        files.resolvePath("\\\\server\\share\\config.json"),
        normalize("\\\\server\\share\\config.json"),
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("module file access reads bytes, text, and JSON independently of cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixi-native-files-"));
  try {
    const modulePath = join(root, "display", "dist", "main.js");
    const assetDirectory = join(dirname(dirname(modulePath)), "assets");
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(join(assetDirectory, "message.txt"), "native display");
    await writeFile(
      join(assetDirectory, "config.json"),
      JSON.stringify({ renderer: "webgpu" }),
    );
    const files = createModuleFileAccess(pathToFileURL(modulePath));

    assert.equal(await files.exists("../assets/message.txt"), true);
    assert.equal(await files.exists("../assets/missing.txt"), false);
    assert.equal(
      await files.readText("../assets/message.txt"),
      "native display",
    );
    assert.deepEqual(
      Array.from(await files.readBytes("../assets/message.txt")),
      Array.from(Buffer.from("native display")),
    );
    assert.deepEqual(
      await files.readJson<{ renderer: string }>("../assets/config.json"),
      { renderer: "webgpu" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("module file access identifies malformed JSON and rejects network URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pixi-native-files-"));
  try {
    const modulePath = join(root, "display", "main.js");
    const malformedPath = join(root, "display", "malformed.json");
    await mkdir(dirname(modulePath), { recursive: true });
    await writeFile(malformedPath, "{ invalid");
    const files = createModuleFileAccess(pathToFileURL(modulePath));

    await assert.rejects(
      files.readJson("malformed.json"),
      (error: unknown) =>
        error instanceof SyntaxError &&
        error.message.includes(malformedPath) &&
        error.cause instanceof SyntaxError,
    );
    assert.throws(
      () => files.resolvePath(new URL("https://example.com/config.json")),
      /Expected a file URL/,
    );
    assert.throws(
      () => files.resolvePath("https://example.com/config.json"),
      /Expected a filesystem path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
