import { Container, Graphics } from "pixi.js";
import { createGraphicsTest } from "./test/GraphicsTest.ts";
import { createSpriteTest } from "./test/SpriteTest.ts";
import { createTextTest } from "./test/TextTest.ts";
import { createBitmapTextTest } from "./test/BitmapTextTest.ts";
import { createVideoTest } from "./test/VideoTest.ts";
import { createAudioTest } from "./test/AudioTest.ts";

export {
  createGraphicsTest,
  createSpriteTest,
  createTextTest,
  createBitmapTextTest,
  createVideoTest,
  createAudioTest,
};
export type { AudioTestScene } from "./test/AudioTest.ts";
export type { SpriteTestScene } from "./test/SpriteTest.ts";
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

  (
    scene as Container & {
      update?: (deltaMS: number, now: number) => void;
    }
  ).update?.(deltaMS, now);
}
