import { Container, Text } from "pixi.js";
import { fileURLToPath } from "node:url";
import { Howl, Howler, nativeAudioEngine } from "../../pixi-node/audio/index.ts";
import { createMetricBitmapText } from "../bitmapFonts.ts";
import type { DisposableDemoScene } from "../sceneLifecycle.ts";

export interface AudioTestScene extends DisposableDemoScene {
    handleKey(key: string | null, repeat?: number): boolean;
    update(): void;
}

const source = fileURLToPath(
    new URL("../../../assets/audio/howler-test.wav", import.meta.url),
);

export function createAudioTest(): AudioTestScene {
    const scene = new Container() as AudioTestScene;
    scene.addChild(
        new Text({
            text: "NATIVE AUDIO / HOWLER TEST  [6]",
            style: {
                fontFamily: "Arial",
                fontSize: 26,
                fill: 0xffffff,
                stroke: { color: 0x000000, width: 3 },
            },
        }),
    );
    const instructions = createMetricBitmapText(
        "A/S: overlapping sprites  |  M: music loop + fade in  |  F: fade out  |  SPACE: global mute",
        20,
    );
    instructions.position.set(24, 64);
    const status = createMetricBitmapText("Audio idle", 20);
    status.position.set(24, 110);
    scene.addChild(instructions, status);

    let lastEvent = "loading";
    let musicId: number | null = null;
    let globallyMuted = false;
    const sound = new Howl({
        src: [source],
        sprite: {
            toneA: [0, 800],
            toneB: [1000, 800],
            music: [2000, 4000, true],
        },
        volume: 0.65,
        preloadSprites: true,
        onload: () => { lastEvent = "loaded"; },
        onplay: (id) => { lastEvent = `play ${id}`; },
        onend: (id) => { lastEvent = `end ${id}`; },
        onfade: (id) => { lastEvent = `fade ${id}`; },
        onplayerror: (_id, message) => { lastEvent = `error: ${message}`; },
    });

    scene.handleKey = (key, repeat = 0): boolean => {
        if (repeat) return false;
        if (key === "a" || key === "s") {
            sound.play(key === "a" ? "toneA" : "toneB");
            return true;
        }
        if (key === "m") {
            if (musicId === null || !sound.playing(musicId)) {
                musicId = sound.play("music");
                if (musicId !== -1) sound.fade(0, 0.45, 1200, musicId);
            } else {
                sound.stop(musicId);
                musicId = null;
            }
            return true;
        }
        if (key === "f" && musicId !== null) {
            const fadingId = musicId;
            sound.once("fade", () => {
                sound.stop(fadingId);
                if (musicId === fadingId) musicId = null;
            }, fadingId);
            sound.fade(sound.volume(), 0, 1200, fadingId);
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

    let nextUpdate = 0;
    scene.update = (): void => {
        const now = performance.now();
        if (now < nextUpdate) return;
        nextUpdate = now + 100;
        const diagnostics = nativeAudioEngine.diagnostics;
        status.text =
            `state: ${sound.state()} | voices: ${diagnostics.activeVoices}` +
            ` | queue: ${diagnostics.queuedMs.toFixed(1)} ms` +
            ` | volume: ${Howler.volume().toFixed(2)}` +
            ` | muted: ${globallyMuted} | ${lastEvent}`;
    };

    scene.dispose = (): void => {
        scene.update = (): void => undefined;
        sound.unload();
    };
    return scene;
}
