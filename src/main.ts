import { fileURLToPath } from "node:url";

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
const { supportsNativeVideo } = await import("./pixi-node/platform.ts");
const {
  animateDemoScene,
  createGraphicsTest,
  createBitmapTextTest,
  createSpriteTest,
  createTextTest,
  createVideoTest,
  disposeDemoScene,
  DYNAMIC_BITMAP_FONT_NAME,
  installDynamicBitmapTextFont,
} = await import("./demo/DemoScene.ts");

const { FpsOverlay } = await import("./demo/FpsOverlay.ts");
const { getSceneIndexForKey, getVideoIndexForKey } =
  await import("./demo/sceneNavigation.ts");

const { app, native } = await createPixiRenderer();

const texturePath = fileURLToPath(
  new URL("../assets/test-texture.png", import.meta.url),
);
const bitmapFontPath = fileURLToPath(
  new URL(
    "../assets/bitmap-font/native-pixel.fnt",
    import.meta.url,
  ),
);

const loaded = await Assets.load(texturePath);
installDynamicBitmapTextFont();
await Assets.load(bitmapFontPath);
const image = (loaded as any).source?.resource;
const imageCanvas = new NodeCanvas(loaded.width, loaded.height);
const context = imageCanvas.getContext("2d") as any;

if (!image || !context?.drawImage) {
  throw new Error("Native image cannot be rasterized");
}

context.drawImage(image, 0, 0, loaded.width, loaded.height);
const texture = Texture.from({
  resource: imageCanvas as unknown as HTMLCanvasElement,
  format: "rgba8unorm",
});

const videos = [
  { file: "Big_Buck_Bunny_1080_10s_5MB.mp4", fps: 60 },
  { file: "Big_Buck_Bunny_1080_30s.mp4", fps: 24 },
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

let videoIndex = 1;

const scenes: Array<() => ReturnType<typeof createGraphicsTest>> = [
  () => createGraphicsTest(),
  () => createSpriteTest(texture),
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

let index = 0;
let scene = scenes[index]();
app.stage.addChild(scene);
const fpsOverlay = new FpsOverlay();
app.stage.addChild(fpsOverlay);
fpsOverlay.alignRight(native.canvas.width);

const selectScene = (nextIndex: number): void => {
  if (nextIndex === index) return;
  disposeDemoScene(scene);
  index = nextIndex;
  scene = scenes[index]();
  app.stage.addChild(scene);
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
  fpsOverlay.alignRight(native.canvas.width);
};

native.window.on("resize", resizeActiveScene);

let ctrlDown = false;
native.window.on("keyDown", (event) => {
  if (event.key === "Control") {
    ctrlDown = true;
    return;
  }

  if (event?.key === "r") {
    console.warn("Restarting...");
    restartApp();
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
  if (event.key === "Control") {
    ctrlDown = false;
  }
});

app.ticker.add((ticker) => {
  animateDemoScene(scene, ticker.deltaMS);
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

const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.ticker.stop();
  disposeDemoScene(scene);
  const queue = native.device.queue as GPUQueue & {
    onSubmittedWorkDone?: () => Promise<void>;
  };
  await queue.onSubmittedWorkDone?.();
  texture.destroy(true);
  app.destroy(
    { removeView: true },
    { children: true, context: true, style: true },
  );
  await destroyBitmapFonts();
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
  disposeDemoScene(scene);

  try {
    const queue = native.device.queue as GPUQueue & {
      onSubmittedWorkDone?: () => Promise<void>;
    };

    await queue.onSubmittedWorkDone?.();
  } catch {}

  try {
    texture.destroy(true);
    app.destroy(
      { removeView: true },
      { children: true, context: true, style: true },
    );
  } catch {}

  try {
    await destroyBitmapFonts();
  } catch {}

  try {
    native.destroy();
  } catch {}

  process.exit(RESTART_EXIT_CODE);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
