import { fileURLToPath } from "node:url";
import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { Howl, Howler, nativeAudioEngine } from "@pixi-native/core/audio";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import {
  DRUM_ATLAS,
  DRUM_PADS,
  DRUM_SOURCE_PATH,
  getDrumPadForKey,
  type DrumPadDefinition,
} from "../drumKit.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";

export interface AudioTestBounds {
  readonly width: number;
  readonly height: number;
}

interface DrumPadView {
  readonly definition: DrumPadDefinition;
  readonly flash: Graphics;
  readonly hitTarget: Graphics;
  remainingMs: number;
}

export interface AudioTestScene extends DisposableDemoScene {
  handleKey(key: string | null, repeat?: number): boolean;
  resize(width: number, height: number): void;
  update(deltaMs?: number): void;
}

const sourceBg = fileURLToPath(
  new URL("../../assets/audio/mario.mp3", import.meta.url),
);

const source = fileURLToPath(
  new URL("../../assets/audio/howler-test.wav", import.meta.url),
);

export function createAudioTest(
  drumTexture: Texture,
  initialBounds: AudioTestBounds,
): AudioTestScene {
  const scene = new Container() as AudioTestScene;
  let lastEvent = "loading";
  const title = new Text({
    text: "NATIVE AUDIO / HOWLER + DRUM ATLAS  [6]",
    style: {
      fontFamily: "Arial",
      fontSize: 26,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
    },
  });
  const bgMusic = new Howl({
    src: [sourceBg],
    volume: 0.2,
    loop: true,
  });
  bgMusic.play();

  const instructions = createMetricBitmapText(
    "U/I/O/P + J/K/L/Č or mouse click: drums  |  M: music fade-in  |  F: fade-out  |  SPACE: mute",
    18,
  );
  instructions.position.set(24, 48);
  const status = createMetricBitmapText("Audio loading...", 18);
  status.position.set(24, 78);
  scene.addChild(title, instructions, status);

  const drumContainer = new Container();
  drumContainer.eventMode = "static";
  const drumSprite = new Sprite(drumTexture);
  drumContainer.addChild(drumSprite);
  const padViews: DrumPadView[] = DRUM_PADS.map((definition) => {
    const flash = new Graphics()
      .ellipse(
        definition.hit.x * drumTexture.width,
        definition.hit.y * drumTexture.height,
        definition.hit.radiusX * drumTexture.width,
        definition.hit.radiusY * drumTexture.height,
      )
      .fill({ color: 0x66f5ff });
    flash.alpha = 0;
    drumContainer.addChild(flash);

    const keyLabel = createMetricBitmapText(
      definition.key.toLocaleUpperCase("sl"),
      30,
    );
    keyLabel.anchor.set(0.5);
    keyLabel.position.set(
      definition.hit.x * drumTexture.width,
      definition.hit.y * drumTexture.height,
    );
    drumContainer.addChild(keyLabel);
    const hitTarget = new Graphics()
      .ellipse(
        definition.hit.x * drumTexture.width,
        definition.hit.y * drumTexture.height,
        definition.hit.radiusX * drumTexture.width,
        definition.hit.radiusY * drumTexture.height,
      )
      .fill({ color: 0xffffff, alpha: 0 });
    hitTarget.eventMode = "static";
    hitTarget.cursor = "pointer";
    drumContainer.addChild(hitTarget);
    return { definition, flash, hitTarget, remainingMs: 0 };
  });
  scene.addChild(drumContainer);

  let musicId: number | null = null;
  let globallyMuted = false;
  let pendingFadeStop: (() => void) | undefined;
  const sound = new Howl({
    src: [source],
    sprite: {
      toneA: [0, 800],
      toneB: [1000, 800],
      music: [2000, 4000, true],
    },
    volume: 0.65,
    preloadSprites: true,
    onload: () => {
      lastEvent = "music loaded";
    },
    onplay: (id) => {
      lastEvent = `music play ${id}`;
    },
    onend: (id) => {
      lastEvent = `music loop ${id}`;
    },
    onfade: (id) => {
      lastEvent = `music fade ${id}`;
    },
    onplayerror: (_id, message) => {
      lastEvent = `music error: ${message}`;
    },
  });
  const drums = new Howl({
    src: [DRUM_SOURCE_PATH],
    sprite: DRUM_ATLAS.sprite,
    volume: 0.85,
    onload: () => {
      lastEvent = "drum MP3 atlas loaded";
    },
    onplayerror: (_id, message) => {
      lastEvent = `drum error: ${message}`;
    },
  });

  const cancelPendingFadeStop = (): void => {
    if (!pendingFadeStop || musicId === null) return;
    sound.off("fade", pendingFadeStop, musicId);
    pendingFadeStop = undefined;
  };

  const triggerDrum = (pad: DrumPadDefinition): void => {
    drums.play(pad.sprite);
    const view = padViews.find(({ definition }) => definition === pad);
    if (view) view.remainingMs = 140;
    lastEvent = `${pad.key.toLocaleUpperCase("sl")}: ${pad.label}`;
  };

  for (const view of padViews) {
    view.hitTarget.on("pointerdown", () => triggerDrum(view.definition));
  }

  scene.handleKey = (key, repeat = 0): boolean => {
    if (repeat) return false;
    const pad = getDrumPadForKey(key);
    if (pad) {
      triggerDrum(pad);
      return true;
    }
    if (key === "a" || key === "s") {
      sound.play(key === "a" ? "toneA" : "toneB");
      return true;
    }
    if (key === "m") {
      cancelPendingFadeStop();
      if (musicId === null || !sound.playing(musicId)) {
        musicId = sound.play("music");
      }
      if (musicId !== -1) sound.fade(0, 0.45, 1200, musicId);
      return true;
    }
    if (key === "f" && musicId !== null) {
      cancelPendingFadeStop();
      const fadingId = musicId;
      pendingFadeStop = (): void => {
        sound.stop(fadingId);
        if (musicId === fadingId) musicId = null;
        pendingFadeStop = undefined;
      };
      sound.once("fade", pendingFadeStop, fadingId);
      sound.fade(sound.volume(undefined, fadingId), 0, 1200, fadingId);
      return true;
    }
    if (key === "space") {
      globallyMuted = !globallyMuted;
      Howler.mute(globallyMuted);
      lastEvent = globallyMuted ? "global mute" : "global unmute";
      return true;
    }
    return false;
  };

  scene.resize = (width: number, height: number): void => {
    const top = 116;
    const availableWidth = Math.max(1, width - 48);
    const availableHeight = Math.max(1, height - top - 18);
    const scale = Math.min(
      availableWidth / drumTexture.width,
      availableHeight / drumTexture.height,
    );
    drumContainer.scale.set(scale);
    drumContainer.position.set(
      (width - drumTexture.width * scale) / 2,
      top + (availableHeight - drumTexture.height * scale) / 2,
    );
  };
  scene.resize(initialBounds.width, initialBounds.height);

  let nextStatusUpdate = 0;
  scene.update = (deltaMs = 0): void => {
    for (const view of padViews) {
      view.remainingMs = Math.max(0, view.remainingMs - deltaMs);
      view.flash.alpha = (view.remainingMs / 140) * 0.58;
    }
    const now = performance.now();
    if (now < nextStatusUpdate) return;
    nextStatusUpdate = now + 100;
    const diagnostics = nativeAudioEngine.diagnostics;
    const musicVolume = musicId === null ? 0 : sound.volume(undefined, musicId);
    status.text =
      `music/drums: ${sound.state()}/${drums.state()}` +
      ` | voices: ${diagnostics.activeVoices}` +
      ` | queue: ${diagnostics.queuedMs.toFixed(1)} ms` +
      ` | music: ${musicVolume.toFixed(2)}` +
      ` | muted: ${globallyMuted} | ${lastEvent}`;
  };

  scene.dispose = (): void => {
    cancelPendingFadeStop();
    scene.update = (): void => undefined;
    sound.unload();
    drums.unload();
    bgMusic.unload();
    if (globallyMuted) Howler.mute(false);
  };
  return scene;
}
