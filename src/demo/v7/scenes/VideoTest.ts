import { Container, Graphics } from "pixi.js-v7";
import { nativeAudioEngine } from "@pixi-native/core/audio";
import {
  NativeVideo,
  VideoFpsMeter,
  type VideoSpriteOptions,
} from "@pixi-native/core";
import { VideoSprite as NativeVideoSprite7 } from "@pixi-native/pixi7";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import {
  VideoEventMonitor,
  type VideoEventMonitorSnapshot,
} from "../../VideoEventMonitor.ts";

const WIDTH = 1280;
const HEIGHT = 720;
const VIDEO_TOP_INSET = 92;
const EVENT_SWITCH_DELAY_MS = 5_000;
const EVENT_PANEL_HEIGHT = 184;
const ALPHA_FRAME_WIDTH = 1920;
const ALPHA_FRAME_HEIGHT = 768;
const ALPHA_COLOR_WIDTH = 1280;
const ALPHA_MASK_SCALE = 0.5;

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
  transparentVideoSource?: string,
): Pixi7VideoTestScene {
  const scene = new Container() as Pixi7VideoTestScene;
  const title = createMetricBitmapText("VIDEO TEST  [5] loading...", 26);
  const status = createMetricBitmapText("NV12 Pixi 7 video", 16);
  const eventPanel = new Graphics();
  const eventSummary = createMetricBitmapText("", 16);
  const eventLines = Array.from({ length: 7 }, () =>
    createMetricBitmapText("", 14),
  );
  scene.addChild(title, status);
  eventPanel.visible = false;
  eventSummary.visible = false;
  for (const line of eventLines) line.visible = false;
  let videoIndex = 0;
  const eventSources = sources.filter(
    (source) => Math.abs(source.fps - 30) < 0.001,
  );
  let eventIndex = 0;
  let eventMode = false;
  let alphaMode = false;
  let eventMonitor: VideoEventMonitor | undefined;
  let eventSnapshot: VideoEventMonitorSnapshot | undefined;
  let autoSwitch = false;
  let nextAutoSwitchAt = 0;
  let video = new NativeVideo(sources[videoIndex].source, {
    width: WIDTH,
    height: HEIGHT,
    fps: sources[videoIndex].fps,
    loop: true,
  });
  let sprite = new NativeVideoSprite7(video);
  const videoGroup = new Container();
  const maskGraphics = new Graphics();
  const checkerGraphics = new Graphics();
  checkerGraphics.visible = false;
  videoGroup.addChild(sprite);
  scene.addChildAt(checkerGraphics, 1);
  scene.addChildAt(videoGroup, 2);
  scene.addChild(maskGraphics);
  scene.addChild(eventPanel, eventSummary, ...eventLines);
  let maskEnabled = false;
  let maskTime = 0;
  const uploadFpsMeter = new VideoFpsMeter();
  let measuredUploadFps: number | null = null;
  let previousPresentedFrames = 0;
  let nextStatusUpdateTime = 0;
  let disposed = false;
  const layoutEventPanel = (width: number, height: number): void => {
    const panelX = 16;
    const panelY = Math.max(VIDEO_TOP_INSET, height - EVENT_PANEL_HEIGHT - 16);
    const panelWidth = Math.max(1, Math.min(760, width - 32));
    eventPanel
      .clear()
      .beginFill(0x000000, 0.78)
      .drawRoundedRect(panelX, panelY, panelWidth, EVENT_PANEL_HEIGHT, 8)
      .endFill();
    eventSummary.position.set(panelX + 12, panelY + 10);
    for (let index = 0; index < eventLines.length; index++) {
      eventLines[index].position.set(panelX + 12, panelY + 34 + index * 20);
    }
  };
  const resize = (width: number, height: number): void => {
    const sourceWidth = alphaMode ? ALPHA_COLOR_WIDTH : WIDTH;
    const sourceHeight = alphaMode ? ALPHA_FRAME_HEIGHT : HEIGHT;
    const scale = Math.min(
      (width - 48) / sourceWidth,
      (height - 130) / sourceHeight,
    );
    sprite.width = sourceWidth * Math.max(0.1, scale);
    sprite.height = sourceHeight * Math.max(0.1, scale);
    sprite.position.set((width - sprite.width) / 2, VIDEO_TOP_INSET);
    checkerGraphics.clear();
    const columns = 10;
    const rows = 6;
    const cellWidth = sprite.width / columns;
    const cellHeight = sprite.height / rows;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        checkerGraphics
          .beginFill((row + column) % 2 === 0 ? 0x243b66 : 0xb8d4ff)
          .drawRect(
            sprite.x + column * cellWidth,
            sprite.y + row * cellHeight,
            cellWidth + 1,
            cellHeight + 1,
          )
          .endFill();
      }
    }
    redrawMask();
    status.position.set(24, 60);
    layoutEventPanel(width, height);
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
  const updateTitle = (): void => {
    title.text = alphaMode
      ? "TRANSPARENT VIDEO TEST  [5]  packed color + alpha  [T: normal]"
      : eventMode
        ? `VIDEO SRC/EVENT TEST  [5]  ${eventSources[eventIndex]?.file ?? "unavailable"}` +
          `  [UP/DOWN: src]  [A: auto ${autoSwitch ? "on" : "off"}]  [E: normal]  [T: alpha]`
        : `VIDEO TEST  [5]  ${sources[videoIndex].file}  [UP/DOWN: change video]` +
          `  [M: mask ${maskEnabled ? "on" : "off"}]  [E: src events]  [T: alpha]`;
  };
  const updateMaskState = (): void => {
    videoGroup.mask = maskEnabled && !alphaMode ? maskGraphics : null;
    checkerGraphics.visible = alphaMode;
    // Pixi 7 must still collect the object as a mask, but never draw it
    // in the normal color pass.
    maskGraphics.renderable = false;
    updateTitle();
  };
  const updateEventPanel = (): void => {
    const visible = eventMode;
    eventPanel.visible = visible;
    eventSummary.visible = visible;
    for (const line of eventLines) line.visible = visible;
    if (!visible || !eventSnapshot) return;
    eventSummary.text = `${eventSnapshot.result}: ${eventSnapshot.detail} | auto ${autoSwitch ? "on" : "off"}`;
    for (let index = 0; index < eventLines.length; index++) {
      eventLines[index].text = eventSnapshot.entries[index] ?? "";
    }
  };
  scene.resize = resize;
  const startVideo = (): void => {
    const currentVideo = video;
    void currentVideo.play().catch((error) => {
      if (!disposed && currentVideo === video)
        status.text = `Video error: ${String(error)}`;
    });
  };
  const replaceVideo = (
    nextSource: string,
    nextFps: number,
    nextWidth = WIDTH,
    nextHeight = HEIGHT,
    spriteOptions: VideoSpriteOptions = {},
    audio = true,
  ): void => {
    videoGroup.removeChild(sprite);
    sprite.destroy();
    video.destroy();
    video = new NativeVideo(nextSource, {
      width: nextWidth,
      height: nextHeight,
      fps: nextFps,
      loop: true,
      audio,
    });
    sprite = new NativeVideoSprite7(video, spriteOptions);
    videoGroup.addChild(sprite);
    measuredUploadFps = null;
    previousPresentedFrames = 0;
    updateTitle();
    resize(viewport.width, viewport.height);
    updateMaskState();
  };
  const selectVideo = (nextIndex: number): void => {
    if (disposed) return;
    videoIndex = (nextIndex + sources.length) % sources.length;
    replaceVideo(sources[videoIndex].source, sources[videoIndex].fps);
    startVideo();
  };
  const beginEventSource = (nextIndex: number, replacement: boolean): void => {
    eventIndex = (nextIndex + eventSources.length) % eventSources.length;
    const nextSource = eventSources[eventIndex];
    nextAutoSwitchAt = 0;
    eventMonitor?.beginSource(nextSource.file, replacement);
    if (replacement) video.src = nextSource.source;
    updateTitle();
    updateEventPanel();
  };
  const enterEventMode = (): void => {
    if (eventSources.length < 2) return;
    eventMonitor?.dispose();
    eventMode = true;
    alphaMode = false;
    autoSwitch = false;
    eventIndex = 0;
    replaceVideo(eventSources[0].source, 30);
    eventMonitor = new VideoEventMonitor(video, (snapshot) => {
      eventSnapshot = snapshot;
      if (autoSwitch && snapshot.result === "PASS" && nextAutoSwitchAt === 0) {
        nextAutoSwitchAt = performance.now() + EVENT_SWITCH_DELAY_MS;
      }
      updateEventPanel();
    });
    eventMonitor.beginSource(eventSources[0].file, false);
    updateMaskState();
    updateEventPanel();
    startVideo();
  };
  const enterNormalMode = (): void => {
    eventMonitor?.dispose();
    eventMonitor = undefined;
    eventSnapshot = undefined;
    eventMode = false;
    alphaMode = false;
    autoSwitch = false;
    nextAutoSwitchAt = 0;
    replaceVideo(sources[videoIndex].source, sources[videoIndex].fps);
    updateMaskState();
    updateEventPanel();
    startVideo();
  };
  const enterAlphaMode = (): void => {
    if (!transparentVideoSource) return;
    eventMonitor?.dispose();
    eventMonitor = undefined;
    eventSnapshot = undefined;
    eventMode = false;
    alphaMode = true;
    autoSwitch = false;
    nextAutoSwitchAt = 0;
    replaceVideo(
      transparentVideoSource,
      30,
      ALPHA_FRAME_WIDTH,
      ALPHA_FRAME_HEIGHT,
      { alphaMaskScale: ALPHA_MASK_SCALE },
      false,
    );
    updateMaskState();
    updateEventPanel();
    startVideo();
  };
  scene.handleKey = (key, repeat = 0): boolean => {
    if (repeat || sources.length < 2) return false;
    const normalized = String(key ?? "").toLowerCase();
    if (normalized === "t") {
      if (alphaMode) enterNormalMode();
      else enterAlphaMode();
      return transparentVideoSource !== undefined;
    }
    if (normalized === "e") {
      if (eventMode) enterNormalMode();
      else enterEventMode();
      return eventSources.length >= 2;
    }
    if (eventMode && normalized === "a") {
      autoSwitch = !autoSwitch;
      nextAutoSwitchAt =
        autoSwitch && eventMonitor?.result === "PASS"
          ? performance.now() + EVENT_SWITCH_DELAY_MS
          : 0;
      updateTitle();
      updateEventPanel();
      return true;
    }
    if (eventMode && (normalized === "up" || normalized === "down")) {
      beginEventSource(eventIndex + (normalized === "up" ? -1 : 1), true);
      return true;
    }
    if (normalized === "m" && !alphaMode) {
      maskEnabled = !maskEnabled;
      updateMaskState();
      return true;
    }
    if (eventMode) return false;
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
    if (
      eventMode &&
      autoSwitch &&
      nextAutoSwitchAt > 0 &&
      now >= nextAutoSwitchAt
    ) {
      beginEventSource(eventIndex + 1, true);
    }
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
    status.text = `${video.backend} / ${video.fps.toFixed(2)} fps | UP: ${uploadFps} | decoded/shown/dropped: ${stats.decodedFrames}/${stats.presentedFrames}/${stats.droppedFrames} | queue/skipped: ${stats.queuedFrames}/${stats.skippedFrames} | A/V: ${stats.syncOffsetMs.toFixed(1)} ms | audio queue/underruns: ${audio.queuedMs.toFixed(0)} ms/${audio.underruns} | ${(stats.bytesPerFrame / 1_000_000).toFixed(2)} MB/frame | ${audioState} | ${state}`;
  };
  scene.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    eventMonitor?.dispose();
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
