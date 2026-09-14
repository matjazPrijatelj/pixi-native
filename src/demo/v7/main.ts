import { fileURLToPath } from "node:url";
import { Assets, Container, Sprite, Texture } from "pixi.js-v7";
import { createApp } from "@pixi-native/pixi7";
import { createGraphicsTest } from "./scenes/GraphicsTest.ts";
import { createTextTest } from "./scenes/TextTest.ts";
import { createBitmapTextTest } from "./scenes/BitmapTextTest.ts";
import { createVideoTest, type Pixi7VideoSource } from "./scenes/VideoTest.ts";
import { createAudioTest } from "./scenes/AudioTest.ts";
import { createRtpVideoTest } from "./scenes/RtpVideoTest.ts";
import { createRainSpriteTest } from "./scenes/RainSpriteTest.ts";
import { createParticleTest } from "./scenes/ParticleTest.ts";
import { disposeDemoScene } from "./sceneLifecycle.ts";
import { AutoToggleOverlay7, FpsOverlay7 } from "./FpsOverlay.ts";
import { ParticleEmitter7 } from "./ParticleEmitter.ts";
import {
  destroyBitmapFonts,
  installDynamicBitmapTextFont,
  loadExternalBitmapFont,
} from "./bitmapFonts.ts";
import {
  createDemoLoop,
  isAutoToggleShortcut,
  isLoopDemoShortcut,
  shouldSkipAutoScene,
} from "../DemoLoop.ts";
import {
  countCacheEntries,
  startMemoryDiagnostics,
} from "../memoryDiagnostics.ts";
import { resolveNativePlatformModules } from "@pixi-native/core/runtime/platformNative.js";
import { getNativeVideoMemoryStats } from "@pixi-native/core/video/NativeVideo.js";
import { DEMO_WINDOW_OPTIONS } from "../windowOptions.ts";
import { filterVideoAssets } from "../videoAssets.ts";

type Pixi7Scene = Container & {
  update?: (deltaMS: number, now: number) => void;
  dispose?: () => void;
  resize?: (width: number, height: number) => void;
  handleKey?: (key: string | null, repeat?: number) => boolean;
  addRandomSprites?: (count?: number) => number;
  removeRandomSprites?: (count?: number) => number;
};
type Pixi7SceneFactory = () => Pixi7Scene;
const { app, native, addDestroyListener, destroy } = await createApp({
  ...DEMO_WINDOW_OPTIONS,
  title: "PixiJS 7 Native Node WebGL",
});
// Load GSAP-backed scenes after the initializer installs native RAF globals.
const [{ createSpriteTest }, { gsap }, { installGsapModalBridge }] =
  await Promise.all([
    import("./scenes/SpriteTest.ts"),
    import("gsap"),
    import("../gsapModalBridge.ts"),
  ]);
installGsapModalBridge(native, gsap.ticker, addDestroyListener);
const asset = (name: string): string =>
  fileURLToPath(new URL(`../assets/${name}`, import.meta.url));
installDynamicBitmapTextFont();
await loadExternalBitmapFont(asset("bitmap-font/native-pixel.fnt"));
const videos: Pixi7VideoSource[] = filterVideoAssets(
  [
    {
      file: "jerneja_en_doubleZero.mp4",
      source: asset("jerneja_en_doubleZero.mp4"),
      fps: 30,
    },
    {
      file: "Big_Buck_Bunny_1080_30s.mp4",
      source: asset("Big_Buck_Bunny_1080_30s.mp4"),
      fps: 24,
    },
    {
      file: "Sync_Check-720p30fps.mp4",
      source: asset("Sync_Check-720p30fps.mp4"),
      fps: 30,
    },
    {
      file: "Big_Buck_Bunny_720_10s_20MB.mp4",
      source: asset("Big_Buck_Bunny_720_10s_20MB.mp4"),
      fps: 30,
    },
    {
      file: "Big_Buck_Bunny_1080_10s_5MB.mp4",
      source: asset("Big_Buck_Bunny_1080_10s_5MB.mp4"),
      fps: 60,
    },
    {
      file: "cutting_orange_tuil_8s_3484kbps_2160p_59.94fps_h264.mp4",
      source: asset("cutting_orange_tuil_8s_3484kbps_2160p_59.94fps_h264.mp4"),
      fps: 60_000 / 1_001,
    },
    {
      file: "water_netflix_15000kbps_2160p_59.94fps_h264.mp4",
      source: asset("water_netflix_15000kbps_2160p_59.94fps_h264.mp4"),
      fps: 19_001 / 317,
    },
  ],
  (file) => asset(file),
);
const [texture, batman, mario, rain, drumTexture, backgroundTexture] =
  (await Promise.all(
    [
      "test-texture.png",
      "batman.png",
      "mario.png",
      "rain-drop-30.png",
      "drum-kit.png",
      "pixi-hero.png",
    ].map((name) => Assets.load(asset(name))),
  )) as [Texture, Texture, Texture, Texture, Texture, Texture];
const background = new Sprite(backgroundTexture);
background.anchor.set(0.5);
background.alpha = 0.28;
background.zIndex = -100;
const resizeBackground = (): void => {
  const scale = Math.max(
    native.canvas.width / background.texture.width,
    native.canvas.height / background.texture.height,
  );
  background.position.set(native.canvas.width / 2, native.canvas.height / 2);
  background.scale.set(scale);
};
resizeBackground();
app.stage.addChild(background);
const sceneFactories: Pixi7SceneFactory[] = [
  () => createGraphicsTest() as Pixi7Scene,
  () =>
    createSpriteTest([texture, batman, mario], {
      width: native.canvas.width,
      height: native.canvas.height,
    }) as Pixi7Scene,
  () => createTextTest() as Pixi7Scene,
  () => createBitmapTextTest() as Pixi7Scene,
  () =>
    createVideoTest(
      videos,
      { width: native.canvas.width, height: native.canvas.height },
      asset("transparent-video/video_combined_0.5.mp4"),
    ) as Pixi7Scene,
  () =>
    createAudioTest(drumTexture, {
      width: native.canvas.width,
      height: native.canvas.height,
    }) as Pixi7Scene,
  () =>
    createRtpVideoTest({
      width: native.canvas.width,
      height: native.canvas.height,
    }) as Pixi7Scene,
  () =>
    createRainSpriteTest(rain, {
      width: native.canvas.width,
      height: native.canvas.height,
    }) as Pixi7Scene,
  () => createParticleTest() as Pixi7Scene,
];
const sceneNames = [
  "graphics",
  "sprite-gsap",
  "text",
  "bitmap-text",
  "video",
  "audio",
  "rtp-video",
  "rain",
  "particles",
];

const requestedMemoryScenes = process.env.MEMORY_TEST_SCENES
  ?.split(/[,\s]+/u)
  .map((name) => name.trim())
  .filter(Boolean);
if (requestedMemoryScenes?.length) {
  const requested = new Set(requestedMemoryScenes);
  const selected = sceneNames
    .map((name, index) => ({ name, factory: sceneFactories[index] }))
    .filter(({ name }) => requested.has(name) && name !== "rtp-video");
  if (selected.length === 0) {
    throw new Error(
      `MEMORY_TEST_SCENES did not match a testable scene: ${requestedMemoryScenes.join(", ")}`,
    );
  }
  sceneFactories.length = 0;
  sceneNames.length = 0;
  for (const selectedScene of selected) {
    sceneFactories.push(selectedScene.factory);
    sceneNames.push(selectedScene.name);
  }
  console.warn(`MEMORY_TEST_SCENES: ${sceneNames.join(" -> ")}`);
}

let sceneIndex = 0;
let activeScene = sceneFactories[sceneIndex]();
let shuttingDown = false;
app.stage.addChild(activeScene);
app.stage.sortableChildren = true;
const particleEmitter = new ParticleEmitter7(texture, {
  width: native.canvas.width,
  height: native.canvas.height,
});
particleEmitter.container.zIndex = 100;
app.stage.addChild(particleEmitter.container);
const fpsOverlay = new FpsOverlay7();
fpsOverlay.zIndex = 200;
app.stage.addChild(fpsOverlay);
fpsOverlay.alignRight(native.canvas.width);
const autoToggleOverlay = new AutoToggleOverlay7(true);
autoToggleOverlay.zIndex = 200;
app.stage.addChild(autoToggleOverlay);
autoToggleOverlay.alignBottomLeft(native.canvas.height);

const memoryDiagnostics = startMemoryDiagnostics(() => [
  activeScene,
  particleEmitter.container,
  fpsOverlay,
  background,
], {
  extra: () => ({
    gsapTweens: gsap.globalTimeline.getChildren(true, true, false).length,
    gsapTimelines: gsap.globalTimeline.getChildren(false, false, true).length,
    pixiAssetCache: countCacheEntries(Assets.cache),
    ...getNativeVideoMemoryStats(),
  }),
  scene: () => ({ index: sceneIndex, name: sceneNames[sceneIndex] ?? "unknown" }),
  runtime: () => {
    const modules = resolveNativePlatformModules();
    return {
      backend: "webgl7",
      target: modules.target,
      gpuModule: modules.gpuModule,
      windowModule: modules.windowModule,
      videoModule: modules.videoModule,
      audioBinding: modules.audioBinding ?? "",
    };
  },
});
activeScene.resize?.(native.canvas.width, native.canvas.height);
const waitForGpuSceneResources = async (): Promise<void> => {
  // WebGL has no queue completion promise; keep the transition phases aligned
  // with the asynchronous PixiJS 8 lifecycle without forcing a blocking finish.
  await Promise.resolve();
};

const waitForNativeVideoShutdown = async (): Promise<void> => {
  const deadline = performance.now() + 2_000;
  while (
    getNativeVideoMemoryStats().nativeVideoPendingDecoderShutdowns > 0 &&
    performance.now() < deadline
  ) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
};

let sceneTransitioning = false;
const selectScene = async (nextIndex: number): Promise<void> => {
  const normalized =
    (nextIndex + sceneFactories.length) % sceneFactories.length;
  if (normalized === sceneIndex || sceneTransitioning) return;
  sceneTransitioning = true;
  try {
    await memoryDiagnostics.sample("scene-exit:before");
    await waitForGpuSceneResources();
    disposeDemoScene(activeScene);
    await memoryDiagnostics.sample("scene-exit:after");
    if (sceneNames[sceneIndex] === "particles") {
      particleEmitter.setEnabled(false);
    }
    sceneIndex = normalized;
    activeScene = sceneFactories[sceneIndex]();
    app.stage.addChild(activeScene);
    if (sceneNames[sceneIndex] === "particles") {
      particleEmitter.setEnabled(true);
    }
    activeScene.resize?.(native.canvas.width, native.canvas.height);
    requestAnimationFrame(() => {
      void waitForGpuSceneResources().then(() =>
        memoryDiagnostics.sceneEntry("scene-entry:rendered"),
      );
    });
  } finally {
    sceneTransitioning = false;
  }
};
const demoLoop = createDemoLoop(() => {
  let nextIndex = (sceneIndex + 1) % sceneFactories.length;
  while (shouldSkipAutoScene(sceneNames[nextIndex])) {
    nextIndex = (nextIndex + 1) % sceneFactories.length;
  }
  void selectScene(nextIndex);
}, (enabled) => {
  autoToggleOverlay.setEnabled(enabled);
  autoToggleOverlay.alignBottomLeft(native.canvas.height);
  void memoryDiagnostics.sample(`auto-scenes:${enabled ? "enabled" : "disabled"}`);
});
const normalizeKey = (key: string): string => {
  switch (key) {
    case "arrowup":
      return "up";
    case "arrowdown":
      return "down";
    case "arrowleft":
      return "left";
    case "arrowright":
      return "right";
    default:
      return key;
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
  if (isAutoToggleShortcut(key, event.repeat, event.code)) {
    demoLoop.toggle();
    console.warn(`AUTO_SCENES toggled by Space: ${demoLoop.enabled}`);
    return;
  }
  if (key === "left" || key === "arrowleft") {
    void selectScene(sceneIndex - 1);
    return;
  }
  if (key === "right" || key === "arrowright")
    return void selectScene(sceneIndex + 1);
  if (/^[1-9]$/.test(key)) return void selectScene(Number(key) - 1);
  if (key === "tab") {
    particleEmitter.setEnabled(!particleEmitter.enabled);
    return;
  }
  if (key === "delete") {
    void memoryDiagnostics.collect();
    return;
  }
  if (activeScene.handleKey?.(key, 0)) return;
  if (key === "up") activeScene.addRandomSprites?.(10);
  if (key === "down") activeScene.removeRandomSprites?.(10);
});
globalThis.addEventListener("resize", () => {
  resizeBackground();
  activeScene.resize?.(native.canvas.width, native.canvas.height);
  particleEmitter.resize(native.canvas.width, native.canvas.height);
  fpsOverlay.alignRight(native.canvas.width);
  autoToggleOverlay.alignBottomLeft(native.canvas.height);
});
app.ticker.add((delta) => {
  if (!sceneTransitioning) {
    activeScene.update?.(delta * (1000 / 60), performance.now());
  }
  particleEmitter.update(app.ticker.deltaMS);
  fpsOverlay.tick(app.ticker.deltaMS);
});
addDestroyListener(async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  demoLoop.destroy();
  disposeDemoScene(activeScene);
  await waitForNativeVideoShutdown();
  await memoryDiagnostics.sample("shutdown:after-video");
  memoryDiagnostics.stop();
  particleEmitter.destroy();
  fpsOverlay.destroy({ children: true });
  app.stage.removeChild(autoToggleOverlay);
  autoToggleOverlay.destroy({ children: true });
  destroyBitmapFonts();
  app.stage.removeChild(background);
  background.destroy();
  await Assets.unload(asset("pixi-hero.png"));
});

const isolationDurationMs = Number(process.env.MEMORY_ISOLATION_DURATION_MS);
if (Number.isFinite(isolationDurationMs) && isolationDurationMs > 0) {
  setTimeout(() => {
    void destroy().then(() => process.exit(0));
  }, isolationDurationMs).unref?.();
}
