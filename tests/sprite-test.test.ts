import test from "node:test";
import assert from "node:assert/strict";
import { BitmapFont, DOMAdapter, Sprite, Texture } from "pixi.js";
import { gsap } from "gsap";
import {
  DYNAMIC_BITMAP_FONT_NAME,
  installDynamicBitmapTextFont,
} from "../src/demo/v8/bitmapFonts.ts";
import { createSpriteTest } from "../src/demo/v8/scenes/SpriteTest.ts";
import { disposeDemoScene } from "../src/demo/v8/sceneLifecycle.ts";
import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";

test("Sprite scene adds and removes animated batches without leaking tweens", () => {
  new NodeDOMAdapter({} as never).installPixi8(DOMAdapter);
  installDynamicBitmapTextFont();
  const baselineTweens = gsap.globalTimeline.getChildren(
    true,
    true,
    true,
  ).length;
  try {
    const scene = createSpriteTest(
      [Texture.WHITE, Texture.EMPTY, Texture.WHITE],
      { width: 1280, height: 720 },
      { random: () => 0.5 },
    );
    const staticTweenCount = gsap.globalTimeline.getChildren(
      true,
      true,
      true,
    ).length;
    assert.ok(staticTweenCount > baselineTweens);

    assert.equal(scene.addRandomSprites(), 10);
    assert.equal(scene.addRandomSprites(), 20);
    const dynamicSprites = scene.children.slice(4) as Sprite[];
    assert.equal(dynamicSprites.length, 20);
    assert.ok(
      dynamicSprites.every((sprite) => sprite.texture === Texture.EMPTY),
    );
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
      gsap.globalTimeline.getChildren(true, true, true).length >
        staticTweenCount,
    );

    const timelinesBeforeResize = gsap.globalTimeline.getChildren(
      false,
      false,
      true,
    );
    const staticSprite = scene.children[1] as Sprite;
    timelinesBeforeResize[0].totalTime(0);
    scene.resize(800, 600);
    assert.equal(scene.getDynamicSpriteCount(), 20);
    const timelinesAfterResize = gsap.globalTimeline.getChildren(
      false,
      false,
      true,
    );
    assert.equal(timelinesAfterResize.length, timelinesBeforeResize.length);
    assert.ok(
      timelinesAfterResize.every(
        (timeline, index) => timeline === timelinesBeforeResize[index],
      ),
    );
    const resizedY = staticSprite.y;
    timelinesBeforeResize[0].totalTime(0.75);
    assert.notEqual(staticSprite.y, resizedY);
    assert.ok(
      dynamicSprites.every(
        (sprite) =>
          sprite.x >= 0 && sprite.x <= 800 && sprite.y >= 0 && sprite.y <= 600,
      ),
    );

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
