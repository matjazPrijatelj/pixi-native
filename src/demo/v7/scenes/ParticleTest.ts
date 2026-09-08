import { Container } from "pixi.js-v7";
import { createMetricBitmapText } from "../bitmapFonts.ts";

export function createParticleTest(): Container {
  const scene = new Container();
  scene.addChild(
    createMetricBitmapText("PARTICLE EMITTER TEST  [9]  | PixiJS 7", 24),
  );
  return scene;
}
