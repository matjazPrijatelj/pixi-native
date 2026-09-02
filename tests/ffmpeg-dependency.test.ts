import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("project FFmpeg dependency is immutable and manually reproducible", async () => {
    const manifest = JSON.parse(await readFile("native/ffmpeg/dependency.json", "utf8"));
    const windows = manifest.platforms["win32-x64"];

    assert.match(manifest.version, /^8\./);
    assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
    assert.match(manifest.buildRecipe.commit, /^[0-9a-f]{40}$/);
    assert.equal(manifest.buildRecipe.variant, "lgpl-shared");
    assert.doesNotMatch(windows.url, /\/latest\//);
    assert.match(windows.sha256, /^[0-9a-f]{64}$/);
    assert.equal(windows.license, "LGPL-3.0-or-later");

    const instructions = await readFile("native/ffmpeg/README.md", "utf8");
    assert.match(instructions, new RegExp(manifest.sourceCommit));
    assert.match(instructions, new RegExp(manifest.buildRecipe.commit));
    assert.match(instructions, /\.\/build\.sh win64 lgpl-shared 8\.1/);
});
