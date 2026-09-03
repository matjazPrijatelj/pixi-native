import type { Application } from "pixi.js";
import type { NodeGLCanvas } from "./NodeGLCanvas.ts";
import type { NodeGPUCanvas } from "./NodeGPUCanvas.ts";
import { createWebGlRenderer } from "../pixi-webgl/createWebGlRenderer.ts";
import { createWebGpuRenderer } from "../pixi-webgpu/createWebGpuRenderer.ts";
import type {
    NodeNativeInput,
    NodeRendererOptions,
    NodeRenderSurface,
    NodeWindowHandle,
    NodeGPUInstance,
} from "./nativeTypes.ts";

export interface NodeRendererContext {
    readonly gpu: NodeGPUInstance | null;
    readonly adapter: GPUAdapter | null;
    readonly device: GPUDevice | null;
    readonly window: NodeWindowHandle;
    readonly renderer: NodeRenderSurface;
    readonly canvas: NodeGPUCanvas | NodeGLCanvas;
    readonly backend: "webgpu" | "webgl";
    readonly input: NodeNativeInput;
    readonly destroy: () => void;
}

export type RendererBackend = "webgpu" | "webgl";

export interface PixiRendererResult {
    readonly app: Application;
    readonly native: NodeRendererContext;
}

/** Selects one explicit backend; backend implementations own their startup details. */
export async function createPixiRenderer(
    backend: RendererBackend = "webgpu",
    options: NodeRendererOptions = {},
): Promise<PixiRendererResult> {
    switch (backend) {
        case "webgpu":
            return createWebGpuRenderer(options);
        case "webgl":
            return createWebGlRenderer(options);
    }
}
