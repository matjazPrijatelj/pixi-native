import assert from "node:assert/strict";
import test from "node:test";
import {
    createPortablePackageManifest,
    rewritePortableDemoImports,
    shouldIncludePortableInput,
} from "../scripts/package-portable-demo.mjs";

test("portable demo rewrites internal runtime imports", () => {
    const source = [
        'import { createApp } from "@pixi-native/pixi8";',
        'import { NativeVideo } from "@pixi-native/core";',
        'import { nativeAudioEngine } from "@pixi-native/core/audio";',
    ].join("\n");
    const rewritten = rewritePortableDemoImports(source);

    assert.doesNotMatch(rewritten, /@pixi-native\//u);
    assert.match(rewritten, /@matjash\/pixi-native\/pixi8/u);
    assert.match(rewritten, /@matjash\/pixi-native\/core\/audio/u);
});

test("portable demo includes its env template but never the local env", () => {
    assert.equal(shouldIncludePortableInput(".env.example"), true);
    assert.equal(shouldIncludePortableInput("src/demo"), true);
    assert.equal(shouldIncludePortableInput("src/demo/assets/pixi-hero.png"), true);
    assert.equal(shouldIncludePortableInput(".env"), false);
    assert.equal(shouldIncludePortableInput("logs/memoryInfo.log"), false);
});

test("portable manifest pins the selected local native archive", () => {
    const manifest = createPortablePackageManifest({
        platform: "linux",
        runtimeVersion: "0.2.2",
        facadeArchiveName: "matjash-pixi-native-0.2.2.tgz",
        nativeArchiveName: "matjash-pixi-native-linux-x64-0.2.2.tgz",
        pixiVersion: "8.20.0",
        gsapVersion: "^3.15.0",
    });

    assert.equal(manifest.private, true);
    assert.equal(
        manifest.dependencies["@matjash/pixi-native-linux-x64"],
        "file:vendor/matjash-pixi-native-linux-x64-0.2.2.tgz",
    );
    assert.equal(manifest.dependencies["pixi.js"], "8.20.0");
});
