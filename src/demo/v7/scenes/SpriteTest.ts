import { Container, Sprite, Texture } from "pixi.js-v7";
import { gsap } from "gsap";
import { createMetricBitmapText } from "../bitmapFonts.ts";

const DEFAULT_BATCH_SIZE = 10;
const TITLE_MARGIN = 90;

export interface SpriteTestBounds {
    width: number;
    height: number;
}

export interface SpriteTestScene7 {
    addRandomSprites(count?: number): number;
    removeRandomSprites(count?: number): number;
    getDynamicSpriteCount(): number;
    resize(width: number, height: number): void;
    update(deltaMS: number): void;
    dispose(): void;
}

interface AnimationTransform {
    x: number;
    y: number;
    rotation: number;
    scale: number;
}

interface DynamicSpriteLayout {
    readonly sprite: Sprite;
    readonly size: number;
    readonly baseScaleX: number;
    readonly baseScaleY: number;
    readonly transform: AnimationTransform;
}

interface AnimatedSpriteRecord extends DynamicSpriteLayout {
    timeline: gsap.core.Timeline;
}

interface StaticSpriteLayout {
    readonly sprite: Sprite;
    readonly horizontalPosition: number;
    readonly verticalOffset: number;
    readonly rotation: number;
    readonly duration: number;
    readonly baseScaleX: number;
    readonly baseScaleY: number;
    readonly transform: AnimationTransform;
}

interface SpriteTestOptions {
    readonly random?: () => number;
}

function normalizeBounds(bounds: SpriteTestBounds): SpriteTestBounds {
    return { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) };
}

function randomBetween(random: () => number, minimum: number, maximum: number): number {
    return minimum + random() * Math.max(0, maximum - minimum);
}

function positionFromProgress(progress: number, minimum: number, maximum: number): number {
    if (maximum <= minimum) return (minimum + maximum) * 0.5;
    return minimum + Math.max(0, Math.min(1, progress)) * (maximum - minimum);
}

export function createSpriteTest(
    textures: readonly [Texture, Texture, Texture],
    initialBounds: SpriteTestBounds,
    options: SpriteTestOptions = {},
): Container & SpriteTestScene7 {
    const random = options.random ?? Math.random;
    let bounds = normalizeBounds(initialBounds);
    const scene = new Container() as Container & SpriteTestScene7;
    const dynamicSprites: AnimatedSpriteRecord[] = [];
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
    const staticLayouts: StaticSpriteLayout[] = staticSprites.map((sprite, index) => ({
        sprite,
        horizontalPosition: [0.22, 0.5, 0.78][index],
        verticalOffset: -20 - index * 6,
        rotation: index % 2 === 0 ? 0.08 : -0.08,
        duration: 1.5 + index * 0.35,
        baseScaleX: sprite.scale.x,
        baseScaleY: sprite.scale.y,
        transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    }));
    scene.addChild(...staticSprites);

    const updateTitle = (): void => {
        title.text = `SPRITE + GSAP TEST  [2]  |  dynamic: ${dynamicSprites.length}  |  UP +10 / DOWN -10`;
    };
    const applyStaticAnimations = (): void => {
        const centerY = Math.max(TITLE_MARGIN + 160, bounds.height * 0.56);
        for (const layout of staticLayouts) {
            const { sprite, transform } = layout;
            sprite.position.set(
                bounds.width * layout.horizontalPosition,
                centerY + transform.y,
            );
            sprite.rotation = transform.rotation;
            sprite.scale.set(
                layout.baseScaleX * transform.scale,
                layout.baseScaleY * transform.scale,
            );
        }
    };
    const createStaticAnimation = (layout: StaticSpriteLayout): gsap.core.Timeline => {
        return gsap.timeline({
            repeat: -1,
            yoyo: true,
            defaults: { ease: "sine.inOut" },
            onUpdate: applyStaticAnimations,
        }).to(layout.transform, {
            y: layout.verticalOffset,
            rotation: layout.rotation,
            scale: 1.06,
            duration: layout.duration,
        }, 0);
    };
    const startStaticAnimations = (): void => {
        applyStaticAnimations();
        for (const layout of staticLayouts) {
            staticTimelines.push(createStaticAnimation(layout));
        }
    };
    const applyDynamicAnimation = (layout: DynamicSpriteLayout): void => {
        const { sprite, transform } = layout;
        const margin = Math.max(24, layout.size * transform.scale * 0.5);
        sprite.position.set(
            positionFromProgress(transform.x, margin, bounds.width - margin),
            positionFromProgress(
                transform.y,
                TITLE_MARGIN + margin,
                bounds.height - margin,
            ),
        );
        sprite.rotation = transform.rotation;
        sprite.scale.set(
            layout.baseScaleX * transform.scale,
            layout.baseScaleY * transform.scale,
        );
    };
    const createDynamicAnimation = (layout: DynamicSpriteLayout): gsap.core.Timeline => {
        return gsap.timeline({
            repeat: -1,
            yoyo: true,
            defaults: { ease: "sine.inOut" },
            onUpdate: () => applyDynamicAnimation(layout),
        }).to(layout.transform, {
                x: random(),
                y: random(),
                rotation: layout.transform.rotation + randomBetween(random, -Math.PI, Math.PI),
                duration: randomBetween(random, 1.8, 5),
            }, 0)
            .to(layout.transform, {
                scale: randomBetween(random, 0.85, 1.2),
                duration: randomBetween(random, 1.8, 5),
            }, 0);
    };
    const addRandomSprite = (): void => {
        const textureIndex = Math.min(textures.length - 1, Math.floor(random() * textures.length));
        const sprite = new Sprite(textures[textureIndex]);
        const size = randomBetween(random, 48, 140);
        sprite.width = size;
        sprite.height = size;
        sprite.anchor.set(0.5);
        const layout: DynamicSpriteLayout = {
            sprite,
            size,
            baseScaleX: sprite.scale.x,
            baseScaleY: sprite.scale.y,
            transform: {
                x: random(),
                y: random(),
                rotation: randomBetween(random, -0.35, 0.35),
                scale: 1,
            },
        };
        applyDynamicAnimation(layout);
        scene.addChild(sprite);
        dynamicSprites.push({ ...layout, timeline: createDynamicAnimation(layout) });
    };

    scene.addRandomSprites = (count = DEFAULT_BATCH_SIZE): number => {
        for (let index = 0; index < Math.max(0, Math.floor(count)); index++) addRandomSprite();
        updateTitle();
        return dynamicSprites.length;
    };
    scene.removeRandomSprites = (count = DEFAULT_BATCH_SIZE): number => {
        for (let index = 0; index < Math.max(0, Math.floor(count)); index++) {
            const record = dynamicSprites.pop();
            if (!record) break;
            record.timeline.kill();
            scene.removeChild(record.sprite);
            record.sprite.destroy({ texture: false, baseTexture: false });
        }
        updateTitle();
        return dynamicSprites.length;
    };
    scene.getDynamicSpriteCount = (): number => dynamicSprites.length;
    scene.resize = (width, height): void => {
        bounds = normalizeBounds({ width, height });
        applyStaticAnimations();
        for (const record of dynamicSprites) applyDynamicAnimation(record);
    };
    scene.update = (_deltaMS): void => undefined;
    scene.dispose = (): void => {
        for (const timeline of staticTimelines) timeline.kill();
        staticTimelines.length = 0;
        for (const record of dynamicSprites) record.timeline.kill();
        dynamicSprites.length = 0;
    };
    startStaticAnimations();
    return scene;
}
