import { fileURLToPath } from "node:url";
import { AnimatedSprite, Container, Rectangle, Texture, type Ticker } from "pixi.js";
import { Howl } from "../../pixi-node/audio/index.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";

const BATCH_SIZE = 2;
const INITIAL_DROP_COUNT = 4;
const TITLE_MARGIN = 96;
const MAX_UPDATE_MS = 100;
const ANIMATION_TICK_MS = 1000 / 60;
const FRAME_COLUMNS = 5;
const FRAME_ROWS = 6;
const FRAME_COUNT = FRAME_COLUMNS * FRAME_ROWS;
const RAIN_DROP_SOURCE = fileURLToPath(
    new URL("../../../assets/audio/rain-drop.wav", import.meta.url),
);

export interface RainSpriteTestBounds {
    readonly width: number;
    readonly height: number;
}

export interface RainSpriteTestScene extends DisposableDemoScene {
    handleKey(key: string | null, repeat?: number): boolean;
    getDropCount(): number;
    getLandingCount(): number;
    getFrameIndex(): number;
    update(deltaMs?: number): void;
    resize(width: number, height: number): void;
}

interface RainDrop {
    readonly sprite: AnimatedSprite;
    speed: number;
}

interface RainSpriteTestOptions {
    readonly random?: () => number;
}

function normalizeBounds(bounds: RainSpriteTestBounds): RainSpriteTestBounds {
    return {
        width: Math.max(1, bounds.width),
        height: Math.max(TITLE_MARGIN + 1, bounds.height),
    };
}

function randomBetween(random: () => number, minimum: number, maximum: number): number {
    return minimum + random() * Math.max(0, maximum - minimum);
}

export function createRainSpriteTest(
    dropTexture: Texture,
    initialBounds: RainSpriteTestBounds,
    options: RainSpriteTestOptions = {},
): RainSpriteTestScene {
    const random = options.random ?? Math.random;
    let bounds = normalizeBounds(initialBounds);
    const scene = new Container() as RainSpriteTestScene;
    const drops: RainDrop[] = [];
    const animationTicker = { deltaTime: 0 } as Ticker;
    const frameTextures = Array.from({ length: FRAME_COUNT }, (_, index) =>
        (() => {
            const column = index % FRAME_COLUMNS;
            const row = Math.floor(index / FRAME_COLUMNS);
            const left = Math.round((column * dropTexture.width) / FRAME_COLUMNS);
            const right = Math.round(((column + 1) * dropTexture.width) / FRAME_COLUMNS);
            const top = Math.round((row * dropTexture.height) / FRAME_ROWS);
            const bottom = Math.round(((row + 1) * dropTexture.height) / FRAME_ROWS);
            return new Texture({
                source: dropTexture.source,
                frame: new Rectangle(left, top, right - left, bottom - top),
            });
        })(),
    );
    const title = createMetricBitmapText(
        "RAIN SPRITE TEST  [8]  |  drops: 0  |  UP +2 / DOWN -2",
        24,
    );
    scene.addChild(title);

    let landingCount = 0;
    let muted = true;
    let rainSound: Howl | undefined;

    const getRainSound = (): Howl => {
        if (rainSound) return rainSound;
        rainSound = new Howl({
            src: [RAIN_DROP_SOURCE],
            volume: 0.65,
        });
        return rainSound;
    };

    const updateTitle = (): void => {
        title.text =
            `RAIN SPRITE TEST  [8]  |  drops: ${drops.length}` +
            `  |  UP +2 / DOWN -2  |  M: ${muted ? "unmute" : "mute"}`;
    };

    const handleLanding = (): void => {
        landingCount++;
        if (!muted) getRainSound().play();
    };

    const addDrop = (): void => {
        const sprite = new AnimatedSprite({
            textures: frameTextures,
            animationSpeed: 0.18,
            autoUpdate: false,
        });
        sprite.play();
        const size = randomBetween(random, 28, 58);
        sprite.width = size;
        sprite.height = size * 1.35;
        sprite.anchor.set(0.5);
        sprite.x = randomBetween(random, sprite.width * 0.5, bounds.width - sprite.width * 0.5);
        sprite.y = TITLE_MARGIN - sprite.height * 0.5;
        scene.addChild(sprite);
        drops.push({
            sprite,
            speed: randomBetween(random, 240, 420),
        });
    };

    const removeDrop = (): void => {
        const drop = drops.pop();
        if (!drop) return;
        scene.removeChild(drop.sprite);
        drop.sprite.stop();
        drop.sprite.destroy({ texture: false, textureSource: false });
    };

    scene.handleKey = (key, repeat = 0): boolean => {
        if (repeat) return false;
        if (key === "m") {
            muted = !muted;
            rainSound?.mute(muted);
            updateTitle();
            return true;
        }
        if (key !== "up" && key !== "down") return false;
        if (key === "up") {
            for (let index = 0; index < BATCH_SIZE; index++) addDrop();
        } else {
            for (let index = 0; index < BATCH_SIZE; index++) removeDrop();
        }
        updateTitle();
        return true;
    };

    scene.getDropCount = (): number => drops.length;
    scene.getLandingCount = (): number => landingCount;
    scene.getFrameIndex = (): number => drops[0]?.sprite.currentFrame ?? 0;

    scene.update = (deltaMs = 0): void => {
        const normalizedDeltaMs = Number.isFinite(deltaMs)
            ? Math.min(MAX_UPDATE_MS, Math.max(0, deltaMs))
            : 0;
        animationTicker.deltaTime = normalizedDeltaMs / ANIMATION_TICK_MS;
        for (const drop of drops) {
            drop.sprite.update(animationTicker);
            const top = TITLE_MARGIN - drop.sprite.height * 0.5;
            const bottom = bounds.height - drop.sprite.height * 0.5;
            drop.sprite.y += drop.speed * normalizedDeltaMs / 1000;
            if (drop.sprite.y >= bottom) {
                drop.sprite.y -= bottom - top;
                handleLanding();
            }
        }
    };

    scene.resize = (width: number, height: number): void => {
        bounds = normalizeBounds({ width, height });
        for (const drop of drops) {
            drop.sprite.x = Math.min(
                Math.max(drop.sprite.width * 0.5, drop.sprite.x),
                bounds.width - drop.sprite.width * 0.5,
            );
            const top = TITLE_MARGIN - drop.sprite.height * 0.5;
            const bottom = bounds.height - drop.sprite.height * 0.5;
            drop.sprite.y = Math.min(Math.max(top, drop.sprite.y), bottom);
        }
    };

    scene.dispose = (): void => {
        for (const drop of drops) {
            drop.sprite.stop();
            drop.sprite.destroy({ texture: false, textureSource: false });
        }
        drops.length = 0;
        for (const texture of frameTextures) texture.destroy(false);
        rainSound?.unload();
    };

    for (let index = 0; index < INITIAL_DROP_COUNT; index++) addDrop();
    updateTitle();
    scene.resize(initialBounds.width, initialBounds.height);
    return scene;
}
