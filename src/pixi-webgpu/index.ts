import { createWebGpuRenderer } from "./createWebGpuRenderer.ts";
import type { NodeRendererOptions } from "../pixi-native/nativeTypes.ts";

/** Creates a Pixi application on the project-owned native WebGPU surface. */
export function createPixiWebGPU(options?: NodeRendererOptions): ReturnType<typeof createWebGpuRenderer> {
    return createWebGpuRenderer(options);
}

export * from "../pixi-native/nativeTypes.ts";
