import { fileURLToPath } from "node:url";
import type { SpriteTestScene } from "./demo/test/SpriteTest.ts";
import type { AudioTestScene } from "./demo/test/AudioTest.ts";
import type { RainSpriteTestScene } from "./demo/test/RainSpriteTest.ts";
import type { VideoTestScene } from "./demo/test/VideoTest.ts";

if (!(globalThis as any).navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Node Native WebGPU" },
    configurable: true,
  });
}
const { Assets, BitmapFont, Texture } = await import("pixi.js");
const { createPixiRenderer } =
  await import("./pixi-node/createPixiRenderer.ts");
const { NodeCanvas } = await import("./pixi-node/NodeCanvas.ts");
const { createNativeKeyboardEvent, createNativeMouseEvent } =
  await import("./pixi-node/NodeDOMAdapter.ts");
const { supportsNativeVideo } = await import("./pixi-node/platform.ts");
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
} = await import("./demo/DemoScene.ts");

const { FpsOverlay } = await import("./demo/FpsOverlay.ts");
const { ParticleEmitter } = await import("./demo/ParticleEmitter.ts");
const { Howler } = await import("./pixi-node/audio/index.ts");
const { getSceneIndexForKey, getSpriteCountDeltaForKey, getVideoIndexForKey } =
  await import("./demo/sceneNavigation.ts");

const { app, native } = await createPixiRenderer();

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

installDynamicBitmapTextFont();
await Assets.load(bitmapFontPath);
type PixiTexture = InstanceType<typeof Texture>;

const loadNativeTexture = async (path: string): Promise<PixiTexture> => {
  const loaded = await Assets.load(path);
  const image = (loaded as any).source?.resource;
  const imageCanvas = new NodeCanvas(loaded.width, loaded.height);
  const context = imageCanvas.getContext("2d") as any;

  if (!image || !context?.drawImage) {
    throw new Error(`Native image cannot be rasterized: ${path}`);
  }

  context.drawImage(image, 0, 0, loaded.width, loaded.height);
  return Texture.from({
    resource: imageCanvas as unknown as HTMLCanvasElement,
    format: "rgba8unorm",
  });
};

const spriteTextures = (await Promise.all(
  texturePaths.map(loadNativeTexture),
)) as [PixiTexture, PixiTexture, PixiTexture];
const drumTexture = await loadNativeTexture(drumTexturePath);
const rainDropTexture = await loadNativeTexture(rainDropTexturePath);

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

const videoPaths = videos.map(({ file }) =>
  fileURLToPath(new URL(`../assets/${file}`, import.meta.url)),
);

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

const videoSceneIndex = supportsNativeVideo(process.platform)
  ? scenes.length
  : null;

if (videoSceneIndex !== null) {
  scenes.push(() =>
    createVideoTest(
      videoPaths[videoIndex],
      { width: native.canvas.width, height: native.canvas.height },
      videos[videoIndex].file,
      videos[videoIndex].fps,
    ),
  );
}

scenes.push(() =>
  createAudioTest(drumTexture, {
    width: native.canvas.width,
    height: native.canvas.height,
  }),
);

if (supportsNativeVideo(process.platform)) {
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

let index = 0;
let scene = scenes[index]();
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
  scene = scenes[index]();
  app.stage.addChild(scene);
  if (index === particleSceneIndex) particleEmitter.setEnabled(true);
};

const selectVideo = (nextVideoIndex: number): void => {
  if (index !== videoSceneIndex || nextVideoIndex === videoIndex) return;
  disposeDemoScene(scene);
  videoIndex = nextVideoIndex;
  scene = scenes[index]();
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

native.window.on("resize", resizeActiveScene);

let mouseButtons = 0;
native.window.on("mouseButtonDown", (event) => {
  mouseButtons |= 1 << (event.button - 1);
  native.input.dispatchCanvasEvent(
    "mousedown",
    createNativeMouseEvent({
      type: "mousedown",
      clientX: event.x,
      clientY: event.y,
      button: event.button - 1,
      buttons: mouseButtons,
    }),
  );
});

native.window.on("mouseButtonUp", (event) => {
  mouseButtons &= ~(1 << (event.button - 1));
  native.input.dispatchGlobalEvent(
    "mouseup",
    createNativeMouseEvent({
      type: "mouseup",
      clientX: event.x,
      clientY: event.y,
      button: event.button - 1,
      buttons: mouseButtons,
    }),
  );
});

native.window.on("mouseMove", (event) => {
  native.input.dispatchGlobalEvent(
    "mousemove",
    createNativeMouseEvent({
      type: "mousemove",
      clientX: event.x,
      clientY: event.y,
      button: -1,
      buttons: mouseButtons,
    }),
  );
});

let ctrlDown = false;
native.window.on("keyDown", (event) => {
  native.input.dispatchGlobalEvent(
    "keydown",
    createNativeKeyboardEvent({
      type: "keydown",
      key: event.key ?? "",
      code: String(event.scancode),
      repeat: Boolean(event.repeat),
      ctrlKey: Boolean(event.ctrl),
      shiftKey: Boolean(event.shift),
      altKey: Boolean(event.alt),
      metaKey: Boolean(event.super),
    }),
  );

  if (event.key === "Control") {
    ctrlDown = true;
    return;
  }

  if (String(event.key ?? "").toLowerCase() === "tab" && !event.repeat) {
    particleEmitter.setEnabled(!particleEmitter.enabled);
    return;
  }

  if (event?.key === "r") {
    console.warn("Restarting...");
    restartApp();
    return;
  }

  const audioScene = scene as unknown as Partial<AudioTestScene>;
  if (audioScene.handleKey?.(event.key, event.repeat)) return;

  const rainScene = scene as unknown as Partial<RainSpriteTestScene>;
  if (rainScene.handleKey?.(event.key, event.repeat)) return;

  const videoScene = scene as unknown as Partial<VideoTestScene>;
  if (videoScene.handleKey?.(event.key, event.repeat)) return;

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
    videoPaths.length,
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

native.window.on("keyUp", (event) => {
  native.input.dispatchGlobalEvent(
    "keyup",
    createNativeKeyboardEvent({
      type: "keyup",
      key: event.key ?? "",
      code: String(event.scancode),
      ctrlKey: Boolean(event.ctrl),
      shiftKey: Boolean(event.shift),
      altKey: Boolean(event.alt),
      metaKey: Boolean(event.super),
    }),
  );

  if (event.key === "Control") {
    ctrlDown = false;
  }
});

app.ticker.add((ticker) => {
  animateDemoScene(scene, ticker.deltaMS);
  particleEmitter.update(ticker.deltaMS);
  fpsOverlay.tick(ticker.deltaMS);
  app.renderer.render(app.stage);
  native.renderer.swap();
});
app.ticker.start();

let shuttingDown = false;
let bitmapFontsDestroyed = false;
const destroyBitmapFonts = async (): Promise<void> => {
  if (bitmapFontsDestroyed) return;
  bitmapFontsDestroyed = true;
  BitmapFont.uninstall(DYNAMIC_BITMAP_FONT_NAME);
  await Assets.unload(bitmapFontPath);
};

const destroySpriteTextures = async (): Promise<void> => {
  for (const texture of spriteTextures) texture.destroy(true);
  await Promise.all(texturePaths.map((path) => Assets.unload(path)));
  drumTexture.destroy(true);
  await Assets.unload(drumTexturePath);
  rainDropTexture.destroy(true);
  await Assets.unload(rainDropTexturePath);
};

/**
 * Application.destroy() destroys the stage before the renderer. That order
 * is unsafe for WebGPU because stage-owned texture sources notify bind groups
 * while those bind groups are still alive. Release GPU systems first.
 */
const destroyPixiApplication = (): void => {
  app.renderer.destroy({ removeView: true });
  app.stage.destroy({ children: true, context: true, style: true });
  app.ticker.destroy();
};

const stopActiveScene = (): void => {
  (scene as typeof scene & { dispose?: () => void }).dispose?.();
};

const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.ticker.stop();
  stopActiveScene();
  particleEmitter.destroy();
  const queue = native.device.queue as GPUQueue & {
    onSubmittedWorkDone?: () => Promise<void>;
  };
  await queue.onSubmittedWorkDone?.();
  destroyPixiApplication();
  await destroySpriteTextures();
  await destroyBitmapFonts();
  Howler.unload();
  native.destroy();
  process.exit(0);
};

native.window.on("close", () => {
  void shutdown();
});

const RESTART_EXIT_CODE = 75;
let restarting = false;

const restartApp = async (): Promise<void> => {
  if (restarting || shuttingDown) return;

  restarting = true;
  shuttingDown = true;

  app.ticker.stop();
  stopActiveScene();
  particleEmitter.destroy();

  try {
    const queue = native.device.queue as GPUQueue & {
      onSubmittedWorkDone?: () => Promise<void>;
    };

    await queue.onSubmittedWorkDone?.();
  } catch {}

  try {
    destroyPixiApplication();
    await destroySpriteTextures();
  } catch {}

  try {
    await destroyBitmapFonts();
  } catch {}

  try {
    Howler.unload();
  } catch {}

  try {
    native.destroy();
  } catch {}

  process.exit(RESTART_EXIT_CODE);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
