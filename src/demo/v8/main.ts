import { fileURLToPath } from "node:url";
import type { Texture } from "pixi.js";
import type { SpriteTestScene } from "./scenes/SpriteTest.ts";
import type { AudioTestScene } from "./scenes/AudioTest.ts";
import type { RainSpriteTestScene } from "./scenes/RainSpriteTest.ts";
import type { VideoTestScene } from "./scenes/VideoTest.ts";
import { createDemoLoop, isLoopDemoShortcut } from "../DemoLoop.ts";
import { DEMO_WINDOW_OPTIONS } from "../windowOptions.ts";
import { filterVideoAssets } from "../videoAssets.ts";

if (!(globalThis as any).navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Node Native WebGPU" },
    configurable: true,
  });
}
const { Assets, BitmapFont } = await import("pixi.js");
const { createApp } = await import("@pixi-native/pixi8");
const backend = process.argv[2];
if (backend !== "webgpu" && backend !== "webgl") {
  throw new Error(
    "Choose a renderer with `pnpm dev:webgpu` or `pnpm dev:webgl`",
  );
}
const { app, native, destroy, addDestroyListener } = await createApp({
  ...DEMO_WINDOW_OPTIONS,
  backend,
});
const [{ gsap }, { installGsapModalBridge }] = await Promise.all([
  import("gsap"),
  import("../gsapModalBridge.ts"),
]);
installGsapModalBridge(native, gsap.ticker, addDestroyListener);
const { supportsNativeVideo } = await import(
  "@pixi-native/core/runtime/platform.js"
);
const {
  animateDemoScene,
  createGraphicsTest,
  createBitmapTextTest,
  createSpriteTest,
  createTextTest,
  createVideoTest,
  createAudioTest,
  createRtpVideoTest,
  createRainSpriteTest,
  createParticleTest,
  disposeDemoScene,
  DYNAMIC_BITMAP_FONT_NAME,
  installDynamicBitmapTextFont,
} = await import("./DemoScene.ts");

const { FpsOverlay } = await import("./FpsOverlay.ts");
const { ParticleEmitter } = await import("./ParticleEmitter.ts");
const { Howler } = await import("@pixi-native/core/audio");
const {
  getSceneIndexForKey,
  getSpriteCountDeltaForKey,
  getVideoIndexForKey,
  isReloadShortcut,
} = await import("./sceneNavigation.ts");

const supportsVideo =
  (native.backend === "webgpu" || native.backend === "webgl") &&
  supportsNativeVideo(process.platform);

const texturePaths = ["test-texture.png", "batman.png", "mario.png"].map(
  (file) => fileURLToPath(new URL(`../assets/${file}`, import.meta.url)),
);
const bitmapFontPath = fileURLToPath(
  new URL("../assets/bitmap-font/native-pixel.fnt", import.meta.url),
);
const drumTexturePath = fileURLToPath(
  new URL("../assets/drum-kit.png", import.meta.url),
);
const rainDropTexturePath = fileURLToPath(
  new URL("../assets/rain-drop-30.png", import.meta.url),
);
const transparentVideoPath = fileURLToPath(
  new URL(
    "../assets/transparent-video/video_combined_0.5.mp4",
    import.meta.url,
  ),
);

installDynamicBitmapTextFont();
await Assets.load(bitmapFontPath);
const spriteTextures = (await Promise.all(
  texturePaths.map((path) => Assets.load(path)),
)) as [Texture, Texture, Texture];
const drumTexture = await Assets.load(drumTexturePath);
const rainDropTexture = await Assets.load(rainDropTexturePath);

const videos = [
  { file: "jerneja_en_doubleZero.mp4", fps: 30 },
  { file: "Big_Buck_Bunny_1080_30s.mp4", fps: 24 },
  { file: "Sync_Check-720p30fps.mp4", fps: 30 },
  { file: "Big_Buck_Bunny_1080_10s_5MB.mp4", fps: 60 },
  { file: "Big_Buck_Bunny_720_10s_20MB.mp4", fps: 30 },
  {
    file: "cutting_orange_tuil_8s_3484kbps_2160p_59.94fps_h264.mp4",
    fps: 60_000 / 1_001,
  },
  {
    file: "water_netflix_15000kbps_2160p_59.94fps_h264.mp4",
    fps: 19_001 / 317,
  },
];

const videoPaths = filterVideoAssets(videos, (file) =>
  fileURLToPath(new URL(`../assets/${file}`, import.meta.url)),
).map(({ file }) => fileURLToPath(new URL(`../assets/${file}`, import.meta.url)));
const availableVideos = videos.filter((_video) =>
  videoPaths.includes(
    fileURLToPath(new URL(`../assets/${_video.file}`, import.meta.url)),
  ),
);
const eventVideoSources = videos
  .map(({ file, fps }) => ({
    file,
    fps,
    source: fileURLToPath(new URL(`../assets/${file}`, import.meta.url)),
  }))
  .filter(({ source }) => videoPaths.includes(source))
  .filter(({ fps }) => Math.abs(fps - 30) < 0.001);

let videoIndex = 0;

const scenes: Array<() => ReturnType<typeof createGraphicsTest>> = [
  () => createGraphicsTest(),
  () =>
    createSpriteTest(spriteTextures, {
      width: native.canvas.width,
      height: native.canvas.height,
    }),
  () => createTextTest(),
  () => createBitmapTextTest(),
];

const videoSceneIndex =
  supportsVideo && availableVideos.length > 0 ? scenes.length : null;

if (videoSceneIndex !== null) {
  scenes.push(() =>
    createVideoTest(
      videoPaths[videoIndex],
      { width: native.canvas.width, height: native.canvas.height },
      availableVideos[videoIndex].file,
      availableVideos[videoIndex].fps,
      eventVideoSources,
      transparentVideoPath,
    ),
  );
}

scenes.push(() =>
  createAudioTest(drumTexture, {
    width: native.canvas.width,
    height: native.canvas.height,
  }),
);

if (supportsVideo) {
  scenes.push(() =>
    createRtpVideoTest({
      width: native.canvas.width,
      height: native.canvas.height,
    }),
  );
}

scenes.push(() =>
  createRainSpriteTest(rainDropTexture, {
    width: native.canvas.width,
    height: native.canvas.height,
  }),
);

const particleSceneIndex = scenes.length;
scenes.push(() => createParticleTest());

let index = 1;
let scene = scenes[index]();

const prepareScene = (nextScene: typeof scene): typeof scene => {
  // Keep scene-owned batches isolated so destroying one scene cannot reuse its
  // WebGL instruction set or pooled geometry for the next scene.
  const sceneOptions = nextScene as typeof nextScene & {
    useRenderGroup?: boolean;
  };
  if (sceneOptions.useRenderGroup !== false) nextScene.enableRenderGroup();
  return nextScene;
};

scene = prepareScene(scene);
app.stage.sortableChildren = true;
scene.zIndex = 0;
app.stage.addChild(scene);
const particleEmitter = new ParticleEmitter(spriteTextures[0], {
  width: native.canvas.width,
  height: native.canvas.height,
});
app.stage.addChild(particleEmitter.container);
particleEmitter.container.zIndex = 100;
const fpsOverlay = new FpsOverlay();
app.stage.addChild(fpsOverlay);
fpsOverlay.zIndex = 200;
fpsOverlay.alignRight(native.canvas.width);

const selectScene = (nextIndex: number): void => {
  if (nextIndex === index) return;
  disposeDemoScene(scene);
  if (index === particleSceneIndex) particleEmitter.setEnabled(false);
  index = nextIndex;
  scene = prepareScene(scenes[index]());
  app.stage.addChild(scene);
  if (index === particleSceneIndex) particleEmitter.setEnabled(true);
};

const demoLoop = createDemoLoop(selectScene, () => index);
addDestroyListener(() => demoLoop.destroy());

const selectVideo = (nextVideoIndex: number): void => {
  if (index !== videoSceneIndex || nextVideoIndex === videoIndex) return;
  disposeDemoScene(scene);
  videoIndex = nextVideoIndex;
  scene = prepareScene(scenes[index]());
  app.stage.addChild(scene);
};

const resizeActiveScene = (): void => {
  const resizable = scene as typeof scene & {
    resize?: (width: number, height: number) => void;
  };
  resizable.resize?.(native.canvas.width, native.canvas.height);
  particleEmitter.resize(native.canvas.width, native.canvas.height);
  fpsOverlay.alignRight(native.canvas.width);
};

globalThis.addEventListener("resize", resizeActiveScene);

let ctrlDown = false;
globalThis.addEventListener("keydown", (rawEvent) => {
  const event = rawEvent as KeyboardEvent;
  if (event.key === "Control") {
    ctrlDown = true;
    return;
  }

  if (isLoopDemoShortcut(event.key, event.repeat)) {
    demoLoop.toggle();
    return;
  }

  if (String(event.key ?? "").toLowerCase() === "tab" && !event.repeat) {
    particleEmitter.setEnabled(!particleEmitter.enabled);
    return;
  }

  if (isReloadShortcut(event.key, event.ctrlKey, ctrlDown, event.repeat)) {
    console.warn("Restarting...");
    void restartApp();
    return;
  }

  const audioScene = scene as unknown as Partial<AudioTestScene>;
  if (audioScene.handleKey?.(event.key, Number(event.repeat))) return;

  const rainScene = scene as unknown as Partial<RainSpriteTestScene>;
  if (rainScene.handleKey?.(event.key, Number(event.repeat))) return;

  const videoScene = scene as unknown as Partial<VideoTestScene>;
  if (videoScene.handleKey?.(event.key, Number(event.repeat))) return;

  const spriteScene = scene as unknown as Partial<SpriteTestScene>;
  const spriteCountDelta = getSpriteCountDeltaForKey(event.key, event.repeat);

  if (
    spriteCountDelta !== null &&
    spriteScene.addRandomSprites &&
    spriteScene.removeRandomSprites
  ) {
    if (spriteCountDelta > 0) {
      spriteScene.addRandomSprites(spriteCountDelta);
    } else {
      spriteScene.removeRandomSprites(-spriteCountDelta);
    }
    return;
  }

  const nextVideoIndex = getVideoIndexForKey(
    event.key,
    videoIndex,
    availableVideos.length,
    event.repeat,
  );

  if (nextVideoIndex !== null) {
    selectVideo(nextVideoIndex);
    return;
  }

  const nextIndex = getSceneIndexForKey(
    event.key,
    index,
    scenes.length,
    event.repeat,
  );

  if (nextIndex !== null) selectScene(nextIndex);
});

globalThis.addEventListener("keyup", (rawEvent) => {
  const event = rawEvent as KeyboardEvent;
  if (event.key === "Control") {
    ctrlDown = false;
  }
});

app.ticker.add((ticker) => {
  animateDemoScene(scene, ticker.deltaMS);
  particleEmitter.update(ticker.deltaMS);
  fpsOverlay.tick(ticker.deltaMS);
});

let bitmapFontsDestroyed = false;
const destroyBitmapFonts = async (): Promise<void> => {
  if (bitmapFontsDestroyed) return;
  bitmapFontsDestroyed = true;
  BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
  await Assets.unload(bitmapFontPath);
};

const destroySpriteTextures = async (): Promise<void> => {
  await Promise.all(texturePaths.map((path) => Assets.unload(path)));
  await Assets.unload(drumTexturePath);
  await Assets.unload(rainDropTexturePath);
};

const stopActiveScene = (): void => {
  (scene as typeof scene & { dispose?: () => void }).dispose?.();
};

addDestroyListener(() => {
  stopActiveScene();
  particleEmitter.destroy();
  Howler.unload();
});

const RESTART_EXIT_CODE = 75;
let restarting = false;

const restartApp = async (): Promise<void> => {
  if (restarting) return;

  restarting = true;

  try {
    await destroy();
    await destroySpriteTextures();
    await destroyBitmapFonts();
  } catch {}

  process.exit(RESTART_EXIT_CODE);
};
