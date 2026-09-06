import { Container, Graphics, Text } from "pixi.js";
import {
  NativeVideo,
  VideoFpsMeter,
} from "../../../pixi-native/video/index.ts";
import { NativeVideoSprite } from "../../../pixi-native/video/NativeVideoSprite.ts";
import { fitVideoRect } from "../videoLayout.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import { nativeAudioEngine } from "../../../pixi-native/audio/index.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const VIDEO_TOP_INSET = 92;

export interface VideoTestScene extends DisposableDemoScene {
  handleKey(key: string | null, repeat?: number): boolean;
  resize(width: number, height: number): void;
  update(deltaMS?: number): void;
}

export function createVideoTest(
  source: string,
  viewport: { width: number; height: number },
  label = source,
  fps = 30,
): VideoTestScene {
  const scene = new Container() as VideoTestScene;
  const fileName = label.split(/[\\/]/).pop() ?? label;
  const title = new Text({
    text: `VIDEO TEST  [5]  ${fileName}  [UP/DOWN: change video]  [M: mask off]`,
    style: {
      fontFamily: "Arial",
      fontSize: 26,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
    },
  });
  scene.addChild(title);

  const video = new NativeVideo(source, {
    width: WIDTH,
    height: HEIGHT,
    fps,
    loop: true,
  });
  const sprite = new NativeVideoSprite(video);
  const videoGroup = new Container();
  const uploadFpsMeter = new VideoFpsMeter();
  let measuredUploadFps: number | null = null;
  let previousPresentedFrames = 0;

  const status = createMetricBitmapText("NV12 video loading...", 14);
  status.position.set(24, 60);
  const maskGraphics = new Graphics();
  maskGraphics.includeInBuild = false;
  maskGraphics.measurable = false;
  let maskEnabled = false;
  let maskTime = 0;
  let videoRect = fitVideoRect(
    WIDTH,
    HEIGHT,
    viewport.width,
    viewport.height,
    VIDEO_TOP_INSET,
  );

  const redrawMask = (): void => {
    const centerX =
      videoRect.x + videoRect.width * (0.5 + Math.sin(maskTime) * 0.28);
    const centerY =
      videoRect.y + videoRect.height * (0.5 + Math.cos(maskTime * 1.27) * 0.2);
    const radiusX = videoRect.width * (0.28 + Math.sin(maskTime * 1.6) * 0.06);
    const radiusY =
      videoRect.height * (0.34 + Math.cos(maskTime * 1.15) * 0.06);
    maskGraphics
      .clear()
      .ellipse(centerX, centerY, radiusX, radiusY)
      .fill(0xffffff);
  };

  const keepMaskOutOfNormalPass = (): void => {
    // StencilMask.reset() restores these flags when the mask is detached.
    // Reapply the mask-only state so toggling off can never draw the ellipse.
    maskGraphics.includeInBuild = false;
    maskGraphics.measurable = false;
  };

  const updateMaskState = (): void => {
    videoGroup.mask = maskEnabled ? maskGraphics : null;
    keepMaskOutOfNormalPass();
    title.text =
      `VIDEO TEST  [5]  ${fileName}  [UP/DOWN: change video]` +
      `  [M: mask ${maskEnabled ? "on" : "off"}]`;
  };

  const videoScene = scene;
  videoScene.resize = (width, height) => {
    videoRect = fitVideoRect(WIDTH, HEIGHT, width, height, VIDEO_TOP_INSET);
    sprite.position.set(videoRect.x, videoRect.y);
    sprite.width = videoRect.width;
    sprite.height = videoRect.height;
    redrawMask();
  };

  videoGroup.addChild(sprite);
  // Keep the mask in the same scene graph so Pixi updates its transform and
  // display state before the stencil pipe collects it. includeInBuild=false
  // keeps it out of the normal color pass; the stencil pipe enables it only
  // while drawing the mask geometry.
  scene.addChild(videoGroup, maskGraphics, status);
  videoScene.resize(viewport.width, viewport.height);
  updateMaskState();

  videoScene.handleKey = (key, repeat = 0): boolean => {
    if (repeat || String(key ?? "").toLowerCase() !== "m") return false;
    maskEnabled = !maskEnabled;
    updateMaskState();
    return true;
  };

  let nextStatusUpdateTime = 0;
  videoScene.update = (deltaMS = 0) => {
    if (maskEnabled) {
      maskTime += deltaMS / 1000;
      redrawMask();
    }
    const stats = video.stats;
    const audioDiagnostics = nativeAudioEngine.diagnostics;
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
    const audioState = video.audioError
      ? `audio fallback: ${video.audioError.message}`
      : video.muted
        ? "audio muted"
        : `audio ${(video.volume * 100).toFixed(0)}%`;
    status.text =
      `${video.backend} / ${fps.toFixed(2)} fps` +
      ` | UP: ${uploadFps}` +
      ` | decoded/shown/dropped: ${stats.decodedFrames}/` +
      `${stats.presentedFrames}/${stats.droppedFrames}` +
      ` | queue/skipped: ${stats.queuedFrames}/${stats.skippedFrames}` +
      ` | A/V: ${stats.syncOffsetMs.toFixed(1)} ms` +
      ` | audio queue/underruns: ${audioDiagnostics.queuedMs.toFixed(0)} ms/` +
      `${audioDiagnostics.underruns}` +
      ` | ${(stats.bytesPerFrame / 1_000_000).toFixed(2)} MB/frame` +
      ` | ${audioState} | ${state}`;
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
    videoGroup.mask = null;
    maskGraphics.destroy();
    video.destroy();
  };
  return videoScene;
}
