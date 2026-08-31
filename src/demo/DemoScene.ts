import { Container, Graphics, Sprite } from "pixi.js";
import { createGraphicsTest } from "./test/GraphicsTest.ts";
import { createSpriteTest } from "./test/SpriteTest.ts";
import { createTextTest } from "./test/TextTest.ts";
import { createBitmapTextTest } from "./test/BitmapTextTest.ts";
import { createVideoTest } from "./test/VideoTest.ts";

export {
  createGraphicsTest,
  createSpriteTest,
  createTextTest,
  createBitmapTextTest,
  createVideoTest,
};
export * from "./bitmapFonts.ts";
export * from "./sceneLifecycle.ts";

export function animateDemoScene(
  scene: Container,
  deltaMS: number,
  now = performance.now(),
): void {
  const graphics = scene.children[1];
  if (graphics instanceof Graphics) {
    graphics.pivot.x = graphics.width;
    graphics.pivot.y = graphics.height;
    graphics.x = graphics.width;
    graphics.y = graphics.height;
    graphics.rotation += deltaMS * 0.001;
  }

  const sprite = scene.children[2];

  if (sprite instanceof Sprite) {
    sprite.x = 640 + Math.sin(now / 500) * 180;
    sprite.y = 390 + Math.cos(now / 700) * 50;
  }

  (
    scene as Container & {
      update?: (deltaMS: number, now: number) => void;
    }
  ).update?.(deltaMS, now);
}
