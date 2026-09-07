import type { Application } from "pixi.js";
import type { NodeGLCanvas } from "../canvas/NodeGLCanvas.ts";
import type { NodeGPUCanvas } from "../canvas/NodeGPUCanvas.ts";
import { createWebGlRenderer } from "../renderers/webgl/createWebGlRenderer.ts";
import { createWebGpuRenderer } from "../renderers/webgpu/createWebGpuRenderer.ts";
import {
    manageNativeApplication,
    type ManagedNativeApplication,
} from "./ManagedNativeApplication.ts";
import type {
    NodeNativeInput,
    NodeRendererOptions,
    NodeRenderSurface,
    NodeWindowHandle,
    NodeGPUInstance,
} from "../runtime/nativeTypes.ts";

export interface NodeRendererContext {
    readonly gpu: NodeGPUInstance | null;
    readonly adapter: GPUAdapter | null;
    readonly device: GPUDevice | null;
    readonly window: NodeWindowHandle;
    readonly renderer: NodeRenderSurface;
    readonly canvas: NodeGPUCanvas | NodeGLCanvas;
    readonly backend: "webgpu" | "webgl";
    readonly input: NodeNativeInput;
    readonly addModalFrameListener?: (listener: () => void) => () => void;
    readonly destroy: () => void;
}

export type RendererBackend = "webgpu" | "webgl";

export interface RendererResult {
    readonly app: Application;
    readonly native: NodeRendererContext;
}

export interface RendererOptions extends NodeRendererOptions {
    readonly backend?: RendererBackend;
}

export type AppOptions = RendererOptions;

export type App = ManagedNativeApplication<
    Application,
    NodeRendererContext
>;

/** Selects one explicit backend; backend implementations own their startup details. */
export async function createRenderer(
    options: RendererOptions = {},
): Promise<RendererResult> {
    const { backend = "webgpu", ...rendererOptions } = options;
    switch (backend) {
        case "webgpu":
            return createWebGpuRenderer(rendererOptions);
        case "webgl":
            return createWebGlRenderer(rendererOptions);
    }
}

/** Creates a self-running Pixi 8 application on one native renderer backend. */
export async function createApp(options: AppOptions = {}): Promise<App> {
    const { app, native } = await createRenderer(options);

    return manageNativeApplication({
        app,
        native,
        present: () => native.renderer.swap(),
        destroyApplication: () => {
            // Pixi 8's default Application.destroy order releases the stage
            // before GPU systems. Native textures can still notify bind groups,
            // so release the renderer first and then the display tree/ticker.
            app.renderer.destroy({ removeView: true });
            app.stage.destroy({ children: true, context: true, style: true });
            app.ticker.destroy();
        },
    });
}
