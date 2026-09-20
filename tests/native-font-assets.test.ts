import test from "node:test";
import assert from "node:assert/strict";
import type { FontKey } from "@napi-rs/canvas";
import { Assets as Assets7, loadWebFont as loadWebFont7 } from "pixi.js-v7";
import { Assets as Assets8, loadWebFont as loadWebFont8 } from "pixi.js";
import {
    createNativeFontLoader,
    isNativeCanvasFont,
    type NativeFontRegistration,
    type NativeFontRegistry,
} from "@pixi-native/core/canvas/NativeFontAssets.js";
import {
    installNativeFontAssets as installPixi7NativeFontAssets,
    nativeFontLoader as pixi7NativeFontLoader,
} from "../packages/pixi7/src/nativeFontAssets.ts";
import {
    installNativeFontAssets as installPixi8NativeFontAssets,
    nativeFontLoader as pixi8NativeFontLoader,
} from "../packages/pixi8/src/nativeFontAssets.ts";

test("Pixi 7 and Pixi 8 keep their established web-font parser identifiers", () => {
    assert.equal(pixi7NativeFontLoader.name, "loadWebFont");
    assert.equal(pixi7NativeFontLoader.id, undefined);
    assert.equal(pixi8NativeFontLoader.name, "loadWebFont");
    assert.equal(pixi8NativeFontLoader.id, "web-font");
});

test("both Pixi asset loaders replace the browser FontFace parser", () => {
    installPixi7NativeFontAssets();
    installPixi8NativeFontAssets();

    assert.equal(Assets7.loader.parsers.includes(loadWebFont7), false);
    assert.equal(
        Assets7.loader.parsers.includes(
            pixi7NativeFontLoader as typeof loadWebFont7,
        ),
        true,
    );
    assert.equal(Assets8.loader.parsers.includes(loadWebFont8), false);
    assert.equal(
        Assets8.loader.parsers.includes(
            pixi8NativeFontLoader as typeof loadWebFont8,
        ),
        true,
    );
});

test("native font detection is limited to resolved OTF and TTF assets", () => {
    assert.equal(isNativeCanvasFont("file:///fonts/display.otf"), true);
    assert.equal(isNativeCanvasFont("https://host/display.ttf?v=2"), true);
    assert.equal(isNativeCanvasFont("font.bin", { format: ".otf" }), true);
    assert.equal(
        isNativeCanvasFont("data:font/ttf;base64,AA=="),
        true,
    );
    assert.equal(isNativeCanvasFont("file:///fonts/display.woff2"), false);
});

test("native font loader registers family aliases and removes its FontKey", async () => {
    const key = {} as FontKey;
    const registrations: Array<{ bytes: Buffer; family?: string }> = [];
    const removed: FontKey[] = [];
    const registry: NativeFontRegistry = {
        register: (bytes, family) => {
            registrations.push({ bytes, family });
            return key;
        },
        remove: (fontKey) => {
            removed.push(fontKey);
            return true;
        },
    };
    const loader = createNativeFontLoader({
        extension: { type: "load-parser" },
        name: "loadWebFont",
        fallback: { test: () => true },
        fetch: async () => new Response(new Uint8Array([1, 2, 3])),
        getFontFamilyName: () => "Filename Family",
        registry,
    });

    const loaded = (await loader.load?.("file:///display.otf", {
        data: { family: "Display Alias" },
    })) as NativeFontRegistration;

    assert.equal(loaded.kind, "native-font");
    assert.equal(loaded.family, "Display Alias");
    assert.deepEqual([...registrations[0].bytes], [1, 2, 3]);
    assert.equal(registrations[0].family, "Display Alias");

    await loader.unload?.(loaded);
    assert.deepEqual(removed, [key]);
});

test("native font loader retains the original loader for WOFF assets", async () => {
    const fallbackAsset = { family: "Browser Font" };
    const unloaded: unknown[] = [];
    const loader = createNativeFontLoader({
        extension: { type: "load-parser" },
        name: "loadWebFont",
        fallback: {
            test: () => true,
            load: async () => fallbackAsset,
            unload: (asset) => {
                unloaded.push(asset);
            },
        },
        fetch: async () => {
            throw new Error("native fetch must not run for WOFF");
        },
        getFontFamilyName: () => "Unused",
    });

    const loaded = await loader.load?.("file:///display.woff2");
    assert.equal(loaded, fallbackAsset);
    await loader.unload?.(loaded);
    assert.deepEqual(unloaded, [fallbackAsset]);
});

test("native font loader reports rejected GlobalFonts registrations", async () => {
    const loader = createNativeFontLoader({
        extension: { type: "load-parser" },
        name: "loadWebFont",
        fallback: { test: () => true },
        fetch: async () => new Response(new Uint8Array([1, 2, 3])),
        getFontFamilyName: () => "Broken Font",
        registry: {
            register: () => null,
            remove: () => false,
        },
    });

    assert.ok(loader.load);
    await assert.rejects(
        loader.load("file:///broken.ttf"),
        /failed to register font family "Broken Font"/i,
    );
});
