import { fileURLToPath } from "node:url";
import { Assets, Container, Texture, createApp } from "../../pixi-native/v7.ts";
import { createGraphicsTest } from "./scenes/GraphicsTest.ts";
import { createTextTest } from "./scenes/TextTest.ts";
import { createBitmapTextTest } from "./scenes/BitmapTextTest.ts";
import { createVideoTest, type Pixi7VideoSource } from "./scenes/VideoTest.ts";
import { createAudioTest } from "./scenes/AudioTest.ts";
import { createRtpVideoTest } from "./scenes/RtpVideoTest.ts";
import { createRainSpriteTest } from "./scenes/RainSpriteTest.ts";
import { createParticleTest } from "./scenes/ParticleTest.ts";
import { disposeDemoScene } from "./sceneLifecycle.ts";
import { FpsOverlay7 } from "./FpsOverlay.ts";
import { ParticleEmitter7 } from "./ParticleEmitter.ts";
import { destroyBitmapFonts, installDynamicBitmapTextFont, loadExternalBitmapFont } from "./bitmapFonts.ts";
import { createDemoLoop, isLoopDemoShortcut } from "../DemoLoop.ts";
import { DEMO_WINDOW_OPTIONS } from "../windowOptions.ts";

type Pixi7Scene = Container & { update?: (deltaMS: number, now: number) => void; dispose?: () => void; resize?: (width: number, height: number) => void; handleKey?: (key: string | null, repeat?: number) => boolean; addRandomSprites?: (count?: number) => number; removeRandomSprites?: (count?: number) => number };
type Pixi7SceneFactory = () => Pixi7Scene;
const { app, native, addDestroyListener } = await createApp({
    ...DEMO_WINDOW_OPTIONS,
    title: "PixiJS 7 Native Node WebGL",
});
// Load GSAP-backed scenes after the initializer installs native RAF globals.
const { createSpriteTest } = await import("./scenes/SpriteTest.ts");
const asset = (name: string): string => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
// Native v7 has no browser format-detection surface. PNG is selected below,
// so the detection plugins (including compressed-texture GL probes) are not
// needed and would otherwise inspect an unsupported data URI.
Assets.detections.length = 0;
await Assets.init({
    skipDetections: true,
    texturePreference: { format: ["png"] },
});
installDynamicBitmapTextFont();
await loadExternalBitmapFont(asset("bitmap-font/native-pixel.fnt"));
const videos: Pixi7VideoSource[] = [
    { file: "jerneja_en_doubleZero.mp4", source: asset("jerneja_en_doubleZero.mp4"), fps: 30 },
    { file: "Big_Buck_Bunny_1080_30s.mp4", source: asset("Big_Buck_Bunny_1080_30s.mp4"), fps: 24 },
    { file: "Sync_Check-720p30fps.mp4", source: asset("Sync_Check-720p30fps.mp4"), fps: 30 },
    { file: "Big_Buck_Bunny_1080_10s_5MB.mp4", source: asset("Big_Buck_Bunny_1080_10s_5MB.mp4"), fps: 60 },
    { file: "Big_Buck_Bunny_720_10s_20MB.mp4", source: asset("Big_Buck_Bunny_720_10s_20MB.mp4"), fps: 30 },
    { file: "cutting_orange_tuil_8s_3484kbps_2160p_59.94fps_h264.mp4", source: asset("cutting_orange_tuil_8s_3484kbps_2160p_59.94fps_h264.mp4"), fps: 60_000 / 1_001 },
    { file: "water_netflix_15000kbps_2160p_59.94fps_h264.mp4", source: asset("water_netflix_15000kbps_2160p_59.94fps_h264.mp4"), fps: 19_001 / 317 },
];
const [texture, batman, mario, rain, drumTexture] = await Promise.all(
    ["test-texture.png", "batman.png", "mario.png", "rain-drop-30.png", "drum-kit.png"]
        .map((name) => Assets.load(asset(name))),
) as [Texture, Texture, Texture, Texture, Texture];
const sceneFactories: Pixi7SceneFactory[] = [
    () => createGraphicsTest() as Pixi7Scene,
    () => createSpriteTest([texture, batman, mario], { width: native.canvas.width, height: native.canvas.height }) as Pixi7Scene,
    () => createTextTest() as Pixi7Scene,
    () => createBitmapTextTest() as Pixi7Scene,
    () => createVideoTest(videos, { width: native.canvas.width, height: native.canvas.height }) as Pixi7Scene,
    () => createAudioTest(drumTexture, { width: native.canvas.width, height: native.canvas.height }) as Pixi7Scene,
    () => createRtpVideoTest({ width: native.canvas.width, height: native.canvas.height }) as Pixi7Scene,
    () => createRainSpriteTest(rain, { width: native.canvas.width, height: native.canvas.height }) as Pixi7Scene,
    () => createParticleTest() as Pixi7Scene,
];
let sceneIndex = 0;
let activeScene = sceneFactories[sceneIndex]();
let shuttingDown = false;
app.stage.addChild(activeScene);
app.stage.sortableChildren = true;
const particleEmitter = new ParticleEmitter7(texture, { width: native.canvas.width, height: native.canvas.height });
particleEmitter.container.zIndex = 100;
app.stage.addChild(particleEmitter.container);
const fpsOverlay = new FpsOverlay7();
fpsOverlay.zIndex = 200;
app.stage.addChild(fpsOverlay);
fpsOverlay.alignRight(native.canvas.width);
activeScene.resize?.(native.canvas.width, native.canvas.height);
const selectScene = (nextIndex: number): void => {
    const normalized = (nextIndex + sceneFactories.length) % sceneFactories.length;
    if (normalized === sceneIndex) return;
    disposeDemoScene(activeScene);
    if (sceneIndex === 8) particleEmitter.setEnabled(false);
    sceneIndex = normalized;
    activeScene = sceneFactories[sceneIndex]();
    app.stage.addChild(activeScene);
    if (sceneIndex === 8) particleEmitter.setEnabled(true);
    activeScene.resize?.(native.canvas.width, native.canvas.height);
};
const demoLoop = createDemoLoop(selectScene, () => sceneIndex);
const normalizeKey = (key: string): string => {
    switch (key) {
        case "arrowup": return "up";
        case "arrowdown": return "down";
        case "arrowleft": return "left";
        case "arrowright": return "right";
        default: return key;
    }
};
globalThis.addEventListener("keydown", (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    const key = normalizeKey(String(event.key ?? "").toLowerCase());
    if (event.repeat) return;
    if (isLoopDemoShortcut(key)) {
        demoLoop.toggle();
        return;
    }
    if (key === "left" || key === "arrowleft") return selectScene(sceneIndex - 1);
    if (key === "right" || key === "arrowright") return selectScene(sceneIndex + 1);
    if (/^[1-9]$/.test(key)) return selectScene(Number(key) - 1);
    if (key === "tab") {
        particleEmitter.setEnabled(!particleEmitter.enabled);
        return;
    }
    if (activeScene.handleKey?.(key, 0)) return;
    if (key === "up") activeScene.addRandomSprites?.(10);
    if (key === "down") activeScene.removeRandomSprites?.(10);
});
globalThis.addEventListener("resize", () => {
    activeScene.resize?.(native.canvas.width, native.canvas.height);
    particleEmitter.resize(native.canvas.width, native.canvas.height);
    fpsOverlay.alignRight(native.canvas.width);
});
app.ticker.add((delta) => {
    activeScene.update?.(delta * (1000 / 60), performance.now());
    particleEmitter.update(app.ticker.deltaMS);
    fpsOverlay.tick(app.ticker.deltaMS);
});
addDestroyListener(() => {
    if (shuttingDown) return;
    shuttingDown = true;
    demoLoop.destroy();
    disposeDemoScene(activeScene);
    particleEmitter.destroy();
    fpsOverlay.destroy({ children: true });
    destroyBitmapFonts();
});
