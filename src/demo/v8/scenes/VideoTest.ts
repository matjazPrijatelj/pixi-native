import { Container, Graphics, Text } from "pixi.js";
import {
  NativeVideo,
  VideoFpsMeter,
  type VideoSpriteOptions,
} from "@pixi-native/core";
import { VideoSprite as NativeVideoSprite } from "@pixi-native/pixi8";
import { fitVideoRect } from "../videoLayout.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import { nativeAudioEngine } from "@pixi-native/core/audio";
import {
  VideoEventMonitor,
  type VideoEventMonitorSnapshot,
  type VideoEventSource,
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
  eventSources: readonly VideoEventSource[] = [],
  transparentVideoSource?: string,
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

  let video = new NativeVideo(source, {
    width: WIDTH,
    height: HEIGHT,
    fps,
    loop: true,
  });
  let sprite = new NativeVideoSprite(video);
  const videoGroup = new Container();
  const uploadFpsMeter = new VideoFpsMeter();
  let measuredUploadFps: number | null = null;
  let previousPresentedFrames = 0;

  const status = createMetricBitmapText("NV12 video loading...", 14);
  status.position.set(24, 60);
  const eventPanel = new Graphics();
  const eventSummary = createMetricBitmapText("", 16);
  const eventLines = Array.from({ length: 7 }, () =>
    createMetricBitmapText("", 14),
  );
  eventPanel.visible = false;
  eventSummary.visible = false;
  for (const line of eventLines) line.visible = false;
  const maskGraphics = new Graphics();
  const checkerGraphics = new Graphics();
  checkerGraphics.visible = false;
  maskGraphics.includeInBuild = false;
  maskGraphics.measurable = false;
  let maskEnabled = false;
  let maskTime = 0;
  let eventMode = false;
  let alphaMode = false;
  let eventIndex = 0;
  let eventMonitor: VideoEventMonitor | undefined;
  let eventSnapshot: VideoEventMonitorSnapshot | undefined;
  let autoSwitch = false;
  let nextAutoSwitchAt = 0;
  let disposed = false;
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
    videoGroup.mask = maskEnabled && !alphaMode ? maskGraphics : null;
    keepMaskOutOfNormalPass();
    checkerGraphics.visible = alphaMode;
    title.text = alphaMode
      ? "TRANSPARENT VIDEO TEST  [5]  packed color + alpha  [T: normal]"
      : eventMode
        ? `VIDEO SRC/EVENT TEST  [5]  ${eventSources[eventIndex]?.file ?? "unavailable"}` +
          `  [UP/DOWN: src]  [A: auto ${autoSwitch ? "on" : "off"}]  [E: normal]  [T: alpha]`
        : `VIDEO TEST  [5]  ${fileName}  [UP/DOWN: change video]` +
          `  [M: mask ${maskEnabled ? "on" : "off"}]  [E: src events]  [T: alpha]`;
  };

  const updateEventPanel = (): void => {
    const visible = eventMode;
    eventPanel.visible = visible;
    eventSummary.visible = visible;
    for (const line of eventLines) line.visible = visible;
    if (!visible || !eventSnapshot) return;
    eventSummary.text =
      `${eventSnapshot.result}: ${eventSnapshot.detail}` +
      ` | auto ${autoSwitch ? "on" : "off"}`;
    for (let index = 0; index < eventLines.length; index++) {
      eventLines[index].text = eventSnapshot.entries[index] ?? "";
    }
  };

  const layoutEventPanel = (width: number, height: number): void => {
    const panelX = 16;
    const panelY = Math.max(VIDEO_TOP_INSET, height - EVENT_PANEL_HEIGHT - 16);
    const panelWidth = Math.max(1, Math.min(760, width - 32));
    eventPanel
      .clear()
      .roundRect(panelX, panelY, panelWidth, EVENT_PANEL_HEIGHT, 8)
      .fill({ color: 0x000000, alpha: 0.78 });
    eventSummary.position.set(panelX + 12, panelY + 10);
    for (let index = 0; index < eventLines.length; index++) {
      eventLines[index].position.set(panelX + 12, panelY + 34 + index * 20);
    }
  };

  const videoScene = scene;
  videoScene.resize = (width, height) => {
    const sourceWidth = alphaMode ? ALPHA_COLOR_WIDTH : WIDTH;
    const sourceHeight = alphaMode ? ALPHA_FRAME_HEIGHT : HEIGHT;
    videoRect = fitVideoRect(
      sourceWidth,
      sourceHeight,
      width,
      height,
      VIDEO_TOP_INSET,
    );
    sprite.position.set(videoRect.x, videoRect.y);
    sprite.width = videoRect.width;
    sprite.height = videoRect.height;
    checkerGraphics.clear();
    const columns = 10;
    const rows = 6;
    const cellWidth = videoRect.width / columns;
    const cellHeight = videoRect.height / rows;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        checkerGraphics
          .rect(
            videoRect.x + column * cellWidth,
            videoRect.y + row * cellHeight,
            cellWidth + 1,
            cellHeight + 1,
          )
          .fill((row + column) % 2 === 0 ? 0x243b66 : 0xb8d4ff);
      }
    }
    redrawMask();
    layoutEventPanel(width, height);
  };

  videoGroup.addChild(sprite);
  // Keep the mask in the same scene graph so Pixi updates its transform and
  // display state before the stencil pipe collects it. includeInBuild=false
  // keeps it out of the normal color pass; the stencil pipe enables it only
  // while drawing the mask geometry.
  scene.addChild(
    checkerGraphics,
    videoGroup,
    maskGraphics,
    status,
    eventPanel,
    eventSummary,
    ...eventLines,
  );
  videoScene.resize(viewport.width, viewport.height);
  updateMaskState();

  const startVideo = (): void => {
    const currentVideo = video;
    void currentVideo.play().catch((error: unknown) => {
      if (disposed || currentVideo !== video) return;
      const message = error instanceof Error ? error.message : String(error);
      status.text = `Video error: ${message}`;
      console.error("[VideoTest] FFmpeg NV12 decoder failed", error);
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
    sprite = new NativeVideoSprite(video, spriteOptions);
    videoGroup.addChild(sprite);
    measuredUploadFps = null;
    previousPresentedFrames = 0;
    videoScene.resize(viewport.width, viewport.height);
  };

  const beginEventSource = (nextIndex: number, replacement: boolean): void => {
    eventIndex = (nextIndex + eventSources.length) % eventSources.length;
    const nextSource = eventSources[eventIndex];
    nextAutoSwitchAt = 0;
    eventMonitor?.beginSource(nextSource.file, replacement);
    if (replacement) video.src = nextSource.source;
    updateMaskState();
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
    replaceVideo(source, fps);
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

  videoScene.handleKey = (key, repeat = 0): boolean => {
    if (repeat) return false;
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
      updateMaskState();
      updateEventPanel();
      return true;
    }
    if (eventMode && (normalized === "up" || normalized === "down")) {
      beginEventSource(eventIndex + (normalized === "up" ? -1 : 1), true);
      return true;
    }
    if (normalized !== "m" || alphaMode) return false;
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
      `${video.backend} / ${video.fps.toFixed(2)} fps` +
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

  startVideo();

  videoScene.dispose = () => {
    if (disposed) return;
    disposed = true;
    videoScene.update = (): void => undefined;
    eventMonitor?.dispose();
    videoGroup.mask = null;
    maskGraphics.destroy();
    video.destroy();
  };
  return videoScene;
}
