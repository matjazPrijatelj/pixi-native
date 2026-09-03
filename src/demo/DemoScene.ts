import { Container } from "pixi.js";
import { createGraphicsTest } from "./scenes/GraphicsTest.ts";
import { createSpriteTest } from "./scenes/SpriteTest.ts";
import { createTextTest } from "./scenes/TextTest.ts";
import { createBitmapTextTest } from "./scenes/BitmapTextTest.ts";
import { createVideoTest } from "./scenes/VideoTest.ts";
import { createAudioTest } from "./scenes/AudioTest.ts";
import { createRtpVideoTest } from "./scenes/RtpVideoTest.ts";
import { createRainSpriteTest } from "./scenes/RainSpriteTest.ts";
import { createParticleTest } from "./scenes/ParticleTest.ts";

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
export type { AudioTestScene } from "./scenes/AudioTest.ts";
export type { SpriteTestScene } from "./scenes/SpriteTest.ts";
export type { RainSpriteTestScene } from "./scenes/RainSpriteTest.ts";
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
