import { createWebGlRenderer } from "./createWebGlRenderer.ts";
import type { NodeRendererOptions } from "../nativeTypes.ts";

/** Creates a Pixi application on the native WebGL2 surface. */
export function createPixiWebGL(options?: NodeRendererOptions): ReturnType<typeof createWebGlRenderer> {
    return createWebGlRenderer(options);
}

export * from "../nativeTypes.ts";


