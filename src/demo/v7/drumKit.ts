import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HowlSprite } from "@pixi-native/core/audio";

export interface DrumHitRegion {
    readonly x: number;
    readonly y: number;
    readonly radiusX: number;
    readonly radiusY: number;
}

export interface DrumPadDefinition {
    readonly key: string;
    readonly sprite: string;
    readonly label: string;
    readonly hit: DrumHitRegion;
}

export interface DrumAtlasDescriptor {
    readonly src: readonly [string];
    readonly sprite: HowlSprite;
    readonly pads: readonly DrumPadDefinition[];
}

export const DRUM_DESCRIPTOR_PATH = fileURLToPath(
    new URL("../assets/audio/drum-kit-atlas.json", import.meta.url),
);
export const DRUM_ATLAS: DrumAtlasDescriptor = JSON.parse(
    readFileSync(DRUM_DESCRIPTOR_PATH, "utf8"),
) as DrumAtlasDescriptor;
export const DRUM_SOURCE_PATH = fileURLToPath(
    new URL(`../assets/audio/${DRUM_ATLAS.src[0]}`, import.meta.url),
);
export const DRUM_PADS: readonly DrumPadDefinition[] = DRUM_ATLAS.pads;

export function getDrumPadForKey(key: string | null): DrumPadDefinition | undefined {
    if (!key) return undefined;
    const normalized = key.toLocaleLowerCase("sl");
    return DRUM_PADS.find((pad) => pad.key === normalized);
}

