import test from "node:test";
import assert from "node:assert/strict";
import { BitmapFont, settings, Sprite, Texture } from "pixi.js-v7";
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
      { width: 1280, height: 720 },
      { random: () => 0.5 },
    );
    scene.addRandomSprites(2);
    const timelinesBeforeResize = gsap.globalTimeline
      .getChildren(false, false, true)
      .slice(baselineTimelines);
    const staticSprite = scene.children[1] as Sprite;
    const dynamicSprites = scene.children.slice(4) as Sprite[];

    timelinesBeforeResize[0].totalTime(0);
    scene.resize(800, 600);

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
    timelinesBeforeResize[0].totalTime(0.75);
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
