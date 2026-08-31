import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
    Assets,
    BitmapFont,
    BitmapText,
    bitmapFontTextParser,
} from "pixi.js";
import {
    createBitmapTextTest,
} from "../src/demo/test/BitmapTextTest.ts";
import {
    createMetricBitmapText,
    DYNAMIC_BITMAP_FONT_NAME,
    installDynamicBitmapTextFont,
} from "../src/demo/bitmapFonts.ts";
import { FpsOverlay } from "../src/demo/FpsOverlay.ts";
import { disposeDemoScene } from "../src/demo/sceneLifecycle.ts";
import { NodeDOMAdapter } from "../src/pixi-node/NodeDOMAdapter.ts";

const FONT_URL = new URL(
    "../assets/bitmap-font/native-pixel.fnt",
    import.meta.url,
);

test("the generated text descriptor is valid BMFont data", async () => {
    const descriptor = await readFile(FONT_URL, "utf8");
    assert.equal(bitmapFontTextParser.test(descriptor), true);

    const parsed = bitmapFontTextParser.parse(descriptor);
    assert.equal(parsed.fontFamily, "NativePixel");
    assert.equal(parsed.pages.length, 1);
    assert.equal(Object.keys(parsed.chars).length, 43);
});

test("BitmapText scene supports generated and external atlases", async () => {
    new NodeDOMAdapter({} as never).install();
    const fontPath = fileURLToPath(FONT_URL);
    let externalFontLoaded = false;
    let dynamicFontInstalled = false;

    try {
        installDynamicBitmapTextFont();
        dynamicFontInstalled = true;
        const externalFont = await Assets.load(fontPath);
        externalFontLoaded = true;
        assert.equal(externalFont.fontFamily, "NativePixel");

        const scene = createBitmapTextTest();
        const bitmapText = scene.children.filter(
            (child): child is BitmapText => child instanceof BitmapText,
        );
        assert.equal(bitmapText.length, 4);
        assert.ok(bitmapText.every((label) => label.width > 0));

        const metric = createMetricBitmapText("decoded 10 / dropped 2", 18);
        assert.ok(metric instanceof BitmapText);
        metric.text = "decoded 11 / dropped 3";
        assert.ok(metric.width > 0);
        metric.destroy({ context: true, style: true });

        const fpsOverlay = new FpsOverlay();
        const fpsLabel = fpsOverlay.children.find(
            (child): child is BitmapText => child instanceof BitmapText,
        );
        assert.ok(fpsLabel);
        fpsOverlay.tick(1000);
        assert.match(fpsLabel.text, /^FPS 1\.0 /);
        fpsOverlay.destroy({ children: true, context: true, style: true });

        disposeDemoScene(scene);
        assert.equal(scene.destroyed, true);

        const reuseExternalFont = new BitmapText({
            text: "SHARED FONT SURVIVES SCENE",
            style: { fontFamily: "NativePixel", fontSize: 24 },
        });
        assert.ok(reuseExternalFont.width > 0);
        reuseExternalFont.destroy({ context: true, style: true });
    } finally {
        if (dynamicFontInstalled) {
            BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
        }
        if (externalFontLoaded) {
            await Assets.unload(fontPath);
        }
    }
});
