import type { Sprite, createApp } from "{{PIXI_IMPORT_PATH}}";

type PixiRuntime = Awaited<ReturnType<typeof createApp>>;

const ANIMATION_PERIOD_MS = 12_000;
const MINIMUM_SCALE = 0.5;
const SCALE_AMPLITUDE = 0.25;
const SCALE_MIDPOINT = 0.75;

/** Animates the background scale with the Pixi application ticker. */
export function startBackgroundAnimation(runtime: PixiRuntime, background: Sprite): void {
    let elapsedMS = 0;
    const update = (): void => {
        elapsedMS = (elapsedMS + runtime.app.ticker.deltaMS) % ANIMATION_PERIOD_MS;
        const phase = (elapsedMS / ANIMATION_PERIOD_MS) * Math.PI * 2;
        const scale = SCALE_MIDPOINT - SCALE_AMPLITUDE * Math.cos(phase);
        background.scale.set(scale);
    };

    background.scale.set(MINIMUM_SCALE);
    runtime.app.ticker.add(update);
    runtime.addDestroyListener(() => {
        runtime.app.ticker.remove(update);
    });
}
