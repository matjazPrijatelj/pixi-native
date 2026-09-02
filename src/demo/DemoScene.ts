import { Container } from "pixi.js";
import { createGraphicsTest } from "./test/GraphicsTest.ts";
import { createSpriteTest } from "./test/SpriteTest.ts";
import { createTextTest } from "./test/TextTest.ts";
import { createBitmapTextTest } from "./test/BitmapTextTest.ts";
import { createVideoTest } from "./test/VideoTest.ts";
import { createAudioTest } from "./test/AudioTest.ts";
import { createRtpVideoTest } from "./test/RtpVideoTest.ts";
import { createRainSpriteTest } from "./test/RainSpriteTest.ts";
import { createParticleTest } from "./test/ParticleTest.ts";

export {
  createGraphicsTest,
  createSpriteTest,
  createTextTest,
  createBitmapTextTest,
  createVideoTest,
  createAudioTest,
  createRtpVideoTest,
  createRainSpriteTest,
  createParticleTest,
};
export type { AudioTestScene } from "./test/AudioTest.ts";
export type { SpriteTestScene } from "./test/SpriteTest.ts";
export type { RainSpriteTestScene } from "./test/RainSpriteTest.ts";
export * from "./bitmapFonts.ts";
export * from "./sceneLifecycle.ts";

export function animateDemoScene(
  scene: Container,
  deltaMS: number,
  now = performance.now(),
): void {
  (
    scene as Container & {
      update?: (deltaMS: number, now: number) => void;
    }
  ).update?.(deltaMS, now);
}
