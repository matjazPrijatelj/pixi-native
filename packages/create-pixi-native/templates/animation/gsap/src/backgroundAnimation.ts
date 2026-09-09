import type { Sprite, createApp } from "{{PIXI_IMPORT_PATH}}";

type PixiRuntime = Awaited<ReturnType<typeof createApp>>;

const MINIMUM_SCALE = 0.5;
const MAXIMUM_SCALE = 1;
const ANIMATION_DURATION_SECONDS = 6;

/** Animates the background with GSAP and keeps it moving during native modal frames. */
export async function startBackgroundAnimation(
    runtime: PixiRuntime,
    background: Sprite,
): Promise<void> {
    const { gsap } = await import("gsap");
    background.scale.set(MINIMUM_SCALE);
    const tween = gsap.to(background.scale, {
        x: MAXIMUM_SCALE,
        y: MAXIMUM_SCALE,
        duration: ANIMATION_DURATION_SECONDS,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
    });
    const removeModalFrameListener = runtime.native.addModalFrameListener?.(() => {
        gsap.ticker.tick();
    });

    runtime.addDestroyListener(() => {
        tween.kill();
        removeModalFrameListener?.();
    });
}
