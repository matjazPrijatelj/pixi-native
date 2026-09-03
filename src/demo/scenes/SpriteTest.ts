import { Container, Sprite, Texture } from "pixi.js";
import { gsap } from "gsap";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";

const DEFAULT_BATCH_SIZE = 10;
const TITLE_MARGIN = 90;

export interface SpriteTestBounds {
  width: number;
  height: number;
}

export interface SpriteTestScene extends DisposableDemoScene {
  addRandomSprites(count?: number): number;
  removeRandomSprites(count?: number): number;
  getDynamicSpriteCount(): number;
  resize(width: number, height: number): void;
}

interface AnimatedSprite {
  readonly sprite: Sprite;
  timeline: gsap.core.Timeline;
}

interface SpriteTestOptions {
  readonly random?: () => number;
}

function normalizeBounds(bounds: SpriteTestBounds): SpriteTestBounds {
  return {
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

function randomBetween(
  random: () => number,
  minimum: number,
  maximum: number,
): number {
  return minimum + random() * Math.max(0, maximum - minimum);
}

export function createSpriteTest(
  textures: readonly [Texture, Texture, Texture],
  initialBounds: SpriteTestBounds,
  options: SpriteTestOptions = {},
): SpriteTestScene {
  const random = options.random ?? Math.random;
  let bounds = normalizeBounds(initialBounds);
  const scene = new Container() as SpriteTestScene;
  scene.useRenderGroup = false;
  const dynamicSprites: AnimatedSprite[] = [];
  const staticTimelines: gsap.core.Timeline[] = [];

  const title = createMetricBitmapText(
    "SPRITE + GSAP TEST  [2]  |  dynamic: 0  |  UP +10 / DOWN -10",
    24,
  );
  scene.addChild(title);

  const textureSprite = new Sprite(textures[0]);
  textureSprite.width = 230;
  textureSprite.height = 230;
  textureSprite.anchor.set(0.5);

  const batmanSprite = new Sprite(textures[1]);
  batmanSprite.width = 300;
  batmanSprite.height = 300;
  batmanSprite.anchor.set(0.5);

  const marioSprite = new Sprite(textures[2]);
  marioSprite.width = 150;
  marioSprite.height = 150;
  marioSprite.anchor.set(0.5);

  const staticSprites = [batmanSprite, textureSprite, marioSprite];
  const staticBaseScales = staticSprites.map((sprite) => ({
    x: sprite.scale.x,
    y: sprite.scale.y,
  }));
  scene.addChild(...staticSprites);

  const updateTitle = (): void => {
    title.text =
      `SPRITE + GSAP TEST  [2]  |  dynamic: ${dynamicSprites.length}` +
      "  |  UP +10 / DOWN -10";
  };

  const positionStaticSprites = (): void => {
    const centerY = Math.max(TITLE_MARGIN + 160, bounds.height * 0.56);
    staticSprites.forEach((sprite, index) => {
      sprite.scale.set(staticBaseScales[index].x, staticBaseScales[index].y);
      sprite.rotation = 0;
    });
    batmanSprite.position.set(bounds.width * 0.22, centerY);
    textureSprite.position.set(bounds.width * 0.5, centerY);
    marioSprite.position.set(bounds.width * 0.78, centerY);
  };

  const createStaticAnimation = (
    sprite: Sprite,
    index: number,
  ): gsap.core.Timeline => {
    const startY = sprite.y;
    const startScaleX = sprite.scale.x;
    const startScaleY = sprite.scale.y;
    return gsap
      .timeline({
        repeat: -1,
        yoyo: true,
        defaults: { ease: "sine.inOut" },
      })
      .to(
        sprite,
        {
          y: startY - 20 - index * 6,
          rotation: index % 2 === 0 ? 0.08 : -0.08,
          duration: 1.5 + index * 0.35,
        },
        0,
      )
      .to(
        sprite.scale,
        {
          x: startScaleX * 1.06,
          y: startScaleY * 1.06,
          duration: 1.5 + index * 0.35,
        },
        0,
      );
  };

  const restartStaticAnimations = (): void => {
    for (const timeline of staticTimelines) timeline.kill();
    staticTimelines.length = 0;
    positionStaticSprites();
    staticSprites.forEach((sprite, index) => {
      staticTimelines.push(createStaticAnimation(sprite, index));
    });
  };

  const createDynamicAnimation = (sprite: Sprite): gsap.core.Timeline => {
    const margin = Math.max(24, sprite.width * 0.5);
    const targetX = randomBetween(random, margin, bounds.width - margin);
    const targetY = randomBetween(
      random,
      TITLE_MARGIN + margin,
      bounds.height - margin,
    );
    const targetScale = sprite.scale.x * randomBetween(random, 0.85, 1.2);
    return gsap
      .timeline({
        repeat: -1,
        yoyo: true,
        defaults: { ease: "sine.inOut" },
      })
      .to(
        sprite,
        {
          x: targetX,
          y: targetY,
          rotation: sprite.rotation + randomBetween(random, -Math.PI, Math.PI),
          duration: randomBetween(random, 1.8, 5),
        },
        0,
      )
      .to(
        sprite.scale,
        {
          x: targetScale,
          y: targetScale,
          duration: randomBetween(random, 1.8, 5),
        },
        0,
      );
  };

  const addRandomSprite = (): void => {
    const textureIndex = Math.min(
      textures.length - 1,
      Math.floor(random() * textures.length),
    );
    const sprite = new Sprite(textures[textureIndex]);
    const size = randomBetween(random, 48, 140);
    const halfSize = size * 0.5;
    sprite.width = size;
    sprite.height = size;
    sprite.anchor.set(0.5);
    sprite.position.set(
      randomBetween(random, halfSize, bounds.width - halfSize),
      randomBetween(random, TITLE_MARGIN + halfSize, bounds.height - halfSize),
    );
    sprite.rotation = randomBetween(random, -0.35, 0.35);
    scene.addChild(sprite);
    dynamicSprites.push({
      sprite,
      timeline: createDynamicAnimation(sprite),
    });
  };

  scene.addRandomSprites = (count = DEFAULT_BATCH_SIZE): number => {
    const normalizedCount = Math.max(0, Math.floor(count));
    for (let index = 0; index < normalizedCount; index++) {
      addRandomSprite();
    }
    updateTitle();
    return dynamicSprites.length;
  };

  scene.removeRandomSprites = (count = DEFAULT_BATCH_SIZE): number => {
    const normalizedCount = Math.max(0, Math.floor(count));
    for (let index = 0; index < normalizedCount; index++) {
      const record = dynamicSprites.pop();
      if (!record) break;
      record.timeline.kill();
      scene.removeChild(record.sprite);
      record.sprite.destroy({ texture: false, textureSource: false });
    }
    updateTitle();
    return dynamicSprites.length;
  };

  scene.getDynamicSpriteCount = (): number => dynamicSprites.length;

  scene.resize = (width: number, height: number): void => {
    bounds = normalizeBounds({ width, height });
    restartStaticAnimations();
    for (const record of dynamicSprites) {
      record.timeline.kill();
      record.sprite.x = Math.min(Math.max(0, record.sprite.x), bounds.width);
      record.sprite.y = Math.min(
        Math.max(TITLE_MARGIN, record.sprite.y),
        bounds.height,
      );
      record.timeline = createDynamicAnimation(record.sprite);
    }
  };

  scene.dispose = (): void => {
    for (const timeline of staticTimelines) timeline.kill();
    staticTimelines.length = 0;
    for (const record of dynamicSprites) record.timeline.kill();
    dynamicSprites.length = 0;
  };

  restartStaticAnimations();
  return scene;
}
