import test from "node:test";
import assert from "node:assert/strict";
import {
  BitmapFont,
  DOMAdapter,
  NineSliceSprite,
  Sprite,
  Texture,
} from "pixi.js";
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
      Texture.WHITE,
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
    const nineSliceFrame = scene.children.find(
      (child) => child instanceof NineSliceSprite,
    ) as NineSliceSprite;
    const sprites = scene.children.filter(
      (child): child is Sprite => child instanceof Sprite,
    );
    const dynamicSprites = sprites.slice(-20);

    assert.ok(nineSliceFrame);
    assert.equal(nineSliceFrame.leftWidth, 16);
    assert.equal(nineSliceFrame.topHeight, 16);
    assert.equal(nineSliceFrame.rightWidth, 16);
    assert.equal(nineSliceFrame.bottomHeight, 16);
    assert.equal(nineSliceFrame.width, 320);
    assert.equal(nineSliceFrame.height, 180);
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
    const nineSliceTimeline = timelinesBeforeResize.find(
      (timeline) => timeline.duration() === 2,
    );
    const staticTimeline = timelinesBeforeResize.find(
      (timeline) => timeline.duration() === 1.5,
    );
    const staticSprite = sprites[0];
    assert.ok(nineSliceTimeline);
    assert.ok(staticTimeline);
    nineSliceTimeline.totalTime(1);
    assert.ok(nineSliceFrame.width > 320 && nineSliceFrame.width < 480);
    assert.ok(nineSliceFrame.height > 180 && nineSliceFrame.height < 270);
    staticTimeline.totalTime(0);
    scene.resize(800, 600);
    assert.equal(nineSliceFrame.x, (800 - nineSliceFrame.width) * 0.5);
    assert.equal(nineSliceFrame.y, (600 - nineSliceFrame.height) * 0.5);
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
    staticTimeline.totalTime(0.75);
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
