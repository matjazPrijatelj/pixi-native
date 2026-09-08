import { AnimatedSprite, Container, Rectangle, Texture } from "pixi.js-v7";
import { createMetricBitmapText } from "../bitmapFonts.ts";
const FRAME_COLUMNS = 5;
const FRAME_ROWS = 6;
const FRAME_COUNT = FRAME_COLUMNS * FRAME_ROWS;
const TITLE_MARGIN = 96;
const FRAME_TIME_MS = 1000 / 60;
export interface RainSpriteTestScene7 {
  handleKey(key: string | null, repeat?: number): boolean;
  update(deltaMS: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}
interface RainDrop {
  readonly sprite: AnimatedSprite;
  readonly speed: number;
}
export function createRainSpriteTest(
  texture: Texture,
  initialBounds: { width: number; height: number },
): Container & RainSpriteTestScene7 {
  let bounds = { ...initialBounds };
  const scene = new Container() as Container & RainSpriteTestScene7;
  const drops: RainDrop[] = [];
  const title = createMetricBitmapText(
    "RAIN SPRITE TEST  [8] | drops: 0 | UP +2 / DOWN -2",
    24,
  );
  scene.addChild(title);
  const frames: Texture[] = [];
  for (let index = 0; index < FRAME_COUNT; index++) {
    const column = index % FRAME_COLUMNS;
    const row = Math.floor(index / FRAME_COLUMNS);
    frames.push(
      new Texture(
        texture.baseTexture,
        new Rectangle(
          Math.round((column * texture.width) / FRAME_COLUMNS),
          Math.round((row * texture.height) / FRAME_ROWS),
          Math.round(texture.width / FRAME_COLUMNS),
          Math.round(texture.height / FRAME_ROWS),
        ),
      ),
    );
  }
  const updateTitle = (): void => {
    title.text = `RAIN SPRITE TEST  [8] | drops: ${drops.length} | UP +2 / DOWN -2`;
  };
  const addDrop = (): void => {
    const sprite = new AnimatedSprite(frames);
    sprite.animationSpeed = 0.18;
    sprite.autoUpdate = false;
    sprite.play();
    sprite.anchor.set(0.5);
    sprite.width = 36;
    sprite.height = 52;
    sprite.position.set(
      30 + Math.random() * Math.max(1, bounds.width - 60),
      TITLE_MARGIN,
    );
    scene.addChild(sprite);
    drops.push({ sprite, speed: 240 + Math.random() * 180 });
  };
  const removeDrop = (): void => {
    const drop = drops.pop();
    if (!drop) return;
    scene.removeChild(drop.sprite);
    drop.sprite.stop();
    drop.sprite.destroy({ texture: false, baseTexture: false });
  };
  for (let index = 0; index < 4; index++) addDrop();
  scene.handleKey = (key, repeat = 0): boolean => {
    if (repeat || (key !== "up" && key !== "down")) return false;
    if (key === "up") {
      addDrop();
      addDrop();
    } else {
      removeDrop();
      removeDrop();
    }
    updateTitle();
    return true;
  };
  scene.update = (deltaMS): void => {
    const delta = Math.max(0, Math.min(100, deltaMS));
    for (const drop of drops) {
      drop.sprite.update(delta / FRAME_TIME_MS);
      const top = TITLE_MARGIN - drop.sprite.height / 2;
      const bottom = bounds.height - drop.sprite.height / 2;
      drop.sprite.y += (drop.speed * delta) / 1000;
      if (drop.sprite.y >= bottom) drop.sprite.y = top;
    }
  };
  scene.resize = (width, height): void => {
    bounds = { width, height };
  };
  scene.dispose = (): void => {
    for (const drop of drops) {
      drop.sprite.stop();
      drop.sprite.destroy({ texture: false, baseTexture: false });
    }
    drops.length = 0;
    for (const frame of frames) frame.destroy(false);
  };
  updateTitle();
  return scene;
}
