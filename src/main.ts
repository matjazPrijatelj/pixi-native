import { fileURLToPath } from "node:url";

if (!(globalThis as any).navigator) {
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "Node Native WebGPU" },
    configurable: true,
  });
}
const { Assets, Texture } = await import("pixi.js");
const { createPixiRenderer } =
  await import("./pixi-node/createPixiRenderer.ts");
const { NodeCanvas } = await import("./pixi-node/NodeCanvas.ts");
const {
  animateDemoScene,
  createGraphicsTest,
  createSpriteTest,
  createTextTest,
  createVideoTest,
} = await import("./demo/DemoScene.ts");

const { FpsOverlay } = await import("./demo/FpsOverlay.ts");
const { getSceneIndexForKey, getVideoIndexForKey } =
  await import("./demo/sceneNavigation.ts");

const { app, native } = await createPixiRenderer();

const texturePath = fileURLToPath(
  new URL("../assets/test-texture.png", import.meta.url),
);

const loaded = await Assets.load(texturePath);
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

const videoFiles = [
  "Big_Buck_Bunny_1080_10s_5MB.mp4",
  "Big_Buck_Bunny_1080_30s.mp4",
  "Big_Buck_Bunny_720_10s_20MB.mp4",
  "cutting_orange_tuil_8s_3484kbps_2160p_59.94fps_h264.mp4",
  "water_netflix_15000kbps_2160p_59.94fps_h264.mp4",
];

const videoPaths = videoFiles.map((file) =>
  fileURLToPath(new URL(`../assets/${file}`, import.meta.url)),
);

let videoIndex = 1;

const scenes: Array<() => ReturnType<typeof createGraphicsTest>> = [
  () => createGraphicsTest(),
  () => createSpriteTest(texture),
  () => createTextTest(),
];

scenes.push(() =>
  createVideoTest(
    videoPaths[videoIndex],
    { width: native.canvas.width, height: native.canvas.height },
    native.uploadRgbaTexture,
    videoFiles[videoIndex],
  ),
);

let index = 0;
let scene = scenes[index]();
app.stage.addChild(scene);
const fpsOverlay = new FpsOverlay();
app.stage.addChild(fpsOverlay);
fpsOverlay.alignRight(native.canvas.width);

const selectScene = (nextIndex: number): void => {
  if (nextIndex === index) return;
  app.stage.removeChild(scene);
  index = nextIndex;
  scene = scenes[index]();
  app.stage.addChild(scene);
};

const selectVideo = (nextVideoIndex: number): void => {
  if (index !== 3 || nextVideoIndex === videoIndex) return;
  app.stage.removeChild(scene);
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
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.ticker.stop();
  const queue = native.device.queue as GPUQueue & {
    onSubmittedWorkDone?: () => Promise<void>;
  };
  await queue.onSubmittedWorkDone?.();
  app.destroy({ removeView: true });
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

  try {
    const queue = native.device.queue as GPUQueue & {
      onSubmittedWorkDone?: () => Promise<void>;
    };

    await queue.onSubmittedWorkDone?.();
  } catch {}

  try {
    app.destroy({ removeView: true });
  } catch {}

  try {
    native.destroy();
  } catch {}

  process.exit(RESTART_EXIT_CODE);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
