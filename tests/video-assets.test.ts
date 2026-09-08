import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { isUsableVideoAsset } from "../src/demo/videoAssets.ts";

const asset = (name: string): string =>
  fileURLToPath(new URL(`../src/demo/assets/${name}`, import.meta.url));

test("video asset validation rejects Git LFS pointers", async () => {
  const directory = await mkdtemp(`${tmpdir()}/pixi-video-asset-test-`);
  const path = `${directory}/pointer.mp4`;
  await writeFile(
    path,
    "version https://git-lfs.github.com/spec/v1\noid sha256:deadbeef\nsize 1000\n",
  );
  try {
    assert.equal(isUsableVideoAsset(path), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("video asset validation accepts actual MP4 bytes", () => {
  assert.equal(
    isUsableVideoAsset(asset("Big_Buck_Bunny_720_10s_20MB.mp4")),
    true,
  );
});
