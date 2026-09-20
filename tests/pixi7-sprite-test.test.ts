import test from "node:test";
import assert from "node:assert/strict";
import {
  BitmapFont,
  NineSlicePlane,
  settings,
  Sprite,
  Texture,
} from "pixi.js-v7";
import { gsap } from "gsap";
import {
  DYNAMIC_BITMAP_FONT_NAME,
  installDynamicBitmapTextFont,
} from "../src/demo/v7/bitmapFonts.ts";
import { createSpriteTest } from "../src/demo/v7/scenes/SpriteTest.ts";
import { NodeDOMAdapter } from "@pixi-native/core/runtime/NodeDOMAdapter.js";

test("PixiJS 7 Sprite timelines survive resize and keep advancing", () => {
  new NodeDOMAdapter({} as never).installPixi7(settings);
  installDynamicBitmapTextFont();
  const baselineTimelines = gsap.globalTimeline.getChildren(
    false,
    false,
    true,
  ).length;

  try {
    const scene = createSpriteTest(
      [Texture.WHITE, Texture.EMPTY, Texture.WHITE],
      Texture.WHITE,
      { width: 1280, height: 720 },
      { random: () => 0.5 },
    );
    scene.addRandomSprites(2);
    const timelinesBeforeResize = gsap.globalTimeline
      .getChildren(false, false, true)
      .slice(baselineTimelines);
    const nineSliceTimeline = timelinesBeforeResize.find(
      (timeline) => timeline.duration() === 2,
    );
    const staticTimeline = timelinesBeforeResize.find(
      (timeline) => timeline.duration() === 1.5,
    );
    const nineSliceFrame = scene.children.find(
      (child) => child instanceof NineSlicePlane,
    ) as NineSlicePlane;
    const sprites = scene.children.filter(
      (child): child is Sprite => child instanceof Sprite,
    );
    const staticSprite = sprites[0];
    const dynamicSprites = sprites.slice(-2);

    assert.ok(nineSliceFrame);
    assert.equal(nineSliceFrame.leftWidth, 16);
    assert.equal(nineSliceFrame.topHeight, 16);
    assert.equal(nineSliceFrame.rightWidth, 16);
    assert.equal(nineSliceFrame.bottomHeight, 16);
    assert.equal(nineSliceFrame.width, 320);
    assert.equal(nineSliceFrame.height, 180);

    assert.ok(nineSliceTimeline);
    assert.ok(staticTimeline);
    nineSliceTimeline.totalTime(1);
    assert.ok(nineSliceFrame.width > 320 && nineSliceFrame.width < 480);
    assert.ok(nineSliceFrame.height > 180 && nineSliceFrame.height < 270);

    staticTimeline.totalTime(0);
    scene.resize(800, 600);
    assert.equal(nineSliceFrame.x, (800 - nineSliceFrame.width) * 0.5);
    assert.equal(nineSliceFrame.y, (600 - nineSliceFrame.height) * 0.5);

    const timelinesAfterResize = gsap.globalTimeline
      .getChildren(false, false, true)
      .slice(baselineTimelines);
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

    scene.dispose();
    assert.equal(
      gsap.globalTimeline.getChildren(false, false, true).length,
      baselineTimelines,
    );
  } finally {
    gsap.ticker.sleep();
    BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
  }
});
