import { Assets, type Application } from "pixi.js";
import type { NodeGLCanvas } from "@pixi-native/core/canvas/NodeGLCanvas.js";
import type { NodeGPUCanvas } from "@pixi-native/core/canvas/NodeGPUCanvas.js";
import { createWebGlRenderer } from "./renderers/webgl/createWebGlRenderer.ts";
import { createWebGpuRenderer } from "./renderers/webgpu/createWebGpuRenderer.ts";
import {
  manageNativeApplication,
  type ManagedNativeApplication,
} from "@pixi-native/core/application/ManagedNativeApplication.js";
import type {
  NodeNativeInput,
  NodeRendererOptions,
  NodeRenderSurface,
  NodeWindowHandle,
  NodeGPUInstance,
} from "@pixi-native/core/runtime/nativeTypes.js";

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

/** PixiJS 8 application and manually managed native rendering context. */
export interface RendererResult {
  readonly app: Application;
  readonly native: NodeRendererContext;
}

/** PixiJS 8 native window options and explicit renderer backend selection. */
export interface RendererOptions extends NodeRendererOptions {
  /** Renderer backend. Defaults to `webgpu`; no automatic fallback occurs. */
  readonly backend?: RendererBackend;
}

export type AppOptions = RendererOptions;

export type App = ManagedNativeApplication<Application, NodeRendererContext>;

let nativeAssetsInitialization: Promise<void> | undefined;

/** Prepares Pixi's browser-facing Assets API for the installed native DOM. */
function initializeNativeAssets(): Promise<void> {
  nativeAssetsInitialization ??= Assets.init({
    skipDetections: true,
    texturePreference: { format: ["png"] },
    preferences: {
      preferWorkers: false,
      preferCreateImageBitmap: false,
    },
  });
  return nativeAssetsInitialization;
}

/**
 * Creates a PixiJS 8 application and native surface without a managed loop.
 * The caller owns rendering, presentation, event polling, and teardown.
 */
export async function createRenderer(
  options: RendererOptions = {},
): Promise<RendererResult> {
  const { backend = "webgpu", ...rendererOptions } = options;
  let result: RendererResult;
  switch (backend) {
    case "webgpu":
      result = await createWebGpuRenderer(rendererOptions);
      break;
    case "webgl":
      result = await createWebGlRenderer(rendererOptions);
      break;
  }
  await initializeNativeAssets();
  return result;
}

/**
 * Creates a self-running PixiJS 8 application on one native renderer backend.
 * Native close and process termination use the same idempotent teardown path.
 */
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
