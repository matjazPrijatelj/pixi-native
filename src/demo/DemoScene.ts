import { Container, Graphics, Sprite } from "pixi.js";
import { createGraphicsTest } from "./test/GraphicsTest.ts";
import { createSpriteTest } from "./test/SpriteTest.ts";
import { createTextTest } from "./test/TextTest.ts";
import { createVideoTest } from "./test/VideoTest.ts";

export { createGraphicsTest, createSpriteTest, createTextTest, createVideoTest };

export function animateDemoScene(scene: Container, deltaMS: number, now = performance.now()): void {
    const graphics = scene.getChildAt(1);
    if (graphics instanceof Graphics) graphics.rotation += deltaMS * 0.001;
    const sprite = scene.getChildAt(2);
    if (sprite instanceof Sprite) {
        sprite.x = 640 + Math.sin(now / 500) * 180;
        sprite.y = 390 + Math.cos(now / 700) * 50;
    }
}
