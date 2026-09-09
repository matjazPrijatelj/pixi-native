import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadImage } from "@napi-rs/canvas";

const REPOSITORY_ROOT = new URL("..", import.meta.url);

test("hero artwork is wired to documentation and both demos", async () => {
  const documentationPath = new URL("pixi-hero.png", REPOSITORY_ROOT);
  const demoPath = new URL("src/demo/assets/pixi-hero.png", REPOSITORY_ROOT);
  const [
    documentationImage,
    demoImage,
    readme,
    pixi7Main,
    pixi8Main,
    facadeManifestSource,
    packScript,
  ] = await Promise.all([
    readFile(documentationPath),
    readFile(demoPath),
    readFile(new URL("README.md", REPOSITORY_ROOT), "utf8"),
    readFile(new URL("src/demo/v7/main.ts", REPOSITORY_ROOT), "utf8"),
    readFile(new URL("src/demo/v8/main.ts", REPOSITORY_ROOT), "utf8"),
    readFile(
      new URL("packages/pixi-native/package.json", REPOSITORY_ROOT),
      "utf8",
    ),
    readFile(new URL("scripts/pack-distribution.mjs", REPOSITORY_ROOT), "utf8"),
  ]);

  assert.deepEqual(demoImage, documentationImage);
  assert.match(readme, /\]\(pixi-hero\.png\)/);
  assert.match(pixi7Main, /asset\("pixi-hero\.png"\)/);
  assert.match(pixi8Main, /\.\.\/assets\/pixi-hero\.png/);
  assert.ok(JSON.parse(facadeManifestSource).files.includes("pixi-hero.png"));
  assert.match(packScript, /DOCUMENTATION_FILES[\s\S]*"pixi-hero\.png"/);

  const decoded = await loadImage(documentationImage);
  assert.equal(decoded.width, 1279);
  assert.equal(decoded.height, 720);
});
