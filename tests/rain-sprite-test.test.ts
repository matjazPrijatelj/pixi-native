import test from "node:test";
import assert from "node:assert/strict";
import { BitmapFont, DOMAdapter, Texture } from "pixi.js";
import { createRainSpriteTest } from "../src/demo/v8/scenes/RainSpriteTest.ts";
import {
    DYNAMIC_BITMAP_FONT_NAME,
    installDynamicBitmapTextFont,
} from "../src/demo/v8/bitmapFonts.ts";
import { NodeDOMAdapter } from "../src/pixi-native/NodeDOMAdapter.ts";

test("Rain Sprite scene adds and removes drops in pairs", () => {
    new NodeDOMAdapter({} as never).installPixi8(DOMAdapter);
    installDynamicBitmapTextFont();
    try {
        const scene = createRainSpriteTest(
            Texture.WHITE,
            { width: 800, height: 600 },
            { random: () => 0.5 },
        );
        assert.equal(scene.getDropCount(), 4);
        assert.equal(scene.handleKey("up"), true);
        assert.equal(scene.getDropCount(), 6);
        assert.equal(scene.handleKey("m"), true);
        assert.equal(scene.handleKey("m", 1), false);
        assert.equal(scene.handleKey("m"), true);
        assert.equal(scene.handleKey("up", 1), false);
        assert.equal(scene.getDropCount(), 6);
        const initialFrame = scene.getFrameIndex();
        scene.update(100);
        assert.notEqual(scene.getFrameIndex(), initialFrame);
        for (let index = 0; index < 60; index++) scene.update(100);
        assert.ok(scene.getLandingCount() >= 2);
        assert.equal(scene.handleKey("down"), true);
        assert.equal(scene.getDropCount(), 4);
        assert.equal(scene.handleKey("down"), true);
        assert.equal(scene.getDropCount(), 2);
        scene.dispose?.();
    } finally {
        BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
    }
});
