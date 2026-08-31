import { Container, Text } from "pixi.js";
import {
  NativeVideo,
  NativeVideoSprite,
  VideoFpsMeter,
} from "../../pixi-node/video/index.ts";
import { fitVideoRect } from "../videoLayout.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const VIDEO_TOP_INSET = 92;

export function createVideoTest(
  source: string,
  viewport: { width: number; height: number },
  label = source,
  fps = 30,
): DisposableDemoScene {
  const scene = new Container() as DisposableDemoScene;
  const fileName = label.split(/[\\/]/).pop() ?? label;
  scene.addChild(
    new Text({
      text: `VIDEO TEST  [5]  ${fileName}  [UP/DOWN: change video]`,
      style: {
        fontFamily: "Arial",
        fontSize: 26,
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    }),
  );

  const video = new NativeVideo(source, {
    width: WIDTH,
    height: HEIGHT,
    fps,
  });
  const sprite = new NativeVideoSprite(video);
  const uploadFpsMeter = new VideoFpsMeter();
  let measuredUploadFps: number | null = null;
  let previousPresentedFrames = 0;

  const status = createMetricBitmapText("NV12 video loading...", 18);
  status.position.set(24, 60);

  const videoScene = scene as DisposableDemoScene & {
    resize(width: number, height: number): void;
    update(): void;
  };
  videoScene.resize = (width, height) => {
    const rect = fitVideoRect(WIDTH, HEIGHT, width, height, VIDEO_TOP_INSET);
    sprite.position.set(rect.x, rect.y);
    sprite.width = rect.width;
    sprite.height = rect.height;
  };

  scene.addChild(sprite, status);
  videoScene.resize(viewport.width, viewport.height);

  let nextStatusUpdateTime = 0;
  videoScene.update = () => {
    const stats = video.stats;
    if (stats.presentedFrames !== previousPresentedFrames) {
      previousPresentedFrames = stats.presentedFrames;
      measuredUploadFps =
        uploadFpsMeter.observe(performance.now()) ?? measuredUploadFps;
    }

    const now = performance.now();
    if (now < nextStatusUpdateTime) return;
    nextStatusUpdateTime = now + 100;

    const uploadFps =
      measuredUploadFps === null ? "--" : measuredUploadFps.toFixed(1);
    const state = video.error
      ? `error: ${video.error.message}`
      : video.ended
        ? "ended"
        : video.paused
          ? "paused"
          : `${video.currentTime.toFixed(2)} s`;
    status.text =
      `NV12 BT.709 limited / ${video.backend} / ${fps.toFixed(2)} fps` +
      ` | UP: ${uploadFps}` +
      ` | decoded/presented/dropped: ${stats.decodedFrames}/` +
      `${stats.presentedFrames}/${stats.droppedFrames}` +
      ` | ${(stats.bytesPerFrame / 1_000_000).toFixed(3)} MB/frame` +
      ` | ${state}`;
  };

  let disposed = false;
  void video.play().catch((error: unknown) => {
    if (disposed) return;
    const message = error instanceof Error ? error.message : String(error);
    status.text = `Video error: ${message}`;
    console.error("[VideoTest] FFmpeg NV12 decoder failed", error);
  });

  videoScene.dispose = () => {
    if (disposed) return;
    disposed = true;
    videoScene.update = (): void => undefined;
    video.destroy();
  };
  return videoScene;
}
