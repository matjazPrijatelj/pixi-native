import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { BitmapFont, DOMAdapter, Sprite, Texture } from "pixi.js";
import { gsap } from "gsap";
import {
    DYNAMIC_BITMAP_FONT_NAME,
    installDynamicBitmapTextFont,
} from "../v8/bitmapFonts.ts";
import { createSpriteTest } from "../v8/scenes/SpriteTest.ts";
import { disposeDemoScene } from "../v8/sceneLifecycle.ts";
import { NodeDOMAdapter } from "../../pixi-native/NodeDOMAdapter.ts";

test("Sprite scene adds and removes animated batches without leaking tweens", () => {
    new NodeDOMAdapter({} as never).installPixi8(DOMAdapter);
    installDynamicBitmapTextFont();
    const baselineTweens = gsap.globalTimeline.getChildren(true, true, true).length;
    try {
        const scene = createSpriteTest(
            [Texture.WHITE, Texture.EMPTY, Texture.WHITE],
            { width: 1280, height: 720 },
            { random: () => 0.5 },
        );
        const staticTweenCount = gsap.globalTimeline.getChildren(true, true, true).length;
        assert.ok(staticTweenCount > baselineTweens);

        assert.equal(scene.addRandomSprites(), 10);
        assert.equal(scene.addRandomSprites(), 20);
        const dynamicSprites = scene.children.slice(4) as Sprite[];
        assert.equal(dynamicSprites.length, 20);
        assert.ok(dynamicSprites.every((sprite) => sprite.texture === Texture.EMPTY));
        assert.ok(
            dynamicSprites.every(
                (sprite) =>
                    sprite.x >= 0 &&
                    sprite.x <= 1280 &&
                    sprite.y >= 90 &&
                    sprite.y <= 720,
            ),
        );
        assert.ok(
            gsap.globalTimeline.getChildren(true, true, true).length > staticTweenCount,
        );

        scene.resize(800, 600);
        assert.equal(scene.getDynamicSpriteCount(), 20);

        assert.equal(scene.removeRandomSprites(), 10);
        assert.equal(scene.removeRandomSprites(), 0);
        assert.equal(scene.removeRandomSprites(), 0);
        assert.equal(
            gsap.globalTimeline.getChildren(true, true, true).length,
            staticTweenCount,
        );

        scene.addRandomSprites();
        disposeDemoScene(scene);
        assert.equal(
            gsap.globalTimeline.getChildren(true, true, true).length,
            baselineTweens,
        );
    } finally {
        gsap.ticker.sleep();
        BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
    }
});

for (const [file, expectedSize] of [
    ["batman.png", 512],
    ["mario.png", 256],
] as const) {
    test(`${file} is a square RGBA sprite with transparency`, async () => {
        const path = fileURLToPath(new URL(`../assets/${file}`, import.meta.url));
        const image = await loadImage(path);
        assert.equal(image.width, expectedSize);
        assert.equal(image.height, expectedSize);

        const canvas = createCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        let transparentPixels = 0;
        let visiblePixels = 0;
        for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] === 0) transparentPixels++;
            if (pixels[index] > 0) visiblePixels++;
        }
        assert.ok(transparentPixels > 0);
        assert.ok(visiblePixels > 0);
    });
}
