import { Container, Graphics } from "pixi.js-v7";
import { nativeAudioEngine } from "../../../pixi-native/audio/index.ts";
import {
  NativeVideo,
  VideoFpsMeter,
} from "../../../pixi-native/video/index.ts";
import { NativeVideoSprite7 } from "../../../pixi-native/video/NativeVideoSprite7.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const VIDEO_TOP_INSET = 92;

export interface Pixi7VideoSource {
  readonly file: string;
  readonly source: string;
  readonly fps: number;
}

export interface Pixi7VideoTestScene extends Container {
  update(deltaMS: number): void;
  resize(width: number, height: number): void;
  handleKey(key: string | null, repeat?: number): boolean;
  dispose(): void;
}

export function createVideoTest(
  sources: readonly Pixi7VideoSource[],
  viewport: { width: number; height: number },
): Pixi7VideoTestScene {
  const scene = new Container() as Pixi7VideoTestScene;
  const title = createMetricBitmapText("VIDEO TEST  [5] loading...", 26);
  const status = createMetricBitmapText("NV12 Pixi 7 video", 16);
  scene.addChild(title, status);
  let videoIndex = 0;
  let video = new NativeVideo(sources[videoIndex].source, {
    width: WIDTH,
    height: HEIGHT,
    fps: sources[videoIndex].fps,
    loop: true,
  });
  let sprite = new NativeVideoSprite7(video);
  const videoGroup = new Container();
  const maskGraphics = new Graphics();
  videoGroup.addChild(sprite);
  scene.addChildAt(videoGroup, 1);
  scene.addChild(maskGraphics);
  let maskEnabled = false;
  let maskTime = 0;
  const uploadFpsMeter = new VideoFpsMeter();
  let measuredUploadFps: number | null = null;
  let previousPresentedFrames = 0;
  let nextStatusUpdateTime = 0;
  let disposed = false;
  const resize = (width: number, height: number): void => {
    const scale = Math.min((width - 48) / WIDTH, (height - 130) / HEIGHT);
    sprite.width = WIDTH * Math.max(0.1, scale);
    sprite.height = HEIGHT * Math.max(0.1, scale);
    sprite.position.set((width - sprite.width) / 2, VIDEO_TOP_INSET);
    redrawMask();
    status.position.set(24, 60);
  };
  const redrawMask = (): void => {
    const centerX = sprite.x + sprite.width * (0.5 + Math.sin(maskTime) * 0.28);
    const centerY =
      sprite.y + sprite.height * (0.5 + Math.cos(maskTime * 1.27) * 0.2);
    const radiusX = sprite.width * (0.28 + Math.sin(maskTime * 1.6) * 0.06);
    const radiusY = sprite.height * (0.34 + Math.cos(maskTime * 1.15) * 0.06);
    maskGraphics
      .clear()
      .beginFill(0xffffff)
      .drawEllipse(centerX, centerY, radiusX, radiusY)
      .endFill();
  };
  const updateMaskState = (): void => {
    videoGroup.mask = maskEnabled ? maskGraphics : null;
    // Pixi 7 must still collect the object as a mask, but never draw it
    // in the normal color pass.
    maskGraphics.renderable = false;
    title.text = `VIDEO TEST  [5]  ${sources[videoIndex].file}  [UP/DOWN: change video]  [M: mask ${maskEnabled ? "on" : "off"}]`;
  };
  scene.resize = resize;
  const updateTitle = (): void => {
    title.text = `VIDEO TEST  [5]  ${sources[videoIndex].file}  [UP/DOWN: change video]`;
  };
  const startVideo = (): void => {
    const currentVideo = video;
    void currentVideo.play().catch((error) => {
      if (!disposed && currentVideo === video)
        status.text = `Video error: ${String(error)}`;
    });
  };
  const selectVideo = (nextIndex: number): void => {
    if (disposed) return;
    videoGroup.removeChild(sprite);
    sprite.destroy();
    videoIndex = (nextIndex + sources.length) % sources.length;
    video = new NativeVideo(sources[videoIndex].source, {
      width: WIDTH,
      height: HEIGHT,
      fps: sources[videoIndex].fps,
      loop: true,
    });
    sprite = new NativeVideoSprite7(video);
    videoGroup.addChild(sprite);
    measuredUploadFps = null;
    previousPresentedFrames = 0;
    updateTitle();
    resize(viewport.width, viewport.height);
    updateMaskState();
    startVideo();
  };
  scene.handleKey = (key, repeat = 0): boolean => {
    if (repeat || sources.length < 2) return false;
    const normalized = String(key ?? "").toLowerCase();
    if (normalized === "m") {
      maskEnabled = !maskEnabled;
      updateMaskState();
      return true;
    }
    if (normalized !== "up" && normalized !== "down") return false;
    selectVideo(videoIndex + (normalized === "up" ? -1 : 1));
    return true;
  };
  scene.update = (deltaMS = 0): void => {
    if (maskEnabled) {
      maskTime += deltaMS / 1000;
      redrawMask();
    }
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
    const audio = nativeAudioEngine.diagnostics;
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
    status.text = `${video.backend} / ${sources[videoIndex].fps.toFixed(2)} fps | UP: ${uploadFps} | decoded/shown/dropped: ${stats.decodedFrames}/${stats.presentedFrames}/${stats.droppedFrames} | queue/skipped: ${stats.queuedFrames}/${stats.skippedFrames} | A/V: ${stats.syncOffsetMs.toFixed(1)} ms | audio queue/underruns: ${audio.queuedMs.toFixed(0)} ms/${audio.underruns} | ${(stats.bytesPerFrame / 1_000_000).toFixed(2)} MB/frame | ${audioState} | ${state}`;
  };
  scene.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    videoGroup.mask = null;
    maskGraphics.destroy();
    sprite.destroy();
    video.destroy();
  };
  updateTitle();
  resize(viewport.width, viewport.height);
  updateMaskState();
  startVideo();
  return scene;
}
