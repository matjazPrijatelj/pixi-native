import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as v7 from "../src/pixi-native/v7.ts";
import * as v8 from "../src/pixi-native/v8.ts";

test("versioned facades expose compact APIs for the matching Pixi major", () => {
    assert.match(v7.VERSION, /^7\./);
    assert.match(v8.VERSION, /^8\./);

    for (const facade of [v7, v8]) {
        assert.equal(typeof facade.createApp, "function");
        assert.equal(typeof facade.createRenderer, "function");
        assert.equal(typeof facade.VideoSprite, "function");
        assert.equal("createNativePixiApplication" in facade, false);
        assert.equal("createPixiRenderer" in facade, false);
    }
});

test("package exports only the versioned Pixi facades", async () => {
    const packageJson = JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, unknown> };

    assert.deepEqual(Object.keys(packageJson.exports), [
        "./v7",
        "./v8",
        "./audio",
        "./video",
        "./files",
    ]);
});
