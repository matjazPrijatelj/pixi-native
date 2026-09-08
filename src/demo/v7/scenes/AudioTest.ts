import { fileURLToPath } from "node:url";
import {
  Container,
  Ellipse,
  Graphics,
  Sprite,
  Text,
  Texture,
} from "pixi.js-v7";
import { Howl, Howler, nativeAudioEngine } from "@pixi-native/core/audio";
import {
  DRUM_ATLAS,
  DRUM_PADS,
  DRUM_SOURCE_PATH,
  getDrumPadForKey,
  type DrumPadDefinition,
} from "../drumKit.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";

interface DrumPadView {
  readonly definition: DrumPadDefinition;
  readonly flash: Graphics;
  remainingMs: number;
}

export interface AudioTestSceneV7 extends Container {
  handleKey(key: string | null, repeat?: number): boolean;
  resize(width: number, height: number): void;
  update(deltaMs?: number): void;
  dispose(): void;
}

const source = fileURLToPath(
  new URL("../../assets/audio/howler-test.wav", import.meta.url),
);

export function createAudioTest(
  drumTexture: Texture,
  initialBounds: { width: number; height: number },
): AudioTestSceneV7 {
  const scene = new Container() as AudioTestSceneV7;
  const title = new Text("NATIVE AUDIO / HOWLER + DRUM ATLAS  [6]", {
    fontFamily: "Arial",
    fontSize: 26,
    fill: 0xffffff,
  });
  const instructions = new Text(
    "U/I/O/P + J/K/L/Č or mouse click: drums  |  M: music fade-in  |  F: fade-out  |  SPACE: mute",
    { fontFamily: "Arial", fontSize: 18, fill: 0xffffff },
  );
  instructions.position.set(24, 48);
  const status = createMetricBitmapText("Audio loading...", 18);
  status.position.set(24, 78);
  scene.addChild(title, instructions, status);

  const drumContainer = new Container();
  drumContainer.addChild(new Sprite(drumTexture));
  const padViews: DrumPadView[] = [];
  for (const definition of DRUM_PADS) {
    const x = definition.hit.x * drumTexture.width;
    const y = definition.hit.y * drumTexture.height;
    const radiusX = definition.hit.radiusX * drumTexture.width;
    const radiusY = definition.hit.radiusY * drumTexture.height;
    const flash = new Graphics();
    flash.beginFill(0x66f5ff);
    flash.drawEllipse(x, y, radiusX, radiusY);
    flash.endFill();
    flash.alpha = 0;
    drumContainer.addChild(flash);

    const keyLabel = new Text(definition.key.toLocaleUpperCase("sl"), {
      fontFamily: "Arial",
      fontSize: 30,
      fill: 0xffffff,
    });
    keyLabel.anchor.set(0.5);
    keyLabel.position.set(x, y);
    drumContainer.addChild(keyLabel);

    const hitTarget = new Graphics();
    hitTarget.beginFill(0xffffff, 0);
    hitTarget.drawEllipse(x, y, radiusX, radiusY);
    hitTarget.endFill();
    hitTarget.eventMode = "static";
    hitTarget.hitArea = new Ellipse(x, y, radiusX, radiusY);
    drumContainer.addChild(hitTarget);

    const view = { definition, flash, remainingMs: 0 };
    padViews.push(view);
    hitTarget.on("pointerdown", () => triggerDrum(view));
  }
  scene.addChild(drumContainer);

  let lastEvent = "loading";
  let musicId: number | null = null;
  let globallyMuted = false;
  let pendingFadeStop: (() => void) | undefined;
  const sound = new Howl({
    src: [source],
    sprite: { toneA: [0, 800], toneB: [1000, 800], music: [2000, 4000, true] },
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

  function triggerDrum(view: DrumPadView): void {
    drums.play(view.definition.sprite);
    view.remainingMs = 140;
    lastEvent = `${view.definition.key.toLocaleUpperCase("sl")}: ${view.definition.label}`;
  }

  const cancelPendingFadeStop = (): void => {
    if (!pendingFadeStop || musicId === null) return;
    sound.off("fade", pendingFadeStop, musicId);
    pendingFadeStop = undefined;
  };

  scene.handleKey = (key, repeat = 0): boolean => {
    if (repeat) return false;
    const pad = getDrumPadForKey(key);
    if (pad) {
      const view = padViews.find(({ definition }) => definition === pad);
      if (view) triggerDrum(view);
      return true;
    }
    if (key === "a" || key === "s") {
      sound.play(key === "a" ? "toneA" : "toneB");
      return true;
    }
    if (key === "m") {
      cancelPendingFadeStop();
      if (musicId === null || !sound.playing(musicId))
        musicId = sound.play("music");
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

  scene.resize = (width, height): void => {
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
    status.text = `music/drums: ${sound.state()}/${drums.state()} | voices: ${diagnostics.activeVoices} | queue: ${diagnostics.queuedMs.toFixed(1)} ms | music: ${musicVolume.toFixed(2)} | muted: ${globallyMuted} | ${lastEvent}`;
  };

  scene.dispose = (): void => {
    cancelPendingFadeStop();
    scene.update = (): void => undefined;
    sound.unload();
    drums.unload();
    if (globallyMuted) Howler.mute(false);
  };
  return scene;
}
