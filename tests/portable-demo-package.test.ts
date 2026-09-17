import assert from "node:assert/strict";
import test from "node:test";
import {
    createMemoryAnalyzerLauncher,
    createPortablePackageManifest,
    rewritePortableDemoImports,
    shouldIncludePortableInput,
} from "../scripts/package-portable-demo.mjs";

test("portable memory analyzer launchers forward every argument", () => {
    assert.match(createMemoryAnalyzerLauncher("win32"), /%\*/u);
    assert.match(createMemoryAnalyzerLauncher("linux"), /"\$@"/u);
});

test("portable demo rewrites internal runtime imports", () => {
    const source = [
        'import { createApp } from "@pixi-native/pixi8";',
        'import { createApp as createApp7 } from "@pixi-native/pixi7";',
        'import { NativeVideo } from "@pixi-native/core";',
        'import { nativeAudioEngine } from "@pixi-native/core/audio";',
    ].join("\n");
    const rewritten = rewritePortableDemoImports(source);

    assert.doesNotMatch(rewritten, /@pixi-native\//u);
    assert.match(rewritten, /@matjash\/pixi-native\/pixi8/u);
    assert.match(rewritten, /@matjash\/pixi-native\/pixi7/u);
    assert.match(rewritten, /@matjash\/pixi-native\/core\/audio/u);
});

test("portable demo includes its env template but never the local env", () => {
    assert.equal(shouldIncludePortableInput(".env.example"), true);
    assert.equal(shouldIncludePortableInput("src/demo"), true);
    assert.equal(shouldIncludePortableInput("src/demo/assets/pixi-hero.png"), true);
    assert.equal(
        shouldIncludePortableInput("scripts/native-memory-isolation-options.mjs"),
        true,
    );
    assert.equal(shouldIncludePortableInput(".env"), false);
    assert.equal(shouldIncludePortableInput("logs/memoryInfo.log"), false);
});

test("portable manifest pins the selected local native archive", () => {
    const manifest = createPortablePackageManifest({
        platform: "linux",
        runtimeVersion: "0.2.3",
        facadeArchiveName: "matjash-pixi-native-0.2.3.tgz",
        nativeArchiveName: "matjash-pixi-native-linux-x64-0.2.3.tgz",
        pixiVersion: "8.21.0",
        pixi7Version: "npm:pixi.js@7.4.3",
        gsapVersion: "^3.15.0",
    });

    assert.equal(manifest.private, true);
    assert.equal(
        manifest.dependencies["@matjash/pixi-native-linux-x64"],
        "file:vendor/matjash-pixi-native-linux-x64-0.2.3.tgz",
    );
    assert.equal(manifest.dependencies["pixi.js"], "8.21.0");
    assert.equal(manifest.dependencies["pixi.js-v7"], "npm:pixi.js@7.4.3");
});
